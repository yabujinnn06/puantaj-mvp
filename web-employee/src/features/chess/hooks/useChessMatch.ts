import { useEffect, useState } from 'react'

import {
  getChessMatch,
  offerChessDraw,
  resignChessMatch,
  respondChessDraw,
  submitChessMove,
} from '../api/chessApi'
import { connectChessMatchSocket } from '../api/chessRealtime'
import type { ChessMatchState, ChessRealtimeEnvelope } from '../types'

export function useChessMatch(matchId: number | null, deviceFingerprint: string | null) {
  const [state, setState] = useState<ChessMatchState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!matchId || !deviceFingerprint) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void getChessMatch(matchId, deviceFingerprint)
      .then((nextState) => {
        if (!cancelled) {
          setState(nextState)
          setError(null)
        }
      })
      .catch((reason: Error) => {
        if (!cancelled) {
          setError(reason.message)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [deviceFingerprint, matchId])

  useEffect(() => {
    if (!matchId || !deviceFingerprint) {
      return
    }
    const socket = connectChessMatchSocket({
      matchId,
      deviceFingerprint,
      onEvent: (event: ChessRealtimeEnvelope) => {
        if (event.payload.state) {
          setState(event.payload.state)
          setError(null)
        }
      },
      onClose: () => undefined,
    })
    return () => {
      socket.close()
    }
  }, [deviceFingerprint, matchId])

  async function sendMove(input: { fromSquare: string; toSquare: string; promotion?: string | null }) {
    if (!matchId || !deviceFingerprint) {
      return
    }
    setError(null)
    try {
      const nextState = await submitChessMove({
        matchId,
        deviceFingerprint,
        fromSquare: input.fromSquare,
        toSquare: input.toSquare,
        promotion: input.promotion ?? null,
      })
      setState(nextState)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Hamle gönderilemedi.')
    }
  }

  async function requestDraw() {
    if (!matchId || !deviceFingerprint) {
      return
    }
    try {
      const nextState = await offerChessDraw(matchId, deviceFingerprint)
      setState(nextState)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Beraberlik teklifi gönderilemedi.')
    }
  }

  async function answerDraw(accept: boolean) {
    if (!matchId || !deviceFingerprint) {
      return
    }
    try {
      const nextState = await respondChessDraw(matchId, deviceFingerprint, accept)
      setState(nextState)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Beraberlik cevabı gönderilemedi.')
    }
  }

  async function resign() {
    if (!matchId || !deviceFingerprint) {
      return
    }
    try {
      const nextState = await resignChessMatch(matchId, deviceFingerprint)
      setState(nextState)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Teslim işlemi başarısız oldu.')
    }
  }

  return {
    state,
    loading,
    error,
    sendMove,
    requestDraw,
    answerDraw,
    resign,
  }
}
