from __future__ import annotations

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.chess.auth_integration import resolve_chess_actor
from app.chess.constants import (
    ChessRealtimeEventType,
    EVENT_CHESS_HISTORY_VIEWED,
    EVENT_CHESS_LEADERBOARD_VIEWED,
    EVENT_CHESS_LOBBY_VIEWED,
    EVENT_CHESS_PROFILE_VIEWED,
)
from app.chess.contracts import (
    ChessAckResponse,
    ChessCreateMatchRequest,
    ChessDrawOfferRequest,
    ChessDrawResponseRequest,
    ChessHistoryResponse,
    ChessJoinMatchRequest,
    ChessLeaderboardResponse,
    ChessLobbyResponse,
    ChessMatchStateResponse,
    ChessMatchmakingEnqueueRequest,
    ChessProfileRead,
    ChessResignRequest,
    ChessMoveIntentRequest,
)
from app.chess.history_service import chess_history_service
from app.chess.leaderboard_service import chess_leaderboard_service
from app.chess.match_service import chess_match_service
from app.chess.realtime_gateway import chess_realtime_gateway
from app.chess.repositories import ChessMatchRepository, ChessMatchmakingRepository, ChessProfileRepository, ChessRatingRepository
from app.chess.serializers import serialize_queue_entry, serialize_match_summary
from app.db import SessionLocal, get_db
from app.errors import ApiError
from app.services.activity_events import log_employee_activity

router = APIRouter(tags=["chess"])


@router.get("/api/chess/lobby", response_model=ChessLobbyResponse)
def chess_lobby(
    device_fingerprint: str = Query(min_length=8),
    db: Session = Depends(get_db),
) -> ChessLobbyResponse:
    actor = resolve_chess_actor(db, device_fingerprint=device_fingerprint)
    profile_repo = ChessProfileRepository(db)
    rating_repo = ChessRatingRepository(db)
    match_repo = ChessMatchRepository(db)
    queue_repo = ChessMatchmakingRepository(db)
    profile = chess_history_service.build_profile(
        employee_id=actor.employee_id,
        display_name=actor.display_name,
        profile_repo=profile_repo,
        rating_repo=rating_repo,
        match_repo=match_repo,
    )
    waiting_matches = [serialize_match_summary(match) for match in match_repo.list_waiting_matches(limit=8)]
    active_matches = [serialize_match_summary(match) for match in match_repo.list_active_matches_for_employee(employee_id=actor.employee_id, limit=5)]
    queue_entry = queue_repo.get_open_for_employee(employee_id=actor.employee_id)
    log_employee_activity(
        db,
        employee_id=actor.employee_id,
        device_id=actor.device_id,
        action="CHESS_LOBBY_VIEWED",
        module="CHESS",
        event_type=EVENT_CHESS_LOBBY_VIEWED,
        entity_type="chess_lobby",
        entity_id=str(actor.employee_id),
    )
    return ChessLobbyResponse(
        profile=profile,
        waiting_matches=waiting_matches,
        active_matches=active_matches,
        leaderboard=chess_leaderboard_service.build_leaderboard(rating_repo=rating_repo).items,
        queue_entry=serialize_queue_entry(queue_entry) if queue_entry is not None else None,
    )


@router.get("/api/chess/profile", response_model=ChessProfileRead)
def chess_profile(
    device_fingerprint: str = Query(min_length=8),
    db: Session = Depends(get_db),
) -> ChessProfileRead:
    actor = resolve_chess_actor(db, device_fingerprint=device_fingerprint)
    profile = chess_history_service.build_profile(
        employee_id=actor.employee_id,
        display_name=actor.display_name,
        profile_repo=ChessProfileRepository(db),
        rating_repo=ChessRatingRepository(db),
        match_repo=ChessMatchRepository(db),
    )
    log_employee_activity(
        db,
        employee_id=actor.employee_id,
        device_id=actor.device_id,
        action="CHESS_PROFILE_VIEWED",
        module="CHESS",
        event_type=EVENT_CHESS_PROFILE_VIEWED,
        entity_type="chess_profile",
        entity_id=str(actor.employee_id),
    )
    return profile


@router.get("/api/chess/leaderboard", response_model=ChessLeaderboardResponse)
def chess_leaderboard(db: Session = Depends(get_db)) -> ChessLeaderboardResponse:
    response = chess_leaderboard_service.build_leaderboard(rating_repo=ChessRatingRepository(db))
    return response


@router.get("/api/chess/history", response_model=ChessHistoryResponse)
def chess_history(
    device_fingerprint: str = Query(min_length=8),
    db: Session = Depends(get_db),
) -> ChessHistoryResponse:
    actor = resolve_chess_actor(db, device_fingerprint=device_fingerprint)
    history = chess_history_service.build_history(employee_id=actor.employee_id, match_repo=ChessMatchRepository(db))
    log_employee_activity(
        db,
        employee_id=actor.employee_id,
        device_id=actor.device_id,
        action="CHESS_HISTORY_VIEWED",
        module="CHESS",
        event_type=EVENT_CHESS_HISTORY_VIEWED,
        entity_type="chess_history",
        entity_id=str(actor.employee_id),
    )
    return history


