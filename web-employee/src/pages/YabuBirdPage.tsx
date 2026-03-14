import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  finishYabuBirdRun,
  getEmployeeYabuBirdOverview,
  joinYabuBirdLiveRoom,
  leaveYabuBirdLiveRoom,
  parseApiError,
  postEmployeeAppPresencePing,
  reactYabuBirdLiveRoom,
  updateYabuBirdLiveState,
} from '../api/attendance'
import type {
  YabuBirdLeaderboardResponse,
  YabuBirdLiveStateResponse,
  YabuBirdPresence,
  YabuBirdReaction,
  YabuBirdRoom,
  YabuBirdScore,
} from '../types/api'
import { getStoredDeviceFingerprint } from '../utils/device'
import { getCurrentLocation, type CurrentLocation } from '../utils/location'

type JoinMode = 'PUBLIC' | 'HOST' | 'ROOM' | 'SOLO'
type Phase = 'menu' | 'joining' | 'ready' | 'playing' | 'crashed'
type DrawerView = 'leaderboard' | 'players' | 'rooms' | null

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

interface WorldTheme {
  name: string
  skyTop: string
  skyMid: string
  skyBottom: string
  star: string
  celestial: string
  far: string
  near: string
  pipeDark: string
  pipeMain: string
  pipeGlow: string
  groundDark: string
  groundMain: string
  grass: string
  accent: string
}

const VIEW_WIDTH = 160
const VIEW_HEIGHT = 284
const FLOOR_HEIGHT = 36
const PLAY_HEIGHT = VIEW_HEIGHT - FLOOR_HEIGHT
const BIRD_X = 42
const BIRD_SIZE = 12
const BIRD_START_Y = 104
const GRAVITY = 630
const FLAP_VELOCITY = -196
const TERMINAL_VELOCITY = 214
const PIPE_SPEED = 68
const PIPE_WIDTH = 22
const PIPE_SPACING = 94
const PIPE_GAP = 80
const PIPE_START_X = VIEW_WIDTH + 32
const NETWORK_SYNC_MS = 260
const LOCATION_REFRESH_MS = 12000
const REACTION_EMOJIS = ['😀', '😂', '😎', '😭', '👏', '🔥', '👍', '😡'] as const

const INITIAL_ENGINE: EngineState = {
  y: BIRD_START_Y,
  velocity: 0,
  score: 0,
  flapCount: 0,
  elapsedMs: 0,
  alive: false,
}

const WORLD_THEMES: WorldTheme[] = [
  {
    name: 'Neon Sehir',
    skyTop: '#06111d',
    skyMid: '#10233a',
    skyBottom: '#173759',
    star: '#eff6ff',
    celestial: '#7dd3fc',
    far: '#0f1d31',
    near: '#13263c',
    pipeDark: '#163b22',
    pipeMain: '#3ddc84',
    pipeGlow: '#6df6ad',
    groundDark: '#6f5238',
    groundMain: '#8f6b4a',
    grass: '#78d671',
    accent: '#38bdf8',
  },
  {
    name: 'Ametist Cati',
    skyTop: '#12091f',
    skyMid: '#241341',
    skyBottom: '#412368',
    star: '#f5d0fe',
    celestial: '#c084fc',
    far: '#271342',
    near: '#341d55',
    pipeDark: '#45135d',
    pipeMain: '#d946ef',
    pipeGlow: '#f0abfc',
    groundDark: '#4a355f',
    groundMain: '#70508e',
    grass: '#f472b6',
    accent: '#e879f9',
  },
  {
    name: 'Lav Cekirdegi',
    skyTop: '#1a0906',
    skyMid: '#3a140d',
    skyBottom: '#6b220f',
    star: '#fde68a',
    celestial: '#fb923c',
    far: '#42170d',
    near: '#5c200e',
    pipeDark: '#54210f',
    pipeMain: '#f97316',
    pipeGlow: '#fdba74',
    groundDark: '#5d2b14',
    groundMain: '#8f4a1f',
    grass: '#f59e0b',
    accent: '#fb7185',
  },
  {
    name: 'Buz Kemer',
    skyTop: '#06151d',
    skyMid: '#123246',
    skyBottom: '#1e5168',
    star: '#ecfeff',
    celestial: '#67e8f9',
    far: '#102532',
    near: '#17384c',
    pipeDark: '#103645',
    pipeMain: '#22d3ee',
    pipeGlow: '#a5f3fc',
    groundDark: '#275566',
    groundMain: '#3f7a91',
    grass: '#bef264',
    accent: '#2dd4bf',
  },
  {
    name: 'Void Orbit',
    skyTop: '#05050d',
    skyMid: '#101028',
    skyBottom: '#1b1b3c',
    star: '#dbeafe',
    celestial: '#818cf8',
    far: '#12142d',
    near: '#1c2142',
    pipeDark: '#27244f',
    pipeMain: '#6366f1',
    pipeGlow: '#a5b4fc',
    groundDark: '#2f3058',
    groundMain: '#4b4f83',
    grass: '#a78bfa',
    accent: '#60a5fa',
  },
]

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

