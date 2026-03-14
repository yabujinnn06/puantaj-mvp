import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import {
  finishYabuBirdRun,
  getEmployeeYabuBirdOverview,
  joinYabuBirdLiveRoom,
  leaveYabuBirdLiveRoom,
  parseApiError,
  updateYabuBirdLiveState,
} from '../api/attendance'
import type {
  YabuBirdLeaderboardResponse,
  YabuBirdLiveStateResponse,
  YabuBirdPresence,
  YabuBirdRoom,
  YabuBirdScore,
} from '../types/api'
import { getStoredDeviceFingerprint } from '../utils/device'
import { getCurrentLocation, type CurrentLocation } from '../utils/location'

type JoinMode = 'PUBLIC' | 'HOST' | 'ROOM' | 'SOLO'
type Phase = 'menu' | 'joining' | 'ready' | 'playing' | 'crashed'
type DrawerView = 'leaderboard' | 'players' | 'tracking' | null

interface PipeSprite {
  index: number
  x: number
  gapTop: number
  gapBottom: number
}

interface EngineState {
  y: number
  velocity: number
  score: number
  flapCount: number
  elapsedMs: number
  alive: boolean
}

interface JoinIntent {
  mode: JoinMode
  roomCode?: string | null
}

const VIEW_WIDTH = 160
const VIEW_HEIGHT = 284
const FLOOR_HEIGHT = 36
const PLAY_HEIGHT = VIEW_HEIGHT - FLOOR_HEIGHT
const BIRD_X = 42
const BIRD_SIZE = 12
const BIRD_START_Y = 108
const GRAVITY = 640
const FLAP_VELOCITY = -185
const TERMINAL_VELOCITY = 210
const PIPE_SPEED = 72
const PIPE_WIDTH = 22
const PIPE_SPACING = 86
const PIPE_GAP = 66
const PIPE_START_X = VIEW_WIDTH + 32
const NETWORK_SYNC_MS = 320
const LOCATION_REFRESH_MS = 12000

