export type ChessMatchStatus = 'WAITING' | 'ACTIVE' | 'FINISHED' | 'ABANDONED'
export type ChessMatchType = 'CASUAL' | 'RATED' | 'AI'
export type ChessPlayerKind = 'HUMAN' | 'AI'
export type ChessResult = 'ONGOING' | 'WHITE_WIN' | 'BLACK_WIN' | 'DRAW'
export type ChessSide = 'w' | 'b'
export type ChessAIDifficulty = 'EASY' | 'MEDIUM' | 'HARD'
export type ChessRealtimeEventType =
  | 'player_joined'
  | 'player_left'
  | 'move_submitted'
  | 'move_accepted'
  | 'move_rejected'
  | 'game_ended'
  | 'draw_offered'
  | 'resign'
  | 'timeout'
  | 'snapshot'

export interface ChessPlayerProjection {
  match_player_id: number
  employee_id: number | null
  display_name: string
  player_kind: ChessPlayerKind
  side: ChessSide
  is_host: boolean
  is_connected: boolean
  online_status: string
  rating?: number | null
  peak_rating?: number | null
  streak?: number | null
  avatar_url?: string | null
}

export interface ChessLegalMove {
  from_square: string
  to_square: string
  san: string
  promotion?: string | null
}

export interface ChessMove {
  id: number
  ply_number: number
  san: string
  uci: string
  fen_after: string
  played_by_player_id?: number | null
  played_by_name?: string | null
  played_at: string
  think_time_ms: number
}

export interface ChessRating {
  current_rating: number
  peak_rating: number
  total_games: number
  wins: number
  losses: number
  draws: number
  streak: number
  last_rated_match_id?: number | null
}

export interface ChessRatingHistory {
  id: number
  match_id: number
  previous_rating: number
  new_rating: number
  delta: number
  result: ChessResult
  created_at: string
}

export interface ChessMatchSummary {
  id: number
  public_code: string
  status: ChessMatchStatus
  match_type: ChessMatchType
  result: ChessResult
  move_count: number
  white_player?: ChessPlayerProjection | null
  black_player?: ChessPlayerProjection | null
  created_at: string
  started_at?: string | null
  ended_at?: string | null
}

export interface ChessQueueEntry {
  id: number
  status: 'OPEN' | 'MATCHED' | 'CANCELED'
  match_type: ChessMatchType
  preferred_side?: ChessSide | null
  joined_at: string
  expires_at: string
  matched_match_id?: number | null
}

export interface ChessProfile {
  employee_id: number
  display_name: string
  last_seen_at?: string | null
  last_match_at?: string | null
  avatar_url?: string | null
  rating: ChessRating
  rating_history: ChessRatingHistory[]
  recent_matches: ChessMatchSummary[]
}

export interface ChessLeaderboardEntry {
  rank: number
  employee_id: number
  display_name: string
  current_rating: number
  peak_rating: number
  streak: number
  total_games: number
  wins: number
  losses: number
  draws: number
}

export interface ChessLobbyResponse {
  profile: ChessProfile
  waiting_matches: ChessMatchSummary[]
  active_matches: ChessMatchSummary[]
  leaderboard: ChessLeaderboardEntry[]
  queue_entry?: ChessQueueEntry | null
}

export interface ChessMatchState {
  match: ChessMatchSummary
  fen: string
  pgn: string
  turn: ChessSide
  you: ChessPlayerProjection
  players: ChessPlayerProjection[]
  moves: ChessMove[]
  legal_moves: ChessLegalMove[]
  draw_offer_by_side?: ChessSide | null
  white_clock_ms: number
  black_clock_ms: number
  result: ChessResult
  ended_reason?: string | null
}

export interface ChessHistoryResponse {
  items: ChessMatchSummary[]
}

export interface ChessLeaderboardResponse {
  items: ChessLeaderboardEntry[]
}

export interface ChessAckResponse {
  ok: boolean
  message?: string | null
  match_id?: number | null
}

export interface ChessRealtimeEnvelope {
  event: ChessRealtimeEventType
  emitted_at: string
  payload: {
    state?: ChessMatchState
  }
}

export interface BoardPiece {
  square: string
  type: 'p' | 'n' | 'b' | 'r' | 'q' | 'k'
  color: ChessSide
}