function getWorldIndex(score: number): number {
  return Math.floor(Math.max(0, score) / 6) % WORLD_THEMES.length
}

function getWorldTheme(score: number): WorldTheme {
  return WORLD_THEMES[getWorldIndex(score)]
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

function drawPipe(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  theme: WorldTheme,
): void {
  ctx.fillStyle = theme.pipeDark
  ctx.fillRect(Math.round(x), Math.round(y), width, Math.round(height))
  ctx.fillStyle = theme.pipeMain
  ctx.fillRect(Math.round(x + 2), Math.round(y), width - 4, Math.round(height))
  ctx.fillStyle = theme.pipeGlow
  ctx.fillRect(Math.round(x + 4), Math.round(y), 2, Math.round(height))
}

function drawWorldLayer(
  ctx: CanvasRenderingContext2D,
  theme: WorldTheme,
  worldIndex: number,
  time: number,
): void {
  const farScroll = Math.floor((time * 0.006) % 48)
  const nearScroll = Math.floor((time * 0.014) % 64)

  switch (worldIndex) {
    case 0:
      ctx.fillStyle = theme.far
      for (let x = -48; x < VIEW_WIDTH + 48; x += 24) {
        const baseX = x - farScroll
        ctx.fillRect(baseX, 144, 8, 22)
        ctx.fillRect(baseX + 8, 136, 8, 30)
        ctx.fillRect(baseX + 16, 148, 8, 18)
        ctx.fillStyle = theme.star
        ctx.fillRect(baseX + 3, 150, 1, 1)
        ctx.fillRect(baseX + 11, 142, 1, 1)
        ctx.fillStyle = theme.far
      }
      ctx.fillStyle = theme.near
      for (let x = -64; x < VIEW_WIDTH + 64; x += 32) {
        const baseX = x - nearScroll
        ctx.fillRect(baseX, 172, 12, 32)
        ctx.fillRect(baseX + 12, 164, 12, 40)
        ctx.fillRect(baseX + 24, 176, 8, 28)
      }
      break
    case 1:
      ctx.fillStyle = theme.far
      for (let x = -48; x < VIEW_WIDTH + 48; x += 28) {
        const baseX = x - farScroll
        ctx.fillRect(baseX + 8, 148, 4, 22)
        ctx.fillRect(baseX + 4, 156, 12, 20)
        ctx.fillStyle = theme.star
        ctx.fillRect(baseX + 7, 154, 2, 2)
        ctx.fillStyle = theme.far
      }
      ctx.fillStyle = theme.near
      for (let x = -52; x < VIEW_WIDTH + 52; x += 22) {
        const baseX = x - nearScroll
        ctx.fillRect(baseX + 6, 178, 4, 28)
        ctx.fillRect(baseX, 192, 16, 16)
        ctx.fillStyle = theme.accent
        ctx.fillRect(baseX + 6, 186, 4, 6)
        ctx.fillStyle = theme.near
      }
      break
    case 2:
      ctx.fillStyle = theme.far
      for (let x = -50; x < VIEW_WIDTH + 50; x += 26) {
        const baseX = x - farScroll
        ctx.fillRect(baseX, 162, 18, 12)
        ctx.fillRect(baseX + 4, 154, 10, 10)
      }
      ctx.fillStyle = theme.near
      for (let x = -48; x < VIEW_WIDTH + 48; x += 20) {
        const baseX = x - nearScroll
        ctx.fillRect(baseX, 188, 18, 18)
        ctx.fillStyle = theme.accent
        ctx.fillRect(baseX + 4, 194 + ((x / 20) % 2 === 0 ? 0 : 2), 6, 4)
        ctx.fillStyle = theme.near
      }
      ctx.fillStyle = theme.star
      for (let index = 0; index < 6; index += 1) {
        ctx.fillRect(
          14 + ((index * 23 + Math.floor(time * 0.03)) % 148),
          42 + ((index * 17 + Math.floor(time * 0.016)) % 78),
          1,
          2,
        )
      }
      break
    case 3:
      ctx.fillStyle = theme.far
      for (let x = -40; x < VIEW_WIDTH + 40; x += 20) {
        const baseX = x - farScroll
        ctx.fillRect(baseX + 6, 152, 4, 18)
        ctx.fillRect(baseX + 2, 164, 12, 8)
      }
      ctx.fillStyle = theme.near
      for (let x = -52; x < VIEW_WIDTH + 52; x += 24) {
        const baseX = x - nearScroll
        ctx.fillRect(baseX + 8, 174, 4, 26)
        ctx.fillRect(baseX, 194, 18, 12)
        ctx.fillStyle = theme.star
        ctx.fillRect(baseX + 9, 179, 2, 4)
        ctx.fillStyle = theme.near
      }
      break
    default:
      ctx.fillStyle = theme.far
      for (let y = 142; y < 196; y += 10) {
        ctx.fillRect(0, y, VIEW_WIDTH, 1)
      }
      for (let x = -16; x < VIEW_WIDTH + 16; x += 16) {
        const offsetX = x - Math.floor((time * 0.018) % 16)
        ctx.fillRect(offsetX, 140, 1, 66)
      }
      ctx.fillStyle = theme.near
      ctx.fillRect(12, 156, 26, 26)
      ctx.fillStyle = theme.accent
      ctx.fillRect(18, 162, 14, 14)
      ctx.fillStyle = theme.star
      ctx.fillRect(106, 148, 20, 20)
      ctx.fillStyle = theme.pipeGlow
      ctx.fillRect(112, 154, 8, 8)
      break
  }
}

function drawWorldShift(ctx: CanvasRenderingContext2D, theme: WorldTheme, intensity: number): void {
  if (intensity <= 0) {
    return
  }
  ctx.save()
  ctx.globalAlpha = Math.min(0.5, intensity * 0.5)
  ctx.fillStyle = theme.accent
  for (let index = 0; index < 5; index += 1) {
    ctx.fillRect(index * 40, 0, 12, VIEW_HEIGHT)
  }
  ctx.globalAlpha = Math.min(0.24, intensity * 0.26)
  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT)
  ctx.restore()
}