const INITIAL_ENGINE: EngineState = {
  y: BIRD_START_Y,
  velocity: 0,
  score: 0,
  flapCount: 0,
  elapsedMs: 0,
  alive: false,
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function seededUnit(seed: number, index: number): number {
  const raw = Math.sin(seed * 0.00091 + index * 12.9898) * 43758.5453
  return raw - Math.floor(raw)
}

function getVisiblePipes(seed: number, elapsedMs: number): PipeSprite[] {
  const distance = (PIPE_SPEED * Math.max(0, elapsedMs)) / 1000
  const roughIndex = Math.floor((distance - PIPE_START_X) / PIPE_SPACING)
  const startIndex = Math.max(0, roughIndex - 1)
  const pipes: PipeSprite[] = []

  for (let index = startIndex; index < startIndex + 7; index += 1) {
    const x = PIPE_START_X + index * PIPE_SPACING - distance
    if (x > VIEW_WIDTH + 48 || x + PIPE_WIDTH < -48) {
      continue
    }
    const gapCenter = 64 + seededUnit(seed, index) * Math.max(0, PLAY_HEIGHT - 122)
    const gapTop = clamp(gapCenter - PIPE_GAP / 2, 24, PLAY_HEIGHT - PIPE_GAP - 20)
    pipes.push({
      index,
      x,
      gapTop,
      gapBottom: Math.max(20, PLAY_HEIGHT - (gapTop + PIPE_GAP)),
    })
  }

  return pipes
}

function getLastPassedPipeIndex(elapsedMs: number): number {
  const distance = (PIPE_SPEED * Math.max(0, elapsedMs)) / 1000
  return Math.floor((distance + BIRD_X - PIPE_START_X - PIPE_WIDTH) / PIPE_SPACING)
}

function formatClock(value: string | null | undefined): string {
  if (!value) {
    return '-'
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return '-'
  }
  return new Intl.DateTimeFormat('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(parsed)
}

function formatDuration(ms: number): string {
  if (ms <= 0) {
    return '0.0 sn'
  }
  return `${(ms / 1000).toFixed(1)} sn`
}

function formatCoords(location: CurrentLocation | null): string {
  if (!location) {
    return 'Konum yok'
  }
  return `${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}`
}

function buildLocationPayload(location: CurrentLocation | null): {
  lat?: number
  lon?: number
  accuracy_m?: number | null
} {
  if (!location) {
    return {}
  }
  return {
    lat: location.lat,
    lon: location.lon,
    accuracy_m: location.accuracy_m,
  }
}

function drawBird(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, wingFrame: number): void {
  ctx.fillStyle = color
  ctx.fillRect(Math.round(x + 2), Math.round(y + 3), 8, 6)
  ctx.fillStyle = '#111827'
  ctx.fillRect(Math.round(x + 8), Math.round(y + 4), 1, 1)
  ctx.fillStyle = '#f97316'
  ctx.fillRect(Math.round(x + 10), Math.round(y + 5), 2, 1)
  ctx.fillStyle = '#111827'
  ctx.fillRect(Math.round(x + 3), Math.round(y + 5 + wingFrame), 4, 2)
}

function drawPipe(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
  ctx.fillStyle = '#163b22'
  ctx.fillRect(Math.round(x), Math.round(y), width, Math.round(height))
  ctx.fillStyle = '#3ddc84'
  ctx.fillRect(Math.round(x + 2), Math.round(y), width - 4, Math.round(height))
  ctx.fillStyle = '#6df6ad'
  ctx.fillRect(Math.round(x + 4), Math.round(y), 2, Math.round(height))
}

export function YabuBirdPage() {
  const navigate = useNavigate()
  const [deviceFingerprint] = useState<string | null>(() => getStoredDeviceFingerprint())
  const [phase, setPhase] = useState<Phase>('menu')
  const [drawerView, setDrawerView] = useState<DrawerView>(null)
  const [menuPublicRoom, setMenuPublicRoom] = useState<YabuBirdRoom | null>(null)
  const [menuPublicPlayers, setMenuPublicPlayers] = useState<YabuBirdPresence[]>([])
  const [room, setRoom] = useState<YabuBirdRoom | null>(null)
  const [you, setYou] = useState<YabuBirdPresence | null>(null)
  const [players, setPlayers] = useState<YabuBirdPresence[]>([])
  const [leaderboard, setLeaderboard] = useState<YabuBirdScore[]>([])
  const [personalBest, setPersonalBest] = useState(0)
  const [scoreLabel, setScoreLabel] = useState(0)
  const [elapsedLabel, setElapsedLabel] = useState(0)
  const [joinCode, setJoinCode] = useState('')
  const [statusMessage, setStatusMessage] = useState('Oda sec, ekranin her yerine dokun ve ucmaya basla.')
  const [locationMessage, setLocationMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const phaseRef = useRef<Phase>('menu')
  const menuRoomRef = useRef<YabuBirdRoom | null>(null)
  const menuPlayersRef = useRef<YabuBirdPresence[]>([])
  const roomRef = useRef<YabuBirdRoom | null>(null)
  const presenceRef = useRef<YabuBirdPresence | null>(null)
  const playersRef = useRef<YabuBirdPresence[]>([])
  const engineRef = useRef<EngineState>(INITIAL_ENGINE)
  const frameTimeRef = useRef<number | null>(null)
  const hudCommitRef = useRef(0)
  const scoreLabelRef = useRef(0)
  const elapsedLabelRef = useRef(0)
  const syncInFlightRef = useRef(false)
  const finishInFlightRef = useRef(false)
  const leaveInFlightRef = useRef(false)
  const joinIntentRef = useRef<JoinIntent | null>(null)
  const locationRef = useRef<CurrentLocation | null>(null)

  const playerList = useMemo(
    () => (phase === 'menu' ? menuPublicPlayers : players),
    [menuPublicPlayers, phase, players],
  )

  function resetEngine(): void {
    engineRef.current = { ...INITIAL_ENGINE, y: BIRD_START_Y }
    frameTimeRef.current = null
    setScoreLabel(0)
    setElapsedLabel(0)
    scoreLabelRef.current = 0
    elapsedLabelRef.current = 0
  }

  function applyOverview(overview: YabuBirdLeaderboardResponse): void {
    setMenuPublicRoom(overview.live_room)
    setMenuPublicPlayers(overview.live_players)
    menuRoomRef.current = overview.live_room
    menuPlayersRef.current = overview.live_players
    setLeaderboard(overview.leaderboard)
    setPersonalBest(overview.personal_best)
  }

  function applyLiveState(state: YabuBirdLiveStateResponse): void {
    setRoom(state.room)
    setYou(state.you)
    setPlayers(state.players)
    playersRef.current = state.players
    setLeaderboard(state.leaderboard)
    setPersonalBest(state.personal_best)
    roomRef.current = state.room
    presenceRef.current = state.you
  }

  async function refreshLocation(silent = false): Promise<void> {
    const result = await getCurrentLocation(4500)
    locationRef.current = result.location
    if (result.warning) {
      setLocationMessage(result.warning)
      if (!silent) {
        setStatusMessage(result.warning)
      }
      return
    }
    if (result.location) {
      setLocationMessage(`Son konum ${formatCoords(result.location)}`)
    }
  }

  async function refreshOverview(silent = false): Promise<void> {
    if (!deviceFingerprint) {
      return
    }
    try {
      const overview = await getEmployeeYabuBirdOverview(deviceFingerprint)
      applyOverview(overview)
      if (!silent) {
        setErrorMessage(null)
      }
    } catch (error) {
      if (!silent) {
        setErrorMessage(parseApiError(error, 'YabuBird verileri alinamadi.').message)
      }
    }
  }

  async function enterRoom(intent: JoinIntent): Promise<void> {
    if (!deviceFingerprint || phaseRef.current === 'joining') {
      return
    }
    setDrawerView(null)
    setErrorMessage(null)
    setStatusMessage('Oda hazirlaniyor...')
    setPhase('joining')
    phaseRef.current = 'joining'
    resetEngine()
    await refreshLocation(true)
    try {
      const state = await joinYabuBirdLiveRoom({
        device_fingerprint: deviceFingerprint,
        mode: intent.mode,
        room_code: intent.roomCode ?? null,
        ...buildLocationPayload(locationRef.current),
      })
      applyLiveState(state)
      joinIntentRef.current =
        intent.mode === 'HOST' && state.room.share_code
          ? { mode: 'ROOM', roomCode: state.room.share_code }
          : intent
      setPhase('ready')
      phaseRef.current = 'ready'
      setStatusMessage(
        state.room.share_code
          ? `Server kodu ${state.room.share_code}. Ekrana dokun ve uc.`
          : 'Tur hazir. Ekrana dokun ve uc.',
      )
    } catch (error) {
      const parsed = parseApiError(error, 'Odaya baglanilamadi.')
      setPhase('menu')
      phaseRef.current = 'menu'
      setErrorMessage(parsed.message)
      setStatusMessage('Baglanti kurulamadigi icin oda acilamadi.')
    }
  }

  async function finishRun(snapshot: EngineState): Promise<void> {
    const currentRoom = roomRef.current
    const currentPresence = presenceRef.current
    if (!deviceFingerprint || !currentRoom || !currentPresence || finishInFlightRef.current) {
      return
    }
    finishInFlightRef.current = true
    setPhase('crashed')
    phaseRef.current = 'crashed'
    setStatusMessage(`Tur bitti. Skor ${snapshot.score}.`)
    window.navigator.vibrate?.(90)
    try {
      const overview = await finishYabuBirdRun({
        device_fingerprint: deviceFingerprint,
        room_id: currentRoom.id,
        presence_id: currentPresence.id,
        score: snapshot.score,
        survived_ms: snapshot.elapsedMs,
        ...buildLocationPayload(locationRef.current),
      })
      presenceRef.current = null
      setYou(null)
      applyOverview(overview)
      setPersonalBest((value) => Math.max(value, snapshot.score, overview.personal_best))
    } catch (error) {
      setErrorMessage(parseApiError(error, 'Skor kaydedilemedi.').message)
    } finally {
      finishInFlightRef.current = false
    }
  }

  async function leaveRoom(returnHome = false, silent = false): Promise<void> {
    const currentRoom = roomRef.current
    const currentPresence = presenceRef.current
    if (!deviceFingerprint || !currentRoom || !currentPresence || leaveInFlightRef.current) {
      if (returnHome) {
        navigate('/')
      }
      return
    }
    leaveInFlightRef.current = true
    try {
      const overview = await leaveYabuBirdLiveRoom({
        device_fingerprint: deviceFingerprint,
        room_id: currentRoom.id,
        presence_id: currentPresence.id,
        ...buildLocationPayload(locationRef.current),
      })
      presenceRef.current = null
      setYou(null)
      applyOverview(overview)
      if (!silent) {
        setStatusMessage('Odadan cikildi.')
      }
    } catch (error) {
      if (!silent) {
        setErrorMessage(parseApiError(error, 'Odadan cikilamadi.').message)
      }
    } finally {
      leaveInFlightRef.current = false
      if (returnHome) {
        navigate('/')
      }
    }
  }

  function startRun(withOpeningFlap: boolean): void {
    engineRef.current = {
      y: BIRD_START_Y,
      velocity: withOpeningFlap ? FLAP_VELOCITY : 0,
      score: 0,
      flapCount: withOpeningFlap ? 1 : 0,
      elapsedMs: 0,
      alive: true,
    }
    frameTimeRef.current = null
    setScoreLabel(0)
    setElapsedLabel(0)
    scoreLabelRef.current = 0
    elapsedLabelRef.current = 0
    setPhase('playing')
    phaseRef.current = 'playing'
    setStatusMessage('Ucus basladi. Ekranin her yerine dokun.')
  }

  function flap(): void {
    if (phaseRef.current === 'ready') {
      startRun(true)
      return
    }
    if (phaseRef.current !== 'playing') {
      return
    }
    engineRef.current = {
      ...engineRef.current,
      velocity: FLAP_VELOCITY,
      flapCount: engineRef.current.flapCount + 1,
    }
  }

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  useEffect(() => {
    roomRef.current = room
  }, [room])

  useEffect(() => {
    presenceRef.current = you
  }, [you])

  useEffect(() => {
    menuRoomRef.current = menuPublicRoom
  }, [menuPublicRoom])

  useEffect(() => {
    menuPlayersRef.current = menuPublicPlayers
  }, [menuPublicPlayers])

  useEffect(() => {
    playersRef.current = players
  }, [players])

  useEffect(() => {
    resetEngine()
    void refreshLocation(true)
    void refreshOverview()
  }, [])

  useEffect(() => {
    if (phase !== 'menu') {
      return undefined
    }
    const intervalId = window.setInterval(() => {
      void refreshOverview(true)
    }, 9000)
    return () => {
      window.clearInterval(intervalId)
    }
  }, [deviceFingerprint, phase])

  useEffect(() => {
    if (phase !== 'ready' && phase !== 'playing') {
      return undefined
    }
    const intervalId = window.setInterval(() => {
      void refreshLocation(true)
    }, LOCATION_REFRESH_MS)
    return () => {
      window.clearInterval(intervalId)
    }
  }, [phase])

  useEffect(() => {
    if (!deviceFingerprint || !room || !you || (phase !== 'ready' && phase !== 'playing')) {
      return undefined
    }
    const intervalId = window.setInterval(() => {
      if (syncInFlightRef.current || finishInFlightRef.current) {
        return
      }
      syncInFlightRef.current = true
      const snapshot = engineRef.current
      void updateYabuBirdLiveState({
        device_fingerprint: deviceFingerprint,
        room_id: room.id,
        presence_id: you.id,
        y: snapshot.y,
        velocity: snapshot.velocity,
        score: snapshot.score,
        flap_count: snapshot.flapCount,
        is_alive: phaseRef.current === 'playing' ? snapshot.alive : true,
        ...buildLocationPayload(locationRef.current),
      })
        .then((state) => {
          if (phaseRef.current === 'ready' || phaseRef.current === 'playing') {
            applyLiveState(state)
          }
        })
        .catch((error) => {
          const parsed = parseApiError(error, 'Canli senkronizasyon koptu.')
          if (parsed.code === 'YABUBIRD_ROOM_CLOSED' || parsed.code === 'YABUBIRD_ROOM_NOT_FOUND') {
            setPhase('menu')
            phaseRef.current = 'menu'
            setYou(null)
            setRoom(null)
            setErrorMessage(parsed.message)
            void refreshOverview(true)
            return
          }
          setErrorMessage(parsed.message)
        })
        .finally(() => {
          syncInFlightRef.current = false
        })
    }, NETWORK_SYNC_MS)
    return () => {
      window.clearInterval(intervalId)
    }
  }, [deviceFingerprint, phase, room, you])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.code !== 'ArrowUp') {
        return
      }
      event.preventDefault()
      flap()
    }
    const handlePageHide = () => {
      if (presenceRef.current && roomRef.current) {
        void leaveRoom(false, true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('pagehide', handlePageHide)
      if (presenceRef.current && roomRef.current) {
        void leaveRoom(false, true)
      }
    }
  }, [deviceFingerprint])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) {
      return
    }
    const pixelRatio = Math.max(1, Math.floor(window.devicePixelRatio || 1))
    const resizeCanvas = () => {
      canvas.width = VIEW_WIDTH * pixelRatio
      canvas.height = VIEW_HEIGHT * pixelRatio
    }
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)

    let animationFrame = 0
    const tick = (time: number) => {
      if (phaseRef.current === 'playing' && roomRef.current) {
        if (frameTimeRef.current === null) {
          frameTimeRef.current = time
        }
        const deltaMs = Math.min(34, time - frameTimeRef.current)
        frameTimeRef.current = time
        const nextVelocity = clamp(
          engineRef.current.velocity + (GRAVITY * deltaMs) / 1000,
          -260,
          TERMINAL_VELOCITY,
        )
        const nextElapsedMs = engineRef.current.elapsedMs + deltaMs
        const nextY = engineRef.current.y + (nextVelocity * deltaMs) / 1000
        let nextScore = engineRef.current.score

        const lastPassedIndex = getLastPassedPipeIndex(nextElapsedMs)
        const previousPassedIndex = getLastPassedPipeIndex(engineRef.current.elapsedMs)
        if (lastPassedIndex > previousPassedIndex) {
          nextScore += lastPassedIndex - previousPassedIndex
        }

        const clampedY = clamp(nextY, -8, PLAY_HEIGHT - BIRD_SIZE)
        let crashed = clampedY + BIRD_SIZE >= PLAY_HEIGHT || clampedY <= -2
        if (!crashed) {
          crashed = getVisiblePipes(roomRef.current.seed, nextElapsedMs).some((pipe) => {
            const birdLeft = BIRD_X
            const birdRight = BIRD_X + BIRD_SIZE
            const birdTop = clampedY
            const birdBottom = clampedY + BIRD_SIZE
            const pipeLeft = pipe.x
            const pipeRight = pipe.x + PIPE_WIDTH
            if (birdRight <= pipeLeft || birdLeft >= pipeRight) {
              return false
            }
            const gapBottomStart = PLAY_HEIGHT - pipe.gapBottom
            return birdTop <= pipe.gapTop || birdBottom >= gapBottomStart
          })
        }

        engineRef.current = {
          y: clampedY,
          velocity: nextVelocity,
          score: nextScore,
          flapCount: engineRef.current.flapCount,
          elapsedMs: nextElapsedMs,
          alive: !crashed,
        }

        if (time - hudCommitRef.current > 80 || nextScore !== scoreLabelRef.current) {
          hudCommitRef.current = time
          scoreLabelRef.current = nextScore
          elapsedLabelRef.current = nextElapsedMs
          setScoreLabel(nextScore)
          setElapsedLabel(nextElapsedMs)
        }
        if (crashed) {
          void finishRun(engineRef.current)
        }
      } else {
        frameTimeRef.current = null
      }

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      context.imageSmoothingEnabled = false
      context.clearRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT)
      context.fillStyle = '#06111d'
      context.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT)
      context.fillStyle = '#10233a'
      context.fillRect(0, 0, VIEW_WIDTH, 96)
      context.fillStyle = '#173759'
      context.fillRect(0, 96, VIEW_WIDTH, 70)
      context.fillStyle = '#23455f'
      context.fillRect(0, 166, VIEW_WIDTH, PLAY_HEIGHT - 166)
      context.fillStyle = '#f8fafc'
      for (let index = 0; index < 18; index += 1) {
        context.fillRect(
          Math.floor(seededUnit(88, index) * VIEW_WIDTH),
          Math.floor(seededUnit(133, index) * 72),
          1,
          1,
        )
      }
      context.fillStyle = '#bfe6ff'
      context.fillRect(118, 28, 18, 18)
      context.fillStyle = '#7dd3fc'
      context.fillRect(122, 32, 10, 10)

      const farScroll = Math.floor((time * 0.006) % 48)
      const nearScroll = Math.floor((time * 0.014) % 64)
      context.fillStyle = '#0f1d31'
      for (let x = -48; x < VIEW_WIDTH + 48; x += 24) {
        const baseX = x - farScroll
        context.fillRect(baseX, 144, 8, 22)
        context.fillRect(baseX + 8, 136, 8, 30)
        context.fillRect(baseX + 16, 148, 8, 18)
      }
      context.fillStyle = '#13263c'
      for (let x = -64; x < VIEW_WIDTH + 64; x += 32) {
        const baseX = x - nearScroll
        context.fillRect(baseX, 172, 12, 32)
        context.fillRect(baseX + 12, 164, 12, 40)
        context.fillRect(baseX + 24, 176, 8, 28)
      }

      const renderRoom = roomRef.current ?? menuRoomRef.current
      if (renderRoom) {
        for (const pipe of getVisiblePipes(renderRoom.seed, engineRef.current.elapsedMs)) {
          drawPipe(context, pipe.x, 0, PIPE_WIDTH, pipe.gapTop)
          drawPipe(context, pipe.x, PLAY_HEIGHT - pipe.gapBottom, PIPE_WIDTH, pipe.gapBottom)
        }
      }

      context.fillStyle = '#2b4f2d'
      context.fillRect(0, PLAY_HEIGHT, VIEW_WIDTH, FLOOR_HEIGHT)
      context.fillStyle = '#78d671'
      context.fillRect(0, PLAY_HEIGHT, VIEW_WIDTH, 5)
      for (let x = -24; x < VIEW_WIDTH + 24; x += 12) {
        const tileX = x - Math.floor((time * 0.05) % 12)
        context.fillStyle = '#6f5238'
        context.fillRect(tileX, PLAY_HEIGHT + 6, 8, 12)
        context.fillStyle = '#8f6b4a'
        context.fillRect(tileX + 1, PLAY_HEIGHT + 7, 6, 10)
      }

      const renderedPlayers = (phaseRef.current === 'menu' ? menuPlayersRef.current : playersRef.current)
      renderedPlayers
        .filter((player) => player.id !== presenceRef.current?.id && player.is_connected)
        .slice(0, 5)
        .forEach((player, index) => {
          drawBird(context, VIEW_WIDTH - 28 - index * 14, clamp(player.latest_y, 12, PLAY_HEIGHT - 20), player.color_hex, index % 3)
        })

      const idleBob = phaseRef.current === 'playing' ? 0 : Math.sin(time / 260) * 2
      const wingFrame = phaseRef.current === 'playing' ? Math.floor(time / 90) % 3 : Math.floor(time / 180) % 3
      drawBird(context, BIRD_X, engineRef.current.y + idleBob, '#ffd84d', wingFrame)

      context.font = '8px monospace'
      context.fillStyle = '#e2e8f0'
      context.fillText(`SCORE ${engineRef.current.score}`, 8, 12)
      context.fillText(`TIME ${Math.floor(engineRef.current.elapsedMs / 1000)}S`, 8, 22)
      if (renderRoom?.share_code) {
        context.fillText(`CODE ${renderRoom.share_code}`, VIEW_WIDTH - 58, 12)
      }

      animationFrame = window.requestAnimationFrame(tick)
    }

    animationFrame = window.requestAnimationFrame(tick)
    return () => {
      window.cancelAnimationFrame(animationFrame)
      window.removeEventListener('resize', resizeCanvas)
    }
  }, [])

  const roomLine = room
    ? `${room.room_label}${room.share_code ? ` / ${room.share_code}` : ''}`
    : menuPublicRoom
      ? `${menuPublicRoom.room_label} / ${menuPublicRoom.player_count} aktif`
      : 'Oda secimi bekleniyor'

  return (
    <main className="yabubird-arcade-page">
      <section className="yabubird-arcade-shell">
        <header className="yabubird-arcade-topbar">
          <div>
            <p className="yabubird-arcade-kicker">YABUBIRD PIXEL TRACKER</p>
            <h1>Canli oda, tam ekran ucus, konum odakli takip.</h1>
          </div>
          <div className="yabubird-arcade-topbar-actions">
            <button type="button" className="yabubird-chip-btn" onClick={() => setDrawerView('leaderboard')}>
              Leaderboard
            </button>
            <button type="button" className="yabubird-chip-btn" onClick={() => setDrawerView('players')}>
              Oyuncular
            </button>
            <button type="button" className="yabubird-chip-btn" onClick={() => setDrawerView('tracking')}>
              Konum
            </button>
            <button
              type="button"
              className="yabubird-exit-btn"
              onClick={() => {
                if (presenceRef.current && roomRef.current) {
                  void leaveRoom(true)
                  return
                }
                navigate('/')
              }}
            >
              Cik
            </button>
          </div>
        </header>

        {!deviceFingerprint ? (
          <div className="yabubird-arcade-warning">
            <p>Bu cihaz bir calisana bagli degil. Once employee uygulamasina baglanmasi gerekiyor.</p>
            <Link to="/">Ana sayfaya don</Link>
          </div>
        ) : null}

        {errorMessage ? <div className="yabubird-arcade-banner yabubird-arcade-banner-error">{errorMessage}</div> : null}
        <div className="yabubird-arcade-banner">{statusMessage}</div>
        {locationMessage ? <div className="yabubird-arcade-banner yabubird-arcade-banner-soft">{locationMessage}</div> : null}

        <section className="yabubird-arcade-stage-wrap">
          <div
            className={`yabubird-arcade-stage ${phase === 'playing' ? 'is-active' : ''}`}
            role="button"
            tabIndex={0}
            aria-label="YabuBird piksel oyun alani"
            onClick={() => flap()}
            onKeyDown={(event) => {
              if (event.key === ' ' || event.key === 'Enter' || event.key === 'ArrowUp') {
                event.preventDefault()
                flap()
              }
            }}
          >
            <canvas ref={canvasRef} className="yabubird-arcade-canvas" />

            <div className="yabubird-arcade-hud">
              <div className="yabubird-arcade-hud-pill">
                <span>Skor</span>
                <strong>{scoreLabel}</strong>
              </div>
              <div className="yabubird-arcade-hud-pill">
                <span>Sure</span>
                <strong>{formatDuration(elapsedLabel)}</strong>
              </div>
              <div className="yabubird-arcade-hud-pill">
                <span>Oda</span>
                <strong>{room?.room_type ?? menuPublicRoom?.room_type ?? '-'}</strong>
              </div>
            </div>

            {(phase === 'menu' || phase === 'joining' || phase === 'ready' || phase === 'crashed') && (
              <div className="yabubird-arcade-overlay">
                <div className="yabubird-arcade-panel">
                  {phase === 'menu' ? (
                    <>
                      <p className="yabubird-arcade-panel-kicker">Oyun modu sec</p>
                      <h2>Kart degil, tam ekran piksel arena.</h2>
                      <p>Tek oyna, beraber oyna ya da server kodu ac. Her yer dokunmatik flap alani.</p>
                      <div className="yabubird-arcade-mode-grid">
                        <button type="button" className="yabubird-mode-card" onClick={() => void enterRoom({ mode: 'SOLO' })}>
                          <strong>Tek Oyna</strong>
                          <span>Kendi akisin ve kendi skorun.</span>
                        </button>
                        <button type="button" className="yabubird-mode-card" onClick={() => void enterRoom({ mode: 'PUBLIC' })}>
                          <strong>Beraber Oyna</strong>
                          <span>Public odada diger calisanlarla yarisa gir.</span>
                        </button>
                        <button type="button" className="yabubird-mode-card" onClick={() => void enterRoom({ mode: 'HOST' })}>
                          <strong>Server Ac</strong>
                          <span>Kod uret, odayi sen kur.</span>
                        </button>
                      </div>
                      <div className="yabubird-join-box">
                        <input
                          value={joinCode}
                          onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                          placeholder="SERVER KODU"
                          maxLength={12}
                        />
                        <button
                          type="button"
                          className="yabubird-mode-inline-btn"
                          disabled={joinCode.trim().length < 4}
                          onClick={() => void enterRoom({ mode: 'ROOM', roomCode: joinCode.trim() })}
                        >
                          Koda Gir
                        </button>
                      </div>
                      <div className="yabubird-arcade-meta-line">
                        <span>Public oda: {menuPublicRoom?.player_count ?? 0} oyuncu</span>
                        <span>En iyi skor: {personalBest}</span>
                      </div>
                    </>
                  ) : null}

                  {phase === 'joining' ? (
                    <>
                      <p className="yabubird-arcade-panel-kicker">Baglaniyor</p>
                      <h2>Oda aciliyor...</h2>
                      <p>Canli kanal ve konum akisi hazirlaniyor.</p>
                    </>
                  ) : null}

                  {phase === 'ready' ? (
                    <>
                      <p className="yabubird-arcade-panel-kicker">{room?.room_label ?? 'Hazir'}</p>
                      <h2>{room?.share_code ? `Server kodu ${room.share_code}` : 'Ucus hazir'}</h2>
                      <p>Ekrana dokun ve basla. Cik butonu oyun icinde de calisir.</p>
                      <div className="yabubird-arcade-ready-actions">
                        <button type="button" className="yabubird-mode-inline-btn is-primary" onClick={() => startRun(true)}>
                          Basla
                        </button>
                        <button type="button" className="yabubird-mode-inline-btn" onClick={() => void leaveRoom(false)}>
                          Odayi Kapat
                        </button>
                      </div>
                    </>
                  ) : null}

                  {phase === 'crashed' ? (
                    <>
                      <p className="yabubird-arcade-panel-kicker">Tur bitti</p>
                      <h2>Skor {scoreLabel}</h2>
                      <p>Oda bilgisi: {roomLine}. Tekrar oyna dersen ayni moda geri baglaniriz.</p>
                      <div className="yabubird-arcade-ready-actions">
                        <button
                          type="button"
                          className="yabubird-mode-inline-btn is-primary"
                          onClick={() => void enterRoom(joinIntentRef.current ?? { mode: 'PUBLIC' })}
                        >
                          Tekrar Oyna
                        </button>
                        <button type="button" className="yabubird-mode-inline-btn" onClick={() => navigate('/')}>
                          Uygulamaya Don
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            )}

            {phase === 'playing' ? <div className="yabubird-touch-tip">Dokun, birak, tekrar dokun. Her dokunus bir flap.</div> : null}
          </div>

          <div className="yabubird-arcade-status-row">
            <div className="yabubird-arcade-status-card">
              <span>Aktif oda</span>
              <strong>{roomLine}</strong>
            </div>
            <div className="yabubird-arcade-status-card">
              <span>Canli oyuncu</span>
              <strong>{playerList.length}</strong>
            </div>
            <div className="yabubird-arcade-status-card">
              <span>Son konum</span>
              <strong>{formatCoords(locationRef.current)}</strong>
            </div>
          </div>
        </section>

        <section className={`yabubird-arcade-drawer ${drawerView ? 'is-open' : ''}`}>
          <div className="yabubird-arcade-drawer-head">
            <strong>
              {drawerView === 'leaderboard'
                ? 'Leaderboard'
                : drawerView === 'players'
                  ? 'Canli Oyuncular'
                  : 'Konum ve Takip'}
            </strong>
            <button type="button" onClick={() => setDrawerView(null)}>
              Kapat
            </button>
          </div>

          {drawerView === 'leaderboard' ? (
            <div className="yabubird-drawer-list">
              {leaderboard.length === 0 ? (
                <p className="yabubird-empty-copy">Henuz skor kaydi yok.</p>
              ) : (
                leaderboard.map((entry, index) => (
                  <div key={entry.id} className="yabubird-drawer-row">
                    <div>
                      <p>#{index + 1} {entry.employee_name}</p>
                      <span>{entry.room_label ?? 'Oda yok'} / {formatClock(entry.created_at)}</span>
                    </div>
                    <strong>{entry.score}</strong>
                  </div>
                ))
              )}
            </div>
          ) : null}

          {drawerView === 'players' ? (
            <div className="yabubird-drawer-list">
              {playerList.length === 0 ? (
                <p className="yabubird-empty-copy">Su an canli oyuncu yok.</p>
              ) : (
                playerList.map((player) => (
                  <div key={player.id} className="yabubird-drawer-row">
                    <div>
                      <p>{player.employee_name}{player.id === you?.id ? ' (Sen)' : ''}</p>
                      <span>{player.room_label ?? 'Oda'} / son gorulme {formatClock(player.last_seen_at)}</span>
                    </div>
                    <strong>{player.latest_score}</strong>
                  </div>
                ))
              )}
            </div>
          ) : null}

          {drawerView === 'tracking' ? (
            <div className="yabubird-drawer-list">
              <div className="yabubird-drawer-row">
                <div>
                  <p>Bu cihazin son konumu</p>
                  <span>{locationRef.current ? `${locationRef.current.accuracy_m.toFixed(0)}m hassasiyet` : 'Konum izni bekleniyor'}</span>
                </div>
                <strong>{formatCoords(locationRef.current)}</strong>
              </div>
              <div className="yabubird-drawer-row">
                <div>
                  <p>Public oda durumu</p>
                  <span>{menuPublicRoom?.room_label ?? 'Acik public oda yok'}</span>
                </div>
                <strong>{menuPublicRoom?.player_count ?? 0}</strong>
              </div>
              <p className="yabubird-empty-copy">
                Admin panelinde canli oyun konumu, son oynayanlarin son konumu ve uygulama giris konumlari saat saat gorunecek.
              </p>
            </div>
          ) : null}
        </section>
      </section>
    </main>
  )
}
