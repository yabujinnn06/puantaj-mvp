from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import secrets

import anyio
from sqlalchemy.orm import Session

from app.chess.ai_service import chess_ai_service
from app.chess.audit import log_chess_activity
from app.chess.auth_integration import ChessActorContext
from app.chess.config import get_chess_config
from app.chess.constants import (
    ChessAIDifficulty,
    ChessEndReason,
    ChessMatchStatus,
    ChessMatchType,
    ChessPlayerKind,
    ChessQueueStatus,
    ChessRealtimeEventType,
    ChessResult,
    ChessSide,
    CLASSIC_STARTING_FEN,
    EVENT_CHESS_DRAW_OFFERED,
    EVENT_CHESS_MATCH_CREATED,
    EVENT_CHESS_MATCH_ENDED,
    EVENT_CHESS_MATCH_JOINED,
    EVENT_CHESS_MATCH_STARTED,
    EVENT_CHESS_MOVE_REJECTED,
    EVENT_CHESS_MOVE_SUBMITTED,
    EVENT_CHESS_QUEUE_JOINED,
    EVENT_CHESS_QUEUE_LEFT,
    EVENT_CHESS_RESIGNED,
)
from app.chess.contracts import ChessLegalMoveRead, ChessMatchStateResponse
from app.chess.engine import require_chess
from app.chess.models import ChessMatch, ChessMatchPlayer, ChessMatchmakingQueue, ChessMove, ChessRatingHistory
from app.chess.rating_service import chess_rating_service
from app.chess.realtime_gateway import chess_realtime_gateway
from app.chess.repositories import ChessMatchRepository, ChessMatchmakingRepository, ChessProfileRepository, ChessRatingRepository
from app.chess.serializers import serialize_match_state
from app.errors import ApiError


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ChessMatchService:
    def __init__(self) -> None:
        self.config = get_chess_config()

    def create_match(self, db: Session, *, actor: ChessActorContext, payload) -> ChessMatchStateResponse:
        profile_repo = ChessProfileRepository(db)
        rating_repo = ChessRatingRepository(db)
        match_repo = ChessMatchRepository(db)
        now = utcnow()

        profile_repo.get_or_create(employee_id=actor.employee_id, display_name=actor.display_name)
        rating_repo.get_or_create(employee_id=actor.employee_id, default_rating=self.config.default_rating)

        host_side = payload.preferred_side.value if payload.preferred_side is not None else ChessSide.WHITE.value
        match = ChessMatch(
            public_code=self._generate_match_code(match_repo),
            status=(ChessMatchStatus.ACTIVE.value if payload.opponent_mode == ChessPlayerKind.AI else ChessMatchStatus.WAITING.value),
            match_type=(ChessMatchType.AI.value if payload.opponent_mode == ChessPlayerKind.AI else payload.match_type.value),
            result=ChessResult.ONGOING.value,
            initial_fen=CLASSIC_STARTING_FEN,
            fen_current=CLASSIC_STARTING_FEN,
            turn_color=ChessSide.WHITE.value,
            white_clock_ms=self.config.rapid_clock_ms,
            black_clock_ms=self.config.rapid_clock_ms,
            turn_started_at=(now if payload.opponent_mode == ChessPlayerKind.AI else None),
            started_at=(now if payload.opponent_mode == ChessPlayerKind.AI else None),
            ai_difficulty=(payload.ai_difficulty.value if payload.opponent_mode == ChessPlayerKind.AI else None),
            host_employee_id=actor.employee_id,
        )
        match_repo.add_match(match)

        host_player = ChessMatchPlayer(
            match_id=match.id,
            employee_id=actor.employee_id,
            device_id=actor.device_id,
            player_kind=ChessPlayerKind.HUMAN.value,
            seat_color=host_side,
            display_name_snapshot=actor.display_name,
            is_host=True,
            is_connected=True,
            joined_at=now,
            last_active_at=now,
        )
        match_repo.add_player(host_player)

        if payload.opponent_mode == ChessPlayerKind.AI:
            ai_player = ChessMatchPlayer(
                match_id=match.id,
                player_kind=ChessPlayerKind.AI.value,
                seat_color=self._other_side(host_side),
                display_name_snapshot=f"YABU {payload.ai_difficulty.value}",
                is_connected=True,
                joined_at=now,
                last_active_at=now,
            )
            match_repo.add_player(ai_player)
            self._play_ai_turns(match=match, players=[host_player, ai_player], match_repo=match_repo, rating_repo=rating_repo)

        db.commit()
        refreshed_match = match_repo.get_match(match.id)
        if refreshed_match is None:
            raise ApiError(status_code=500, code="CHESS_MATCH_MISSING", message="Mac olusturuldu ama okunamadi.")
        you = match_repo.get_player_for_actor(match=refreshed_match, employee_id=actor.employee_id, device_id=actor.device_id)
        if you is None:
            raise ApiError(status_code=403, code="CHESS_NOT_PARTICIPANT", message="Maca erisim yok.")
        state = self.build_match_state(db, match=refreshed_match, actor=actor, you=you)
        log_chess_activity(
            db,
            employee_id=actor.employee_id,
            device_id=actor.device_id,
            action="CHESS_MATCH_CREATED",
            event_type=EVENT_CHESS_MATCH_CREATED,
            entity_type="chess_match",
            entity_id=str(refreshed_match.id),
            details={"match_type": refreshed_match.match_type, "public_code": refreshed_match.public_code},
        )
        self._publish_snapshot(refreshed_match.id, ChessRealtimeEventType.SNAPSHOT, state)
        return state

    def join_match(self, db: Session, *, actor: ChessActorContext, match_id: int) -> ChessMatchStateResponse:
        match_repo = ChessMatchRepository(db)
        rating_repo = ChessRatingRepository(db)
        profile_repo = ChessProfileRepository(db)
        match = match_repo.get_match(match_id)
        if match is None:
            raise ApiError(status_code=404, code="CHESS_MATCH_NOT_FOUND", message="Mac bulunamadi.")

        profile_repo.get_or_create(employee_id=actor.employee_id, display_name=actor.display_name)
        rating_repo.get_or_create(employee_id=actor.employee_id, default_rating=self.config.default_rating)

        now = utcnow()
        existing_player = match_repo.get_player_for_actor(match=match, employee_id=actor.employee_id, device_id=actor.device_id)
        if existing_player is None:
            if match.status != ChessMatchStatus.WAITING.value:
                raise ApiError(status_code=409, code="CHESS_MATCH_NOT_JOINABLE", message="Bu maca artik girilemiyor.")
            if sum(1 for player in match.players if player.player_kind == ChessPlayerKind.HUMAN.value) >= 2:
                raise ApiError(status_code=409, code="CHESS_MATCH_FULL", message="Mac dolu.")
            occupied = {player.seat_color for player in match.players}
            seat_color = ChessSide.BLACK.value if ChessSide.WHITE.value in occupied else ChessSide.WHITE.value
            existing_player = ChessMatchPlayer(
                match_id=match.id,
                employee_id=actor.employee_id,
                device_id=actor.device_id,
                player_kind=ChessPlayerKind.HUMAN.value,
                seat_color=seat_color,
                display_name_snapshot=actor.display_name,
                is_connected=True,
                joined_at=now,
                last_active_at=now,
            )
            match_repo.add_player(existing_player)
        else:
            existing_player.is_connected = True
            existing_player.last_active_at = now
            existing_player.left_at = None

        if len(match.players) >= 2 and match.status == ChessMatchStatus.WAITING.value:
            match.status = ChessMatchStatus.ACTIVE.value
            match.started_at = now
            match.turn_started_at = now
            log_chess_activity(
                db,
                employee_id=actor.employee_id,
                device_id=actor.device_id,
                action="CHESS_MATCH_STARTED",
                event_type=EVENT_CHESS_MATCH_STARTED,
                entity_type="chess_match",
                entity_id=str(match.id),
                details={"public_code": match.public_code},
            )

        db.commit()
        refreshed_match = match_repo.get_match(match.id)
        if refreshed_match is None:
            raise ApiError(status_code=404, code="CHESS_MATCH_NOT_FOUND", message="Mac bulunamadi.")
        you = match_repo.get_player_for_actor(match=refreshed_match, employee_id=actor.employee_id, device_id=actor.device_id)
        if you is None:
            raise ApiError(status_code=403, code="CHESS_NOT_PARTICIPANT", message="Maca erisim yok.")
        state = self.build_match_state(db, match=refreshed_match, actor=actor, you=you)
        log_chess_activity(
            db,
            employee_id=actor.employee_id,
            device_id=actor.device_id,
            action="CHESS_MATCH_JOINED",
            event_type=EVENT_CHESS_MATCH_JOINED,
            entity_type="chess_match",
            entity_id=str(refreshed_match.id),
            details={"public_code": refreshed_match.public_code},
        )
        self._publish_snapshot(refreshed_match.id, ChessRealtimeEventType.PLAYER_JOINED, state)
        return state

    def get_match_state(self, db: Session, *, actor: ChessActorContext, match_id: int) -> ChessMatchStateResponse:
        match_repo = ChessMatchRepository(db)
        match = match_repo.get_match(match_id)
        if match is None:
            raise ApiError(status_code=404, code="CHESS_MATCH_NOT_FOUND", message="Mac bulunamadi.")
        you = match_repo.get_player_for_actor(match=match, employee_id=actor.employee_id, device_id=actor.device_id)
        if you is None:
            raise ApiError(status_code=403, code="CHESS_NOT_PARTICIPANT", message="Maca erisim yok.")
        state = self.build_match_state(db, match=match, actor=actor, you=you)
        db.commit()
        return state

    def build_match_state(self, db: Session, *, match: ChessMatch, actor: ChessActorContext, you: ChessMatchPlayer) -> ChessMatchStateResponse:
        rating_repo = ChessRatingRepository(db)
        self._sync_clock(match=match, players=match.players, rating_repo=rating_repo, now=utcnow())
        board = require_chess().Board(match.fen_current)
        legal_moves = self._legal_moves_for_actor(board=board, match=match, you=you)
        return serialize_match_state(match=match, you=you, players=match.players, moves=sorted(match.moves, key=lambda item: item.ply_number), legal_moves=legal_moves)

    def submit_move(self, db: Session, *, actor: ChessActorContext, match_id: int, payload) -> ChessMatchStateResponse:
        chess = require_chess()
        match_repo = ChessMatchRepository(db)
        rating_repo = ChessRatingRepository(db)
        match = match_repo.get_match(match_id)
        if match is None:
            raise ApiError(status_code=404, code="CHESS_MATCH_NOT_FOUND", message="Mac bulunamadi.")
        player = match_repo.get_player_for_actor(match=match, employee_id=actor.employee_id, device_id=actor.device_id)
        if player is None:
            raise ApiError(status_code=403, code="CHESS_NOT_PARTICIPANT", message="Maca erisim yok.")
        if match.status != ChessMatchStatus.ACTIVE.value:
            raise ApiError(status_code=409, code="CHESS_MATCH_NOT_ACTIVE", message="Mac aktif degil.")
        if player.seat_color != match.turn_color:
            raise ApiError(status_code=409, code="CHESS_NOT_YOUR_TURN", message="Hamle sirasi sende degil.")

        now = utcnow()
        if self._sync_clock(match=match, players=match.players, rating_repo=rating_repo, now=now):
            db.commit()
            return self.build_match_state(db, match=match, actor=actor, you=player)

        board = chess.Board(match.fen_current)
        uci = f"{payload.from_square.lower()}{payload.to_square.lower()}{(payload.promotion or '').lower()}"
        move = chess.Move.from_uci(uci)
        if move not in board.legal_moves:
            log_chess_activity(
                db,
                employee_id=actor.employee_id,
                device_id=actor.device_id,
                action="CHESS_MOVE_REJECTED",
                event_type=EVENT_CHESS_MOVE_REJECTED,
                entity_type="chess_match",
                entity_id=str(match.id),
                details={"uci": uci},
            )
            raise ApiError(status_code=400, code="CHESS_MOVE_INVALID", message="Gecersiz hamle.")

        elapsed_ms = self._elapsed_turn_ms(match=match, now=now)
        san = board.san(move)
        board.push(move)

        active_clock_before = match.white_clock_ms if player.seat_color == ChessSide.WHITE.value else match.black_clock_ms
        remaining_clock = max(0, active_clock_before - elapsed_ms)
        if player.seat_color == ChessSide.WHITE.value:
            match.white_clock_ms = remaining_clock
        else:
            match.black_clock_ms = remaining_clock

        move_row = ChessMove(
            match_id=match.id,
            played_by_player_id=player.id,
            ply_number=match.move_count + 1,
            san=san,
            uci=move.uci(),
            fen_after=board.fen(),
            think_time_ms=elapsed_ms,
        )
        match_repo.add_move(move_row)
        match.fen_current = board.fen()
        match.turn_color = ChessSide(board.turn).value
        match.move_count += 1
        match.turn_started_at = now
        match.draw_offer_by_side = None
        match.pgn = self._render_pgn(sorted(match.moves + [move_row], key=lambda item: item.ply_number))
        player.last_active_at = now
        log_chess_activity(
            db,
            employee_id=actor.employee_id,
            device_id=actor.device_id,
            action="CHESS_MOVE_SUBMITTED",
            event_type=EVENT_CHESS_MOVE_SUBMITTED,
            entity_type="chess_match",
            entity_id=str(match.id),
            details={"san": san, "uci": move.uci()},
        )

        self._resolve_finished_board(match=match, board=board, players=match.players, rating_repo=rating_repo, now=now)
        if match.status == ChessMatchStatus.ACTIVE.value:
            self._play_ai_turns(match=match, players=match.players, match_repo=match_repo, rating_repo=rating_repo)

        db.commit()
        refreshed_match = match_repo.get_match(match.id)
        if refreshed_match is None:
            raise ApiError(status_code=404, code="CHESS_MATCH_NOT_FOUND", message="Mac bulunamadi.")
        you = match_repo.get_player_for_actor(match=refreshed_match, employee_id=actor.employee_id, device_id=actor.device_id)
        if you is None:
            raise ApiError(status_code=403, code="CHESS_NOT_PARTICIPANT", message="Maca erisim yok.")
        state = self.build_match_state(db, match=refreshed_match, actor=actor, you=you)
        self._publish_snapshot(
            refreshed_match.id,
            ChessRealtimeEventType.GAME_ENDED if refreshed_match.status == ChessMatchStatus.FINISHED.value else ChessRealtimeEventType.MOVE_ACCEPTED,
            state,
        )
        return state

    def offer_draw(self, db: Session, *, actor: ChessActorContext, match_id: int) -> ChessMatchStateResponse:
        match_repo = ChessMatchRepository(db)
        match = match_repo.get_match(match_id)
        if match is None:
            raise ApiError(status_code=404, code="CHESS_MATCH_NOT_FOUND", message="Mac bulunamadi.")
        player = match_repo.get_player_for_actor(match=match, employee_id=actor.employee_id, device_id=actor.device_id)
        if player is None:
            raise ApiError(status_code=403, code="CHESS_NOT_PARTICIPANT", message="Maca erisim yok.")
        match.draw_offer_by_side = player.seat_color
        log_chess_activity(
            db,
            employee_id=actor.employee_id,
            device_id=actor.device_id,
            action="CHESS_DRAW_OFFERED",
            event_type=EVENT_CHESS_DRAW_OFFERED,
            entity_type="chess_match",
            entity_id=str(match.id),
            details={"side": player.seat_color},
        )
        db.commit()
        state = self.build_match_state(db, match=match, actor=actor, you=player)
        self._publish_snapshot(match.id, ChessRealtimeEventType.DRAW_OFFERED, state)
        return state

    def respond_draw(self, db: Session, *, actor: ChessActorContext, match_id: int, accept: bool) -> ChessMatchStateResponse:
        match_repo = ChessMatchRepository(db)
        rating_repo = ChessRatingRepository(db)
        match = match_repo.get_match(match_id)
        if match is None:
            raise ApiError(status_code=404, code="CHESS_MATCH_NOT_FOUND", message="Mac bulunamadi.")
        player = match_repo.get_player_for_actor(match=match, employee_id=actor.employee_id, device_id=actor.device_id)
        if player is None:
            raise ApiError(status_code=403, code="CHESS_NOT_PARTICIPANT", message="Maca erisim yok.")
        if match.draw_offer_by_side is None or match.draw_offer_by_side == player.seat_color:
            raise ApiError(status_code=409, code="CHESS_DRAW_NOT_PENDING", message="Bekleyen beraberlik teklifi yok.")
        if accept:
            self._end_match(match=match, players=match.players, result=ChessResult.DRAW.value, reason=ChessEndReason.AGREED_DRAW.value, rating_repo=rating_repo, now=utcnow())
        else:
            match.draw_offer_by_side = None
        db.commit()
        refreshed = match_repo.get_match(match.id)
        if refreshed is None:
            raise ApiError(status_code=404, code="CHESS_MATCH_NOT_FOUND", message="Mac bulunamadi.")
        you = match_repo.get_player_for_actor(match=refreshed, employee_id=actor.employee_id, device_id=actor.device_id)
        if you is None:
            raise ApiError(status_code=403, code="CHESS_NOT_PARTICIPANT", message="Maca erisim yok.")
        state = self.build_match_state(db, match=refreshed, actor=actor, you=you)
        self._publish_snapshot(
            refreshed.id,
            ChessRealtimeEventType.GAME_ENDED if accept else ChessRealtimeEventType.SNAPSHOT,
            state,
        )
        return state

    def resign(self, db: Session, *, actor: ChessActorContext, match_id: int) -> ChessMatchStateResponse:
        match_repo = ChessMatchRepository(db)
        rating_repo = ChessRatingRepository(db)
        match = match_repo.get_match(match_id)
        if match is None:
            raise ApiError(status_code=404, code="CHESS_MATCH_NOT_FOUND", message="Mac bulunamadi.")
        player = match_repo.get_player_for_actor(match=match, employee_id=actor.employee_id, device_id=actor.device_id)
        if player is None:
            raise ApiError(status_code=403, code="CHESS_NOT_PARTICIPANT", message="Maca erisim yok.")
        player.resigned_at = utcnow()
        result = ChessResult.BLACK_WIN.value if player.seat_color == ChessSide.WHITE.value else ChessResult.WHITE_WIN.value
        self._end_match(match=match, players=match.players, result=result, reason=ChessEndReason.RESIGNATION.value, rating_repo=rating_repo, now=utcnow())
        log_chess_activity(
            db,
            employee_id=actor.employee_id,
            device_id=actor.device_id,
            action="CHESS_RESIGNED",
            event_type=EVENT_CHESS_RESIGNED,
            entity_type="chess_match",
            entity_id=str(match.id),
            details={"side": player.seat_color},
        )
        db.commit()
        refreshed = match_repo.get_match(match.id)
        if refreshed is None:
            raise ApiError(status_code=404, code="CHESS_MATCH_NOT_FOUND", message="Mac bulunamadi.")
        you = match_repo.get_player_for_actor(match=refreshed, employee_id=actor.employee_id, device_id=actor.device_id)
        if you is None:
            raise ApiError(status_code=403, code="CHESS_NOT_PARTICIPANT", message="Maca erisim yok.")
        state = self.build_match_state(db, match=refreshed, actor=actor, you=you)
        self._publish_snapshot(refreshed.id, ChessRealtimeEventType.RESIGN, state)
        return state

    def mark_player_connection(self, db: Session, *, actor: ChessActorContext, match_id: int, is_connected: bool) -> None:
        match_repo = ChessMatchRepository(db)
        match = match_repo.get_match(match_id)
        if match is None:
            return
        player = match_repo.get_player_for_actor(match=match, employee_id=actor.employee_id, device_id=actor.device_id)
        if player is None:
            return
        now = utcnow()
        player.is_connected = is_connected
        player.last_active_at = now
        if not is_connected:
            player.left_at = now
        db.commit()

    def enqueue_matchmaking(self, db: Session, *, actor: ChessActorContext, payload):
        queue_repo = ChessMatchmakingRepository(db)
        now = utcnow()
        queue_repo.prune_expired(now=now)
        queue_repo.cancel_open_entries(employee_id=actor.employee_id, now=now)
        entry = ChessMatchmakingQueue(
            employee_id=actor.employee_id,
            device_id=actor.device_id,
            match_type=payload.match_type.value,
            preferred_side=payload.preferred_side.value if payload.preferred_side is not None else None,
            status=ChessQueueStatus.OPEN.value,
            expires_at=now + timedelta(seconds=self.config.queue_ttl_seconds),
        )
        queue_repo.add(entry)
        log_chess_activity(
            db,
            employee_id=actor.employee_id,
            device_id=actor.device_id,
            action="CHESS_QUEUE_JOINED",
            event_type=EVENT_CHESS_QUEUE_JOINED,
            entity_type="chess_queue",
            entity_id=str(entry.id),
            details={"match_type": entry.match_type},
        )
        matched_state = self._try_matchmake(db=db, actor=actor, entry=entry)
        db.commit()
        return matched_state, entry

    def cancel_matchmaking(self, db: Session, *, actor: ChessActorContext) -> None:
        queue_repo = ChessMatchmakingRepository(db)
        queue_repo.cancel_open_entries(employee_id=actor.employee_id, now=utcnow())
        db.commit()
        log_chess_activity(
            db,
            employee_id=actor.employee_id,
            device_id=actor.device_id,
            action="CHESS_QUEUE_LEFT",
            event_type=EVENT_CHESS_QUEUE_LEFT,
            entity_type="chess_queue",
            entity_id=str(actor.employee_id),
            details={},
        )

    def _try_matchmake(self, *, db: Session, actor: ChessActorContext, entry: ChessMatchmakingQueue):
        queue_repo = ChessMatchmakingRepository(db)
        candidates = queue_repo.list_open_candidates(employee_id=actor.employee_id, match_type=entry.match_type, now=utcnow())
        if not candidates:
            return None
        opponent_entry = candidates[0]
        opponent_side = opponent_entry.preferred_side or ChessSide.BLACK.value
        creator_context = ChessActorContext(
            employee_id=opponent_entry.employee_id,
            device_id=opponent_entry.device_id,
            device_fingerprint="queue",
            display_name=opponent_entry.employee.full_name if opponent_entry.employee is not None and opponent_entry.employee.full_name else f"Calisan {opponent_entry.employee_id}",
        )
        payload = type("QueuePayload", (), {"preferred_side": ChessSide(opponent_side), "match_type": ChessMatchType(entry.match_type), "opponent_mode": ChessPlayerKind.HUMAN, "ai_difficulty": None})
        state = self.create_match(db, actor=creator_context, payload=payload)
        match_id = state.match.id
        opponent_entry.status = ChessQueueStatus.MATCHED.value
        opponent_entry.matched_match_id = match_id
        opponent_entry.matched_at = utcnow()
        entry.status = ChessQueueStatus.MATCHED.value
        entry.matched_match_id = match_id
        entry.matched_at = utcnow()
        self.join_match(db, actor=actor, match_id=match_id)
        return match_id

    def _play_ai_turns(self, *, match: ChessMatch, players: list[ChessMatchPlayer], match_repo: ChessMatchRepository, rating_repo: ChessRatingRepository) -> None:
        ai_player = next((player for player in players if player.player_kind == ChessPlayerKind.AI.value and player.seat_color == match.turn_color), None)
        if ai_player is None or match.status != ChessMatchStatus.ACTIVE.value:
            return

        chess = require_chess()
        board = chess.Board(match.fen_current)
        difficulty = ChessAIDifficulty(match.ai_difficulty or ChessAIDifficulty.EASY.value)
        while match.status == ChessMatchStatus.ACTIVE.value and ai_player is not None and match.turn_color == ai_player.seat_color:
            move_uci = chess_ai_service.choose_move(fen=match.fen_current, difficulty=difficulty)
            move = chess.Move.from_uci(move_uci)
            san = board.san(move)
            board.push(move)
            move_row = ChessMove(
                match_id=match.id,
                played_by_player_id=ai_player.id,
                ply_number=match.move_count + 1,
                san=san,
                uci=move.uci(),
                fen_after=board.fen(),
                think_time_ms=self.config.ai_move_delay_ms,
            )
            match_repo.add_move(move_row)
            match.fen_current = board.fen()
            match.turn_color = ChessSide(board.turn).value
            match.move_count += 1
            match.turn_started_at = utcnow()
            match.pgn = self._render_pgn(sorted(match.moves + [move_row], key=lambda item: item.ply_number))
            self._resolve_finished_board(match=match, board=board, players=players, rating_repo=rating_repo, now=utcnow())
            ai_player = next((player for player in players if player.player_kind == ChessPlayerKind.AI.value and player.seat_color == match.turn_color), None)

    def _sync_clock(self, *, match: ChessMatch, players: list[ChessMatchPlayer], rating_repo: ChessRatingRepository, now: datetime) -> bool:
        if match.status != ChessMatchStatus.ACTIVE.value or match.turn_started_at is None:
            return False
        elapsed_ms = self._elapsed_turn_ms(match=match, now=now)
        if elapsed_ms <= 0:
            return False
        current_clock = match.white_clock_ms if match.turn_color == ChessSide.WHITE.value else match.black_clock_ms
        remaining = current_clock - elapsed_ms
        if remaining > 0:
            if match.turn_color == ChessSide.WHITE.value:
                match.white_clock_ms = remaining
            else:
                match.black_clock_ms = remaining
            match.turn_started_at = now
            return False
        if match.turn_color == ChessSide.WHITE.value:
            match.white_clock_ms = 0
            result = ChessResult.BLACK_WIN.value
        else:
            match.black_clock_ms = 0
            result = ChessResult.WHITE_WIN.value
        self._end_match(match=match, players=players, result=result, reason=ChessEndReason.TIMEOUT.value, rating_repo=rating_repo, now=now)
        return True

    def _elapsed_turn_ms(self, *, match: ChessMatch, now: datetime) -> int:
        if match.turn_started_at is None:
            return 0
        return max(0, int((now - match.turn_started_at).total_seconds() * 1000))

    def _resolve_finished_board(self, *, match: ChessMatch, board, players: list[ChessMatchPlayer], rating_repo: ChessRatingRepository, now: datetime) -> None:
        if board.is_checkmate():
            result = ChessResult.BLACK_WIN.value if board.turn else ChessResult.WHITE_WIN.value
            self._end_match(match=match, players=players, result=result, reason=ChessEndReason.CHECKMATE.value, rating_repo=rating_repo, now=now)
            return
        if board.is_stalemate():
            self._end_match(match=match, players=players, result=ChessResult.DRAW.value, reason=ChessEndReason.STALEMATE.value, rating_repo=rating_repo, now=now)
            return
        if board.is_insufficient_material():
            self._end_match(match=match, players=players, result=ChessResult.DRAW.value, reason=ChessEndReason.INSUFFICIENT_MATERIAL.value, rating_repo=rating_repo, now=now)
            return
        if board.can_claim_threefold_repetition():
            self._end_match(match=match, players=players, result=ChessResult.DRAW.value, reason=ChessEndReason.REPETITION.value, rating_repo=rating_repo, now=now)
            return
        if board.can_claim_fifty_moves():
            self._end_match(match=match, players=players, result=ChessResult.DRAW.value, reason=ChessEndReason.FIFTY_MOVES.value, rating_repo=rating_repo, now=now)

    def _end_match(self, *, match: ChessMatch, players: list[ChessMatchPlayer], result: str, reason: str, rating_repo: ChessRatingRepository, now: datetime) -> None:
        if match.status == ChessMatchStatus.FINISHED.value:
            return
        match.status = ChessMatchStatus.FINISHED.value
        match.result = result
        match.ended_reason = reason
        match.ended_at = now
        match.turn_started_at = None
        chess_rating_service.apply_match_result(rating_repo=rating_repo, match=match, players=players)

    def _legal_moves_for_actor(self, *, board, match: ChessMatch, you: ChessMatchPlayer) -> list[ChessLegalMoveRead]:
        if match.status != ChessMatchStatus.ACTIVE.value or match.turn_color != you.seat_color:
            return []
        return [
            ChessLegalMoveRead(
                from_square=move.uci()[:2],
                to_square=move.uci()[2:4],
                san=board.san(move),
                promotion=move.uci()[4:5] or None,
            )
            for move in board.legal_moves
        ]

    def _render_pgn(self, moves: list[ChessMove]) -> str:
        parts: list[str] = []
        for index, move in enumerate(moves):
            if index % 2 == 0:
                parts.append(f"{index // 2 + 1}. {move.san}")
            else:
                parts[-1] = f"{parts[-1]} {move.san}"
        return " ".join(parts)

    def _generate_match_code(self, match_repo: ChessMatchRepository) -> str:
        for _ in range(8):
            code = secrets.token_hex(3).upper()
            if match_repo.get_match_by_code(code) is None:
                return code
        raise ApiError(status_code=500, code="CHESS_CODE_GENERATION_FAILED", message="Mac kodu uretilemedi.")

    def _other_side(self, side: str) -> str:
        return ChessSide.BLACK.value if side == ChessSide.WHITE.value else ChessSide.WHITE.value

    def _publish_snapshot(self, match_id: int, event: ChessRealtimeEventType, state: ChessMatchStateResponse) -> None:
        try:
            anyio.from_thread.run(
                self._publish_async,
                match_id,
                event,
                state.model_dump(mode="json"),
            )
        except RuntimeError:
            return

    async def _publish_async(self, match_id: int, event: ChessRealtimeEventType, state: dict[str, object]) -> None:
        await chess_realtime_gateway.publish(
            match_id=match_id,
            event=event,
            payload={"state": state},
        )


chess_match_service = ChessMatchService()