type RetroTone = {
  frequency: number
  durationMs: number
  delayMs?: number
  gain?: number
  waveform?: OscillatorType
}

function createRetroTonePlayer(audioContext: AudioContext, tones: RetroTone[]): void {
  const now = audioContext.currentTime
  tones.forEach((tone) => {
    const oscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()
    const startAt = now + (tone.delayMs ?? 0) / 1000
    const endAt = startAt + tone.durationMs / 1000
    oscillator.type = tone.waveform ?? 'square'
    oscillator.frequency.setValueAtTime(tone.frequency, startAt)
    gainNode.gain.setValueAtTime(Math.max(0.0001, tone.gain ?? 0.045), startAt)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, endAt)
    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)
    oscillator.start(startAt)
    oscillator.stop(endAt)
  })
}

export function YabuBirdPage() {
  const navigate = useNavigate()
  const [deviceFingerprint] = useState<string | null>(() => getStoredDeviceFingerprint())
  const [phase, setPhase] = useState<Phase>('menu')
  const [drawerView, setDrawerView] = useState<DrawerView>(null)
  const [menuPublicRoom, setMenuPublicRoom] = useState<YabuBirdRoom | null>(null)
  const [menuLiveRooms, setMenuLiveRooms] = useState<YabuBirdRoom[]>([])
  const [menuPublicPlayers, setMenuPublicPlayers] = useState<YabuBirdPresence[]>([])
  const [room, setRoom] = useState<YabuBirdRoom | null>(null)
  const [you, setYou] = useState<YabuBirdPresence | null>(null)
  const [players, setPlayers] = useState<YabuBirdPresence[]>([])
  const [reactions, setReactions] = useState<YabuBirdReaction[]>([])
  const [leaderboard, setLeaderboard] = useState<YabuBirdScore[]>([])
  const [personalBest, setPersonalBest] = useState(0)
  const [scoreLabel, setScoreLabel] = useState(0)
  const [elapsedLabel, setElapsedLabel] = useState(0)
  const [joinCode, setJoinCode] = useState('')
  const [statusMessage, setStatusMessage] = useState('Oda sec, ekranin her yerine dokun ve ucmaya basla.')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [feedMessage, setFeedMessage] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const phaseRef = useRef<Phase>('menu')
  const drawerViewRef = useRef<DrawerView>(null)
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
  const worldIndexRef = useRef(0)
  const worldShiftAtRef = useRef(0)
  const audioContextRef = useRef<AudioContext | null>(null)
  const feedTimerRef = useRef<number | null>(null)
  const previousScoreLabelRef = useRef(0)
  const previousPhaseRef = useRef<Phase>('menu')
  const previousPlayerScoresRef = useRef<Record<number, number>>({})
  const gameEntryPingRef = useRef(false)

  const playerList = useMemo(
    () => (phase === 'menu' ? menuPublicPlayers : players),
    [menuPublicPlayers, phase, players],
  )
  const roomList = useMemo(
    () =>
      menuLiveRooms
        .filter((entry) => entry.room_type !== 'SOLO')
        .sort((left, right) => right.player_count - left.player_count),
    [menuLiveRooms],
  )
  const liveScoreboard = useMemo(
    () =>
      [...players]
        .sort((left, right) => right.latest_score - left.latest_score || left.employee_name.localeCompare(right.employee_name))
        .slice(0, 5),
    [players],
  )
  const reactionBurst = useMemo(() => reactions.slice(-4), [reactions])

  function resetEngine(): void {
    engineRef.current = { ...INITIAL_ENGINE, y: BIRD_START_Y }
    frameTimeRef.current = null
    setScoreLabel(0)
    setElapsedLabel(0)
    setFeedMessage(null)
    scoreLabelRef.current = 0
    elapsedLabelRef.current = 0
    previousScoreLabelRef.current = 0
    previousPlayerScoresRef.current = {}
    setReactions([])
  }

  function ensureAudioContext(): AudioContext | null {
    const ExistingAudioContext =
      window.AudioContext ??
      (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!ExistingAudioContext) {
      return null
    }
    if (audioContextRef.current === null) {
      audioContextRef.current = new ExistingAudioContext()
    }
    if (audioContextRef.current.state === 'suspended') {
      void audioContextRef.current.resume()
    }
    return audioContextRef.current
  }

  function playSfx(kind: 'menu' | 'join' | 'flap' | 'score' | 'crash'): void {
    const context = ensureAudioContext()
    if (!context) {
      return
    }
    if (kind === 'menu') {
      createRetroTonePlayer(context, [
        { frequency: 420, durationMs: 32, gain: 0.03 },
        { frequency: 560, durationMs: 42, delayMs: 28, gain: 0.025 },
      ])
      return
    }
    if (kind === 'join') {
      createRetroTonePlayer(context, [
        { frequency: 392, durationMs: 80, gain: 0.03 },
        { frequency: 494, durationMs: 90, delayMs: 70, gain: 0.03 },
        { frequency: 622, durationMs: 120, delayMs: 150, gain: 0.032 },
      ])
      return
    }
    if (kind === 'score') {
      createRetroTonePlayer(context, [
        { frequency: 660, durationMs: 40, gain: 0.03 },
        { frequency: 880, durationMs: 60, delayMs: 36, gain: 0.03 },
      ])
      return
    }
    if (kind === 'crash') {
      createRetroTonePlayer(context, [
        { frequency: 220, durationMs: 110, gain: 0.04, waveform: 'sawtooth' },
        { frequency: 160, durationMs: 160, delayMs: 70, gain: 0.035, waveform: 'triangle' },
      ])
      return
    }
    createRetroTonePlayer(context, [
      { frequency: 520, durationMs: 28, gain: 0.022 },
      { frequency: 390, durationMs: 34, delayMs: 18, gain: 0.018 },
    ])
  }

  function applyOverview(overview: YabuBirdLeaderboardResponse): void {
    setMenuPublicRoom(overview.live_room)
    setMenuLiveRooms(overview.live_rooms)
    setMenuPublicPlayers(overview.live_players)
    menuRoomRef.current = overview.live_room
    menuPlayersRef.current = overview.live_players
    setLeaderboard(overview.leaderboard)
    setPersonalBest(overview.personal_best)
    setReactions([])
  }

  function applyLiveState(state: YabuBirdLiveStateResponse): void {
    setRoom(state.room)
    setYou(state.you)
    setPlayers(state.players)
    playersRef.current = state.players
    setLeaderboard(state.leaderboard)
    setReactions(state.reactions)
    setPersonalBest(state.personal_best)
    roomRef.current = state.room
    presenceRef.current = state.you
  }

  async function refreshLocation(silent = false): Promise<void> {
    const result = await getCurrentLocation(4500)
    locationRef.current = result.location
    void silent
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

  async function announceGameEntry(): Promise<void> {
    if (!deviceFingerprint || gameEntryPingRef.current) {
      return
    }
    gameEntryPingRef.current = true
    const sessionKey = 'yabubird_last_game_login_ping_at'
    const lastPingAtRaw = window.sessionStorage.getItem(sessionKey)
    if (lastPingAtRaw) {
      const lastPingAt = Number(lastPingAtRaw)
      if (Number.isFinite(lastPingAt) && Date.now() - lastPingAt < 10 * 60 * 1000) {
        return
      }
    }
    const locationResult = await getCurrentLocation(3500)
    locationRef.current = locationResult.location
    await postEmployeeAppPresencePing({
      device_fingerprint: deviceFingerprint,
      source: 'YABUBIRD_ENTER',
      lat: locationResult.location?.lat,
      lon: locationResult.location?.lon,
      accuracy_m: locationResult.location?.accuracy_m ?? null,
    }).catch(() => undefined)
    window.sessionStorage.setItem(sessionKey, String(Date.now()))
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
    if (locationRef.current === null) {
      void refreshLocation(true)
    }
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
      if (state.room.share_code) {
        setJoinCode(state.room.share_code)
      }
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

  async function sendReaction(emoji: (typeof REACTION_EMOJIS)[number]): Promise<void> {
    const currentRoom = roomRef.current
    const currentPresence = presenceRef.current
    if (!deviceFingerprint || !currentRoom || !currentPresence || phaseRef.current === 'joining') {
      return
    }
    playSfx('menu')
    try {
      const state = await reactYabuBirdLiveRoom({
        device_fingerprint: deviceFingerprint,
        room_id: currentRoom.id,
        presence_id: currentPresence.id,
        emoji,
      })
      applyLiveState(state)
    } catch (error) {
      const parsed = parseApiError(error, 'Emoji gonderilemedi.')
      if (parsed.code !== 'YABUBIRD_REACTION_RATE_LIMIT') {
        setErrorMessage(parsed.message)
      }
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
    playSfx('crash')
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
      roomRef.current = null
      playersRef.current = []
      setYou(null)
      setRoom(null)
      setPlayers([])
      setPhase('menu')
      phaseRef.current = 'menu'
      resetEngine()
      setDrawerView('rooms')
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
    if (withOpeningFlap) {
      playSfx('flap')
    }
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
    playSfx('flap')
    engineRef.current = {
      ...engineRef.current,
      velocity: FLAP_VELOCITY,
      flapCount: engineRef.current.flapCount + 1,
    }
  }

  function handleStagePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    event.preventDefault()
    ensureAudioContext()
    if (phaseRef.current === 'joining' || phaseRef.current === 'menu' || phaseRef.current === 'crashed') {
      return
    }
    if (drawerViewRef.current !== null) {
      return
    }
    flap()
  }

  function handleUiPointerDown(event: ReactPointerEvent<HTMLElement>): void {
    event.preventDefault()
    event.stopPropagation()
    playSfx('menu')
  }

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  useEffect(() => {
    drawerViewRef.current = drawerView
  }, [drawerView])

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
    if (phase === 'playing' && scoreLabel > previousScoreLabelRef.current) {
      playSfx('score')
    }
    previousScoreLabelRef.current = scoreLabel
  }, [phase, scoreLabel])

  useEffect(() => {
    if (phase === 'ready' && previousPhaseRef.current !== 'ready') {
      playSfx('join')
    }
    previousPhaseRef.current = phase
  }, [phase])

  useEffect(() => {
    const nextScores: Record<number, number> = {}
    let nextFeed: string | null = null
    for (const player of players) {
      nextScores[player.id] = player.latest_score
      const previousScore = previousPlayerScoresRef.current[player.id]
      if (
        phase === 'playing' &&
        previousScore !== undefined &&
        player.latest_score > previousScore &&
        player.id !== you?.id
      ) {
        nextFeed = `${player.employee_name.toUpperCase()} +${player.latest_score - previousScore}`
      }
    }
    previousPlayerScoresRef.current = nextScores
    if (!nextFeed) {
      return
    }
    setFeedMessage(nextFeed)
    if (feedTimerRef.current !== null) {
      window.clearTimeout(feedTimerRef.current)
    }
    feedTimerRef.current = window.setTimeout(() => {
      setFeedMessage(null)
      feedTimerRef.current = null
    }, 1200)
  }, [phase, players, you?.id])

  useEffect(() => {
    resetEngine()
    void refreshLocation(true)
    void announceGameEntry()
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
    return () => {
      if (feedTimerRef.current !== null) {
        window.clearTimeout(feedTimerRef.current)
      }
      void audioContextRef.current?.close()
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) {
      return
    }
    const pixelRatio = Math.min(2, Math.max(1, Math.floor(window.devicePixelRatio || 1)))
    const resizeCanvas = () => {
      canvas.width = VIEW_WIDTH * pixelRatio
      canvas.height = VIEW_HEIGHT * pixelRatio
    }
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)

    let animationFrame = 0
    const tick = (time: number) => {
      if (phaseRef.current === 'playing' && roomRef.current && drawerViewRef.current === null) {
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

      const currentScore = engineRef.current.score
      const worldIndex = getWorldIndex(currentScore)
      const theme = WORLD_THEMES[worldIndex]
      if (worldIndex !== worldIndexRef.current) {
        worldIndexRef.current = worldIndex
        worldShiftAtRef.current = time
      }
      const worldShiftIntensity = Math.max(0, 1 - (time - worldShiftAtRef.current) / 850)
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      context.imageSmoothingEnabled = false
      context.clearRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT)
      context.fillStyle = theme.skyTop
      context.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT)
      context.fillStyle = theme.skyMid
      context.fillRect(0, 0, VIEW_WIDTH, 96)
      context.fillStyle = theme.skyBottom
      context.fillRect(0, 96, VIEW_WIDTH, 70)
      context.fillStyle = theme.near
      context.fillRect(0, 166, VIEW_WIDTH, PLAY_HEIGHT - 166)
      context.fillStyle = theme.star
      for (let index = 0; index < 18; index += 1) {
        context.fillRect(
          Math.floor(seededUnit(88, index) * VIEW_WIDTH),
          Math.floor(seededUnit(133, index) * 72),
          1,
          1,
        )
      }
      context.fillStyle = theme.celestial
      context.fillRect(116, 24, 20, 20)
      context.fillStyle = theme.accent
      context.fillRect(120, 28, 12, 12)
      context.fillStyle = theme.star
      context.fillRect(40 + Math.floor(Math.sin(time * 0.0018) * 6), 34, 3, 3)
      context.fillRect(90 + Math.floor(Math.cos(time * 0.0012) * 8), 18, 2, 2)
      drawWorldLayer(context, theme, worldIndex, time)

      const renderRoom = roomRef.current ?? menuRoomRef.current
      if (renderRoom) {
        for (const pipe of getVisiblePipes(renderRoom.seed, engineRef.current.elapsedMs)) {
          drawPipe(context, pipe.x, 0, PIPE_WIDTH, pipe.gapTop, theme)
          drawPipe(context, pipe.x, PLAY_HEIGHT - pipe.gapBottom, PIPE_WIDTH, pipe.gapBottom, theme)
        }
      }

      context.fillStyle = theme.groundDark
      context.fillRect(0, PLAY_HEIGHT, VIEW_WIDTH, FLOOR_HEIGHT)
      context.fillStyle = theme.grass
      context.fillRect(0, PLAY_HEIGHT, VIEW_WIDTH, 5)
      for (let x = -24; x < VIEW_WIDTH + 24; x += 12) {
        const tileX = x - Math.floor((time * 0.05) % 12)
        context.fillStyle = theme.groundDark
        context.fillRect(tileX, PLAY_HEIGHT + 6, 8, 12)
        context.fillStyle = theme.groundMain
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
      context.fillStyle = theme.accent
      context.fillRect(BIRD_X - 4, Math.round(engineRef.current.y + 7), 2, 1)
      context.fillRect(BIRD_X - 7, Math.round(engineRef.current.y + 6 + Math.sin(time * 0.02)), 2, 1)
      drawWorldShift(context, theme, worldShiftIntensity)

      context.font = '8px monospace'
      context.fillStyle = '#e2e8f0'
      context.fillText(`SCORE ${engineRef.current.score}`, 8, 12)
      context.fillText(`TIME ${Math.floor(engineRef.current.elapsedMs / 1000)}S`, 8, 22)
      context.fillText(theme.name.toUpperCase().slice(0, 10), 8, 32)
      context.fillText(`ZONE ${worldIndex + 1}`, VIEW_WIDTH - 58, 22)
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
  const roomSummary =
    roomList.length > 0
      ? `${roomList.length} canli oda acik`
      : menuPublicRoom
        ? 'Public oda canli'
        : 'Su an acik oda yok'

  const activeWorld = getWorldTheme(scoreLabel)
  const panelScreen:
    | 'unavailable'
    | 'joining'
    | 'crashed'
    | 'rooms'
    | 'leaderboard'
    | 'players'
    | null =
    !deviceFingerprint
      ? 'unavailable'
      : phase === 'joining'
        ? 'joining'
        : phase === 'crashed'
          ? 'crashed'
          : phase === 'menu' || phase === 'ready'
            ? drawerView ?? 'rooms'
            : drawerView
  const overlayVisible = panelScreen !== null

  return (
    <main className="yabubird-arcade-page">
      <section className="yabubird-game-shell">
        <div
          className={`yabubird-arcade-stage yabubird-arcade-stage--fullscreen ${phase === 'playing' ? 'is-active' : ''}`}
          role="button"
          tabIndex={0}
          aria-label="YabuBird piksel oyun alani"
          onPointerDown={handleStagePointerDown}
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (event.key === ' ' || event.key === 'Enter' || event.key === 'ArrowUp') {
              event.preventDefault()
              flap()
            }
          }}
        >
          <canvas ref={canvasRef} className="yabubird-arcade-canvas" />

          <button
            type="button"
            className="yabubird-pixel-menu-btn"
            onPointerDown={(event) => {
              handleUiPointerDown(event)
              setDrawerView((value) => (value === null ? 'rooms' : null))
            }}
          >
            MENU
          </button>

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
              <span>Evren</span>
              <strong>{activeWorld.name}</strong>
            </div>
            <div className="yabubird-arcade-hud-pill">
              <span>Oda</span>
              <strong>{room?.share_code ?? room?.room_label ?? 'Hazir'}</strong>
            </div>
          </div>

          {liveScoreboard.length > 0 && phase !== 'menu' ? (
            <div className="yabubird-live-counter">
              <p className="yabubird-live-counter-title">ROOM SCORE</p>
              {liveScoreboard.map((player) => (
                <div key={player.id} className="yabubird-live-counter-row">
                  <span>{player.employee_name.slice(0, 8).toUpperCase()}{player.id === you?.id ? '*' : ''}</span>
                  <strong>{player.latest_score}</strong>
                </div>
              ))}
            </div>
          ) : null}

          {reactionBurst.length > 0 && phase !== 'menu' ? (
            <div className="yabubird-reaction-burst" aria-live="polite">
              {reactionBurst.map((reaction) => (
                <div key={reaction.id} className="yabubird-reaction-burst-row">
                  <span className="yabubird-reaction-burst-emoji">{reaction.emoji}</span>
                  <strong>{reaction.employee_name.slice(0, 8).toUpperCase()}</strong>
                </div>
              ))}
            </div>
          ) : null}

          {feedMessage && phase === 'playing' && drawerView === null ? (
            <div className="yabubird-score-feed">{feedMessage}</div>
          ) : null}

          {phase === 'playing' && drawerView === null ? (
            <div className="yabubird-touch-tip">Tap anywhere. Her dokunus aninda flap.</div>
          ) : null}

          {phase === 'playing' && drawerView === null && errorMessage ? (
            <div className="yabubird-pixel-toast yabubird-pixel-toast-error">{errorMessage}</div>
          ) : null}

          {room && you && (phase === 'ready' || phase === 'playing') ? (
            <div className="yabubird-reaction-dock">
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="yabubird-reaction-btn"
                  onPointerDown={(event) => {
                    handleUiPointerDown(event)
                    void sendReaction(emoji)
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          ) : null}

          {overlayVisible ? (
            <div className="yabubird-arcade-overlay" onPointerDown={handleUiPointerDown}>
              <div className="yabubird-arcade-panel yabubird-arcade-panel--pixel" onPointerDown={handleUiPointerDown}>
                {panelScreen === 'rooms' && (
                  <>
                    <div className="yabubird-menu-tabs">
                      <button type="button" className="is-active">ROOM</button>
                      <button type="button" onPointerDown={(event) => { handleUiPointerDown(event); setDrawerView('leaderboard') }}>
                        HI-SCORE
                      </button>
                      <button type="button" onPointerDown={(event) => { handleUiPointerDown(event); setDrawerView('players') }}>
                        P1 LIST
                      </button>
                      {phase === 'playing' ? (
                        <button type="button" onPointerDown={(event) => { handleUiPointerDown(event); setDrawerView(null) }}>
                          BACK
                        </button>
                      ) : null}
                    </div>
                    <p className="yabubird-arcade-panel-kicker">YABUBIRD ARCADE</p>
                    <h2>{phase === 'ready' ? 'RUN READY' : 'INSERT MODE'}</h2>
                    <p>{phase === 'ready' ? roomLine : 'Klasik mod sec. Tek uc, ortak akisa dal veya kendi server kodunu ac.'}</p>
                    <div className="yabubird-room-strip">
                      <span>{roomSummary}</span>
                      <strong>Kisisel rekor {personalBest}</strong>
                    </div>
                    <div className="yabubird-arcade-mode-grid">
                      <button type="button" className="yabubird-mode-card" onPointerDown={(event) => { handleUiPointerDown(event); void enterRoom({ mode: 'SOLO' }) }}>
                        <strong>Tek Oyna</strong>
                        <span>Tek hat, temiz fizik, kendi rekorunu kovala.</span>
                      </button>
                      <button type="button" className="yabubird-mode-card" onPointerDown={(event) => { handleUiPointerDown(event); void enterRoom({ mode: 'PUBLIC' }) }}>
                        <strong>Beraber Oyna</strong>
                        <span>Public odada ayni anda uc, anlik skor tabelesini izle.</span>
                      </button>
                      <button type="button" className="yabubird-mode-card" onPointerDown={(event) => { handleUiPointerDown(event); void enterRoom({ mode: 'HOST' }) }}>
                        <strong>Server Ac</strong>
                        <span>Kodu uretilen odani ac, birden fazla kisi ayni anda girsin.</span>
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
                        onPointerDown={(event) => {
                          handleUiPointerDown(event)
                          void enterRoom({ mode: 'ROOM', roomCode: joinCode.trim() })
                        }}
                      >
                        Koda Gir
                      </button>
                    </div>
                    {roomList.length > 0 ? (
                      <div className="yabubird-room-list">
                        {roomList.slice(0, 5).map((entry) => (
                          <button
                            key={entry.id}
                            type="button"
                            className="yabubird-room-row"
                            onPointerDown={(event) => {
                              handleUiPointerDown(event)
                              void enterRoom(
                                entry.share_code
                                  ? { mode: 'ROOM', roomCode: entry.share_code }
                                  : { mode: 'PUBLIC' },
                              )
                            }}
                          >
                            <div>
                              <p>{entry.room_label}</p>
                              <span>
                                {entry.player_count} oyuncu{entry.share_code ? ` / ${entry.share_code}` : ''}
                              </span>
                            </div>
                            <strong>GIR</strong>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <div className="yabubird-arcade-ready-actions">
                      {phase === 'ready' ? (
                        <button type="button" className="yabubird-mode-inline-btn is-primary" onPointerDown={(event) => { handleUiPointerDown(event); startRun(true); setDrawerView(null) }}>
                          START
                        </button>
                      ) : null}
                      {phase === 'playing' ? (
                        <button type="button" className="yabubird-mode-inline-btn" onPointerDown={(event) => { handleUiPointerDown(event); setDrawerView(null) }}>
                          GAME
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="yabubird-mode-inline-btn"
                        onPointerDown={(event) => {
                          handleUiPointerDown(event)
                          if (presenceRef.current && roomRef.current) {
                            void leaveRoom(false)
                            return
                          }
                          navigate('/')
                        }}
                      >
                        EXIT
                      </button>
                    </div>
                    {statusMessage ? <p className="yabubird-panel-note">{statusMessage}</p> : null}
                  </>
                )}

                {panelScreen === 'leaderboard' && (
                  <>
                    <div className="yabubird-menu-tabs">
                      <button type="button" onPointerDown={(event) => { handleUiPointerDown(event); setDrawerView('rooms') }}>ROOM</button>
                      <button type="button" className="is-active">HI-SCORE</button>
                      <button type="button" onPointerDown={(event) => { handleUiPointerDown(event); setDrawerView('players') }}>P1 LIST</button>
                      <button type="button" onPointerDown={(event) => { handleUiPointerDown(event); setDrawerView(null) }}>BACK</button>
                    </div>
                    <p className="yabubird-arcade-panel-kicker">HI SCORE</p>
                    <h2>En iyi YabuBird turlari</h2>
                    <div className="yabubird-drawer-list yabubird-drawer-list--compact">
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
                  </>
                )}

                {panelScreen === 'players' && (
                  <>
                    <div className="yabubird-menu-tabs">
                      <button type="button" onPointerDown={(event) => { handleUiPointerDown(event); setDrawerView('rooms') }}>ROOM</button>
                      <button type="button" onPointerDown={(event) => { handleUiPointerDown(event); setDrawerView('leaderboard') }}>HI-SCORE</button>
                      <button type="button" className="is-active">P1 LIST</button>
                      <button type="button" onPointerDown={(event) => { handleUiPointerDown(event); setDrawerView(null) }}>BACK</button>
                    </div>
                    <p className="yabubird-arcade-panel-kicker">LIVE ROOM</p>
                    <h2>Aktif oyuncular</h2>
                    <div className="yabubird-drawer-list yabubird-drawer-list--compact">
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
                  </>
                )}

                {panelScreen === 'joining' && (
                  <>
                    <p className="yabubird-arcade-panel-kicker">LOADING</p>
                    <h2>Oda aciliyor...</h2>
                    <p>Sunucu ve canli akıs hazirlaniyor.</p>
                  </>
                )}

                {panelScreen === 'crashed' && (
                  <>
                    <p className="yabubird-arcade-panel-kicker">Tur bitti</p>
                    <h2>Skor {scoreLabel}</h2>
                    <p>{roomLine} / evren {activeWorld.name}</p>
                    <div className="yabubird-arcade-ready-actions">
                      <button
                        type="button"
                        className="yabubird-mode-inline-btn is-primary"
                        onPointerDown={(event) => {
                          handleUiPointerDown(event)
                          void enterRoom(joinIntentRef.current ?? { mode: 'PUBLIC' })
                        }}
                      >
                        Tekrar Oyna
                      </button>
                      <button type="button" className="yabubird-mode-inline-btn" onPointerDown={(event) => { handleUiPointerDown(event); setPhase('menu'); phaseRef.current = 'menu'; setDrawerView('rooms') }}>
                        Oda Sec
                      </button>
                    </div>
                  </>
                )}

                {panelScreen === 'unavailable' && (
                  <>
                    <p className="yabubird-arcade-panel-kicker">Baglanti Gerekli</p>
                    <h2>Bu cihaz calisana bagli degil.</h2>
                    <div className="yabubird-arcade-ready-actions">
                      <button type="button" className="yabubird-mode-inline-btn" onPointerDown={(event) => { handleUiPointerDown(event); navigate('/') }}>
                        Ana Sayfa
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  )
}
