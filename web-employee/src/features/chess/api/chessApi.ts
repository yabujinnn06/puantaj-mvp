import { apiClient } from '../../../api/client'
import type {
  ChessAckResponse,
  ChessAIDifficulty,
  ChessHistoryResponse,
  ChessLeaderboardResponse,
  ChessLobbyResponse,
  ChessMatchState,
  ChessMatchType,
  ChessSide,
  ChessProfile,
} from '../types'

function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error && 'response' in error) {
    const maybeResponse = (error as { response?: { data?: { detail?: string; message?: string } } }).response
    const detail = maybeResponse?.data?.detail ?? maybeResponse?.data?.message
    if (typeof detail === 'string' && detail.trim()) {
      return detail.trim()
    }
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }
  return fallback
}

export async function getChessLobby(deviceFingerprint: string): Promise<ChessLobbyResponse> {
  try {
    const response = await apiClient.get<ChessLobbyResponse>('/api/chess/lobby', {
      params: { device_fingerprint: deviceFingerprint },
    })
    return response.data
  } catch (error) {
    throw new Error(getErrorMessage(error, 'Satranç lobisi yüklenemedi.'))
  }
}

export async function getChessProfile(deviceFingerprint: string): Promise<ChessProfile> {
  try {
    const response = await apiClient.get<ChessProfile>('/api/chess/profile', {
      params: { device_fingerprint: deviceFingerprint },
    })
    return response.data
  } catch (error) {
    throw new Error(getErrorMessage(error, 'Profil yüklenemedi.'))
  }
}

export async function getChessHistory(deviceFingerprint: string): Promise<ChessHistoryResponse> {
  try {
    const response = await apiClient.get<ChessHistoryResponse>('/api/chess/history', {
      params: { device_fingerprint: deviceFingerprint },
    })
    return response.data
  } catch (error) {
    throw new Error(getErrorMessage(error, 'Maç geçmişi yüklenemedi.'))
  }
}

export async function getChessLeaderboard(): Promise<ChessLeaderboardResponse> {
  try {
    const response = await apiClient.get<ChessLeaderboardResponse>('/api/chess/leaderboard')
    return response.data
  } catch (error) {
    throw new Error(getErrorMessage(error, 'Leaderboard yüklenemedi.'))
  }
}

export async function createChessMatch(input: {
  device_fingerprint: string
  match_type: ChessMatchType
  opponent_mode: 'HUMAN' | 'AI'
  preferred_side?: ChessSide | null
  ai_difficulty?: ChessAIDifficulty
}): Promise<ChessMatchState> {
  try {
    const response = await apiClient.post<ChessMatchState>('/api/chess/matches', input)
    return response.data
  } catch (error) {
    throw new Error(getErrorMessage(error, 'Maç oluşturulamadı.'))
  }
}

export async function joinChessMatch(matchId: number, deviceFingerprint: string): Promise<ChessMatchState> {
  try {
    const response = await apiClient.post<ChessMatchState>(`/api/chess/matches/${matchId}/join`, {
      device_fingerprint: deviceFingerprint,
    })
    return response.data
  } catch (error) {
    throw new Error(getErrorMessage(error, 'Maça girilemedi.'))
  }
}

export async function getChessMatch(matchId: number, deviceFingerprint: string): Promise<ChessMatchState> {
  try {
    const response = await apiClient.get<ChessMatchState>(`/api/chess/matches/${matchId}`, {
      params: { device_fingerprint: deviceFingerprint },
    })
    return response.data
  } catch (error) {
    throw new Error(getErrorMessage(error, 'Maç durumu alınamadı.'))
  }
}

export async function submitChessMove(input: {
  matchId: number
  deviceFingerprint: string
  fromSquare: string
  toSquare: string
  promotion?: string | null
}): Promise<ChessMatchState> {
  try {
    const response = await apiClient.post<ChessMatchState>(`/api/chess/matches/${input.matchId}/moves`, {
      device_fingerprint: input.deviceFingerprint,
      from_square: input.fromSquare,
      to_square: input.toSquare,
      promotion: input.promotion ?? null,
    })
    return response.data
  } catch (error) {
    throw new Error(getErrorMessage(error, 'Hamle gönderilemedi.'))
  }
}

export async function offerChessDraw(matchId: number, deviceFingerprint: string): Promise<ChessMatchState> {
  try {
    const response = await apiClient.post<ChessMatchState>(`/api/chess/matches/${matchId}/draw-offer`, {
      device_fingerprint: deviceFingerprint,
    })
    return response.data
  } catch (error) {
    throw new Error(getErrorMessage(error, 'Beraberlik teklifi gönderilemedi.'))
  }
}

export async function respondChessDraw(matchId: number, deviceFingerprint: string, accept: boolean): Promise<ChessMatchState> {
  try {
    const response = await apiClient.post<ChessMatchState>(`/api/chess/matches/${matchId}/draw-response`, {
      device_fingerprint: deviceFingerprint,
      accept,
    })
    return response.data
  } catch (error) {
    throw new Error(getErrorMessage(error, 'Beraberlik yanıtı gönderilemedi.'))
  }
}

export async function resignChessMatch(matchId: number, deviceFingerprint: string): Promise<ChessMatchState> {
  try {
    const response = await apiClient.post<ChessMatchState>(`/api/chess/matches/${matchId}/resign`, {
      device_fingerprint: deviceFingerprint,
    })
    return response.data
  } catch (error) {
    throw new Error(getErrorMessage(error, 'Teslim işlemi başarısız oldu.'))
  }
}

export async function enqueueChessMatchmaking(input: {
  device_fingerprint: string
  match_type: ChessMatchType
  preferred_side?: ChessSide | null
}): Promise<ChessAckResponse> {
  try {
    const response = await apiClient.post<ChessAckResponse>('/api/chess/matchmaking/enqueue', input)
    return response.data
  } catch (error) {
    throw new Error(getErrorMessage(error, 'Matchmaking başlatılamadı.'))
  }
}

export async function cancelChessMatchmaking(deviceFingerprint: string): Promise<ChessAckResponse> {
  try {
    const response = await apiClient.delete<ChessAckResponse>('/api/chess/matchmaking', {
      params: { device_fingerprint: deviceFingerprint },
    })
    return response.data
  } catch (error) {
    throw new Error(getErrorMessage(error, 'Matchmaking iptal edilemedi.'))
  }
}
