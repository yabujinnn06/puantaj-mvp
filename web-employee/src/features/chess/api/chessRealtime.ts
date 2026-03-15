import type { ChessRealtimeEnvelope } from '../types'

function getWebSocketBase(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}`
}

export function connectChessMatchSocket(input: {
  matchId: number
  deviceFingerprint: string
  onEvent: (event: ChessRealtimeEnvelope) => void
  onClose?: () => void
}): WebSocket {
  const socket = new WebSocket(
    `${getWebSocketBase()}/ws/chess/matches/${input.matchId}?device_fingerprint=${encodeURIComponent(input.deviceFingerprint)}`,
  )

  socket.addEventListener('message', (message) => {
    try {
      const payload = JSON.parse(message.data) as ChessRealtimeEnvelope
      if (payload && typeof payload === 'object' && 'event' in payload) {
        input.onEvent(payload)
      }
    } catch {
      // Ignore malformed realtime messages.
    }
  })

  socket.addEventListener('close', () => {
    input.onClose?.()
  })

  return socket
}