@router.post("/api/chess/matches", response_model=ChessMatchStateResponse)
def create_chess_match(payload: ChessCreateMatchRequest, db: Session = Depends(get_db)) -> ChessMatchStateResponse:
    actor = resolve_chess_actor(db, device_fingerprint=payload.device_fingerprint)
    return chess_match_service.create_match(db, actor=actor, payload=payload)


@router.post("/api/chess/matches/{match_id}/join", response_model=ChessMatchStateResponse)
def join_chess_match(match_id: int, payload: ChessJoinMatchRequest, db: Session = Depends(get_db)) -> ChessMatchStateResponse:
    actor = resolve_chess_actor(db, device_fingerprint=payload.device_fingerprint)
    return chess_match_service.join_match(db, actor=actor, match_id=match_id)


@router.get("/api/chess/matches/{match_id}", response_model=ChessMatchStateResponse)
def chess_match_state(match_id: int, device_fingerprint: str = Query(min_length=8), db: Session = Depends(get_db)) -> ChessMatchStateResponse:
    actor = resolve_chess_actor(db, device_fingerprint=device_fingerprint)
    return chess_match_service.get_match_state(db, actor=actor, match_id=match_id)


@router.post("/api/chess/matches/{match_id}/moves", response_model=ChessMatchStateResponse)
def chess_move_submit(match_id: int, payload: ChessMoveIntentRequest, db: Session = Depends(get_db)) -> ChessMatchStateResponse:
    actor = resolve_chess_actor(db, device_fingerprint=payload.device_fingerprint)
    return chess_match_service.submit_move(db, actor=actor, match_id=match_id, payload=payload)


@router.post("/api/chess/matches/{match_id}/draw-offer", response_model=ChessMatchStateResponse)
def chess_draw_offer(match_id: int, payload: ChessDrawOfferRequest, db: Session = Depends(get_db)) -> ChessMatchStateResponse:
    actor = resolve_chess_actor(db, device_fingerprint=payload.device_fingerprint)
    return chess_match_service.offer_draw(db, actor=actor, match_id=match_id)


@router.post("/api/chess/matches/{match_id}/draw-response", response_model=ChessMatchStateResponse)
def chess_draw_response(match_id: int, payload: ChessDrawResponseRequest, db: Session = Depends(get_db)) -> ChessMatchStateResponse:
    actor = resolve_chess_actor(db, device_fingerprint=payload.device_fingerprint)
    return chess_match_service.respond_draw(db, actor=actor, match_id=match_id, accept=payload.accept)


@router.post("/api/chess/matches/{match_id}/resign", response_model=ChessMatchStateResponse)
def chess_resign(match_id: int, payload: ChessResignRequest, db: Session = Depends(get_db)) -> ChessMatchStateResponse:
    actor = resolve_chess_actor(db, device_fingerprint=payload.device_fingerprint)
    return chess_match_service.resign(db, actor=actor, match_id=match_id)


@router.post("/api/chess/matchmaking/enqueue", response_model=ChessAckResponse)
def chess_matchmaking_enqueue(payload: ChessMatchmakingEnqueueRequest, db: Session = Depends(get_db)) -> ChessAckResponse:
    actor = resolve_chess_actor(db, device_fingerprint=payload.device_fingerprint)
    match_id, entry = chess_match_service.enqueue_matchmaking(db, actor=actor, payload=payload)
    return ChessAckResponse(ok=True, match_id=match_id, message=(f"Queue {entry.id} aktif." if match_id is None else "Rakip bulundu."))


@router.delete("/api/chess/matchmaking", response_model=ChessAckResponse)
def chess_matchmaking_cancel(device_fingerprint: str = Query(min_length=8), db: Session = Depends(get_db)) -> ChessAckResponse:
    actor = resolve_chess_actor(db, device_fingerprint=device_fingerprint)
    chess_match_service.cancel_matchmaking(db, actor=actor)
    return ChessAckResponse(ok=True, message="Queue iptal edildi.")


@router.websocket("/ws/chess/matches/{match_id}")
async def chess_match_socket(websocket: WebSocket, match_id: int) -> None:
    device_fingerprint = (websocket.query_params.get("device_fingerprint") or "").strip()
    if not device_fingerprint:
        await websocket.close(code=4401)
        return

    db = SessionLocal()
    try:
        actor = resolve_chess_actor(db, device_fingerprint=device_fingerprint)
        state = chess_match_service.get_match_state(db, actor=actor, match_id=match_id)
        await chess_realtime_gateway.connect(match_id=match_id, websocket=websocket)
        chess_match_service.mark_player_connection(db, actor=actor, match_id=match_id, is_connected=True)
        await chess_realtime_gateway.publish(
            match_id=match_id,
            event=ChessRealtimeEventType.SNAPSHOT,
            payload={"state": state.model_dump(mode="json")},
        )
        try:
            while True:
                message = await websocket.receive_text()
                if message.lower() == "ping":
                    await websocket.send_json({"event": "pong"})
        except WebSocketDisconnect:
            pass
    except ApiError as exc:
        await websocket.close(code=4403, reason=exc.message)
        return
    finally:
        try:
            db2 = SessionLocal()
            try:
                actor = resolve_chess_actor(db2, device_fingerprint=device_fingerprint)
                chess_match_service.mark_player_connection(db2, actor=actor, match_id=match_id, is_connected=False)
            finally:
                db2.close()
        except Exception:
            pass
        await chess_realtime_gateway.disconnect(match_id=match_id, websocket=websocket)
        db.close()
