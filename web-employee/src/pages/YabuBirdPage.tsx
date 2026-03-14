import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'

import {
  finishYabuBirdRun,
  getEmployeeYabuBirdOverview,
  joinYabuBirdLiveRoom,
  leaveYabuBirdLiveRoom,
  parseApiError,
  updateYabuBirdLiveState,
} from '../api/attendance'
import { BrandSignature } from '../components/BrandSignature'
import type {
  YabuBirdLeaderboardResponse,
  YabuBirdLiveStateResponse,
  YabuBirdPresence,
  YabuBirdRoom,
  YabuBirdScore,
} from '../types/api'
import { getStoredDeviceFingerprint } from '../utils/device'

const STAGE_WIDTH = 320
const STAGE_HEIGHT = 560
const FLOOR_HEIGHT = 92
const PLAY_HEIGHT = STAGE_HEIGHT - FLOOR_HEIGHT
const BIRD_X = 82
const BIRD_SIZE = 32
const GRAVITY = 1180
const FLAP_VELOCITY = -330
const TERMINAL_VELOCITY = 420
const PIPE_SPEED = 156
const PIPE_WIDTH = 62
const PIPE_SPACING = 210
const PIPE_GAP = 154
const PIPE_START_X = STAGE_WIDTH + 120
const START_Y = PLAY_HEIGHT * 0.42

interface PipeSprite {
  index: number
  x: number
  gapTop: number
  gapBottom: number
}

interface GameFrame {
  y: number
  velocity: number
  score: number
  flapCount: number
  elapsedMs: number
  worldElapsedMs: number
  alive: boolean
}

const INITIAL_FRAME: GameFrame = {
  y: START_Y,
  velocity: 0,
  score: 0,
  flapCount: 0,
  elapsedMs: 0,
  worldElapsedMs: 0,
  alive: false,
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function seededUnit(seed: number, index: number): number {
  const raw = Math.sin(seed * 0.00137 + index * 12.9898) * 43758.5453
  return raw - Math.floor(raw)
}

function getPipeGapCenter(seed: number, index: number): number {
  const minCenter = 110
  const maxCenter = PLAY_HEIGHT - FLOOR_HEIGHT - 20
  const availableRange = Math.max(0, maxCenter - minCenter)
  return minCenter + seededUnit(seed, index) * availableRange
}

function getVisiblePipes(seed: number, worldElapsedMs: number): PipeSprite[] {
  const distance = (PIPE_SPEED * Math.max(0, worldElapsedMs)) / 1000
  const roughIndex = Math.floor((distance - PIPE_START_X) / PIPE_SPACING)
  const startIndex = Math.max(0, roughIndex - 1)
  const pipes: PipeSprite[] = []

  for (let index = startIndex; index < startIndex + 8; index += 1) {
    const x = PIPE_START_X + index * PIPE_SPACING - distance
    if (x > STAGE_WIDTH + 120 || x + PIPE_WIDTH < -120) {
      continue
    }
    const gapCenter = getPipeGapCenter(seed, index)
    const gapTop = clamp(gapCenter - PIPE_GAP / 2, 52, PLAY_HEIGHT - PIPE_GAP - 42)
    const gapBottom = clamp(PLAY_HEIGHT - (gapTop + PIPE_GAP), 42, PLAY_HEIGHT - 52)
    pipes.push({ index, x, gapTop, gapBottom })
  }

  return pipes
}

function getLastPassedPipeIndex(worldElapsedMs: number): number {
  const distance = (PIPE_SPEED * Math.max(0, worldElapsedMs)) / 1000
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

export function YabuBirdPage() {
  const [deviceFingerprint] = useState<string | null>(() => getStoredDeviceFingerprint())
  const [room, setRoom] = useState<YabuBirdRoom | null>(null)
  const [you, setYou] = useState<YabuBirdPresence | null>(null)
  const [players, setPlayers] = useState<YabuBirdPresence[]>([])
  const [leaderboard, setLeaderboard] = useState<YabuBirdScore[]>([])
  const [personalBest, setPersonalBest] = useState(0)
  const [phase, setPhase] = useState<'idle' | 'joining' | 'playing' | 'crashed'>('idle')
  const [frame, setFrame] = useState<GameFrame>(INITIAL_FRAME)
  const [isRefreshing, setIsRefreshing] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(
    'Canli odaya baglanip YabuBird turunu baslatabilirsin.',
  )

  const roomRef = useRef<YabuBirdRoom | null>(null)
  const presenceRef = useRef<YabuBirdPresence | null>(null)
  const phaseRef = useRef<'idle' | 'joining' | 'playing' | 'crashed'>('idle')
  const gameStateRef = useRef<GameFrame>(INITIAL_FRAME)
  const lastTickRef = useRef<number | null>(null)
  const gameStartAtRef = useRef<number | null>(null)
  const lastPassedPipeIndexRef = useRef(-1)
  const rafRef = useRef<number | null>(null)
  const syncInFlightRef = useRef(false)
  const finishingRef = useRef(false)
  const leavingRef = useRef(false)

  const visiblePipes = useMemo(
    () => (room ? getVisiblePipes(room.seed, frame.worldElapsedMs) : []),
    [frame.worldElapsedMs, room],
  )

  const livePlayers = players.filter((player) => player.is_connected)
  const ghostPlayers = livePlayers
    .filter((player) => player.id !== you?.id && player.is_alive)
    .slice(0, 5)

  function stopAnimation(): void {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    lastTickRef.current = null
  }

  function clearPresence(): void {
    presenceRef.current = null
    setYou(null)
  }

  function applyOverview(data: YabuBirdLeaderboardResponse): void {
    setLeaderboard(data.leaderboard)
    setPlayers(data.live_players)
    setPersonalBest(data.personal_best)
    if (phaseRef.current !== 'playing') {
      roomRef.current = data.live_room
      setRoom(data.live_room)
    }
  }

  function applyLiveState(data: YabuBirdLiveStateResponse): void {
    roomRef.current = data.room
    presenceRef.current = data.you
    setRoom(data.room)
    setYou(data.you)
    setPlayers(data.players)
    setLeaderboard(data.leaderboard)
    setPersonalBest(data.personal_best)
  }

  async function refreshOverview(silent = false): Promise<void> {
    if (!deviceFingerprint) {
      setIsRefreshing(false)
      return
    }

    if (!silent) {
      setIsRefreshing(true)
    }

    try {
      const overview = await getEmployeeYabuBirdOverview(deviceFingerprint)
      applyOverview(overview)
      if (!silent) {
        setErrorMessage(null)
      }
    } catch (error) {
      if (!silent) {
        setErrorMessage(parseApiError(error, 'YabuBird durumu alinamadi.').message)
      }
    } finally {
      if (!silent) {
        setIsRefreshing(false)
      }
    }
  }

  async function finishCurrentRun(snapshot: GameFrame): Promise<void> {
    const activeRoom = roomRef.current
    const activePresence = presenceRef.current
    if (
      finishingRef.current ||
      !deviceFingerprint ||
      activeRoom === null ||
      activePresence === null
    ) {
      return
    }

    finishingRef.current = true
    stopAnimation()
    phaseRef.current = 'crashed'
    setPhase('crashed')
    setStatusMessage(`Tur bitti. Skorun ${snapshot.score}. Liderlik listesi guncelleniyor...`)

    try {
      const overview = await finishYabuBirdRun({
        device_fingerprint: deviceFingerprint,
        room_id: activeRoom.id,
        presence_id: activePresence.id,
        score: snapshot.score,
        survived_ms: snapshot.elapsedMs,
      })
      clearPresence()
      applyOverview(overview)
      setErrorMessage(null)
      setStatusMessage(`Tur bitti. Skor ${snapshot.score}. En iyi skorun ${overview.personal_best}.`)
    } catch (error) {
      setErrorMessage(parseApiError(error, 'Skor kaydedilemedi.').message)
    } finally {
      finishingRef.current = false
    }
  }

  async function leaveCurrentRoom(silent = false): Promise<void> {
    const activeRoom = roomRef.current
    const activePresence = presenceRef.current
    if (
      leavingRef.current ||
      finishingRef.current ||
      !deviceFingerprint ||
      activeRoom === null ||
      activePresence === null
    ) {
      return
    }

    leavingRef.current = true
    try {
      const overview = await leaveYabuBirdLiveRoom({
        device_fingerprint: deviceFingerprint,
        room_id: activeRoom.id,
        presence_id: activePresence.id,
      })
      clearPresence()
      applyOverview(overview)
      if (!silent) {
        setStatusMessage('Canli odadan ayrildin.')
      }
    } catch (error) {
      if (!silent) {
        setErrorMessage(parseApiError(error, 'Canli odadan cikis yapilamadi.').message)
      }
    } finally {
      leavingRef.current = false
    }
  }

  function performFlap(): void {
    if (phaseRef.current !== 'playing') {
      return
    }
    const nextFrame = {
      ...gameStateRef.current,
      velocity: FLAP_VELOCITY,
      flapCount: gameStateRef.current.flapCount + 1,
    }
    gameStateRef.current = nextFrame
    setFrame(nextFrame)
  }

  async function handleStartGame(): Promise<void> {
    if (!deviceFingerprint || phaseRef.current === 'joining') {
      return
    }

    stopAnimation()
    clearPresence()
    setErrorMessage(null)
    setStatusMessage('Canli odaya baglaniyorsun...')
    phaseRef.current = 'joining'
    setPhase('joining')

    try {
      const liveState = await joinYabuBirdLiveRoom({
        device_fingerprint: deviceFingerprint,
      })
      const worldElapsedMs = Math.max(0, Date.now() - Date.parse(liveState.room.started_at))
      const nextFrame = {
        ...INITIAL_FRAME,
        y: START_Y,
        alive: true,
        worldElapsedMs,
      }
      gameStateRef.current = nextFrame
      setFrame(nextFrame)
      gameStartAtRef.current = Date.now()
      lastPassedPipeIndexRef.current = getLastPassedPipeIndex(worldElapsedMs)
      applyLiveState(liveState)
      setStatusMessage('Canli tur basladi. Ekrana dokun veya bosluk tusuyla kanat cirp.')
      phaseRef.current = 'playing'
      setPhase('playing')
    } catch (error) {
      const parsed = parseApiError(error, 'Canli odaya baglanilamadi.')
      phaseRef.current = 'idle'
      setPhase('idle')
      setErrorMessage(parsed.message)
      setStatusMessage('Baglanti kurulamadigi icin tur baslatilamadi.')
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
    void refreshOverview()
  }, [])

  useEffect(() => {
    if (phase === 'playing') {
      return undefined
    }

    const intervalId = window.setInterval(() => {
      void refreshOverview(true)
    }, 8000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [phase, deviceFingerprint])

  useEffect(() => {
    if (phase !== 'playing' || room === null) {
      return undefined
    }

    const roomStartedAtMs = Date.parse(room.started_at)
    const tick = (rafTime: number) => {
      if (phaseRef.current !== 'playing') {
        return
      }

      if (lastTickRef.current === null) {
        lastTickRef.current = rafTime
      }

      const deltaMs = Math.min(34, rafTime - lastTickRef.current)
      lastTickRef.current = rafTime

      const elapsedMs =
        gameStartAtRef.current === null ? 0 : Math.max(0, Date.now() - gameStartAtRef.current)
      const worldElapsedMs = Math.max(0, Date.now() - roomStartedAtMs)
      const nextVelocity = clamp(
        gameStateRef.current.velocity + (GRAVITY * deltaMs) / 1000,
        -600,
        TERMINAL_VELOCITY,
      )
      const nextY = gameStateRef.current.y + (nextVelocity * deltaMs) / 1000

      let nextScore = gameStateRef.current.score
      const lastPassedIndex = getLastPassedPipeIndex(worldElapsedMs)
      if (lastPassedIndex > lastPassedPipeIndexRef.current) {
        nextScore += lastPassedIndex - lastPassedPipeIndexRef.current
        lastPassedPipeIndexRef.current = lastPassedIndex
      }

      const clampedY = clamp(nextY, -12, PLAY_HEIGHT - BIRD_SIZE)
      let crashed = clampedY <= -2 || clampedY + BIRD_SIZE >= PLAY_HEIGHT
      if (!crashed) {
        const pipes = getVisiblePipes(room.seed, worldElapsedMs)
        const birdLeft = BIRD_X
        const birdRight = BIRD_X + BIRD_SIZE
        const birdTop = clampedY
        const birdBottom = clampedY + BIRD_SIZE

        crashed = pipes.some((pipe) => {
          const pipeLeft = pipe.x
          const pipeRight = pipe.x + PIPE_WIDTH
          const overlapsPipe = birdRight > pipeLeft && birdLeft < pipeRight
          if (!overlapsPipe) {
            return false
          }
          const gapBottomStart = PLAY_HEIGHT - pipe.gapBottom
          return birdTop < pipe.gapTop || birdBottom > gapBottomStart
        })
      }

      const nextFrame = {
        y: clampedY,
        velocity: nextVelocity,
        score: nextScore,
        flapCount: gameStateRef.current.flapCount,
        elapsedMs,
        worldElapsedMs,
        alive: !crashed,
      }

      gameStateRef.current = nextFrame
      setFrame(nextFrame)

      if (crashed) {
        void finishCurrentRun(nextFrame)
        return
      }

      rafRef.current = window.requestAnimationFrame(tick)
    }

    rafRef.current = window.requestAnimationFrame(tick)

    return () => {
      stopAnimation()
    }
  }, [phase, room])

  useEffect(() => {
    if (phase !== 'playing' || !deviceFingerprint || room === null || you === null) {
      return undefined
    }

    const intervalId = window.setInterval(() => {
      if (syncInFlightRef.current || finishingRef.current) {
        return
      }

      syncInFlightRef.current = true
      const snapshot = gameStateRef.current

      void updateYabuBirdLiveState({
        device_fingerprint: deviceFingerprint,
        room_id: room.id,
        presence_id: you.id,
        y: snapshot.y,
        velocity: snapshot.velocity,
        score: snapshot.score,
        flap_count: snapshot.flapCount,
        is_alive: snapshot.alive,
      })
        .then((liveState) => {
          if (phaseRef.current === 'playing') {
            applyLiveState(liveState)
          }
        })
        .catch((error) => {
          const parsed = parseApiError(error, 'Canli YabuBird senkronize edilemedi.')
          if (parsed.code === 'YABUBIRD_ROOM_CLOSED') {
            stopAnimation()
            clearPresence()
            phaseRef.current = 'idle'
            setPhase('idle')
            setErrorMessage(parsed.message)
            setStatusMessage('Oda kapandigi icin canli tur sona erdi.')
            void refreshOverview(true)
            return
          }
          setErrorMessage(parsed.message)
        })
        .finally(() => {
          syncInFlightRef.current = false
        })
    }, 260)

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
      performFlap()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  useEffect(() => {
    const handlePageHide = () => {
      stopAnimation()
      void leaveCurrentRoom(true)
    }

    window.addEventListener('pagehide', handlePageHide)
    return () => {
      window.removeEventListener('pagehide', handlePageHide)
      stopAnimation()
      void leaveCurrentRoom(true)
    }
  }, [deviceFingerprint])

  const playerBirdStyle: CSSProperties = {
    top: `${frame.y}px`,
    left: `${BIRD_X}px`,
    transform: `translate3d(0, 0, 0) rotate(${clamp(frame.velocity * 0.08, -24, 74)}deg)`,
  }

  return (
    <main className="phone-shell employee-shell">
      <section className="phone-card employee-home-card yabubird-page-card">
        <div className="card-topbar">
          <div>
            <p className="chip">Canli Oyun</p>
            <h1>YabuBird Arena</h1>
          </div>
          <Link className="topbar-link with-icon" to="/">
            Uygulamaya Don
          </Link>
        </div>

        <section className="yabubird-hero">
          <div className="yabubird-hero-copy">
            <p className="yabubird-hero-kicker">ONLINE FLAPPY CORE</p>
            <h2 className="yabubird-hero-title">Ayni odada beraber uctugunuz, chati olmayan mini arena.</h2>
            <p className="yabubird-hero-text">
              Tur baslatinca canli odaya girersin, diger calisanlarin anlik skorlarini gorursun,
              uygulamadan cikmadan geri donebilirsin.
            </p>
          </div>
          <div className="yabubird-metric-stack">
            <div className="yabubird-metric-card">
              <span className="yabubird-metric-label">En iyi skor</span>
              <strong className="yabubird-metric-value">{personalBest}</strong>
            </div>
            <div className="yabubird-metric-card">
              <span className="yabubird-metric-label">Canli oyuncu</span>
              <strong className="yabubird-metric-value">{livePlayers.length}</strong>
            </div>
          </div>
        </section>

        {deviceFingerprint ? null : (
          <div className="warn-box">
            <p>Oyuna girmek icin once bu cihazin calisana bagli olmasi gerekiyor.</p>
            <Link className="inline-link" to="/">
              Ana sayfaya don
            </Link>
          </div>
        )}

        {errorMessage ? (
          <div className="error-box banner-error">
            <p>
              <span className="banner-icon" aria-hidden="true">
                !
              </span>
              {errorMessage}
            </p>
          </div>
        ) : null}

        <div className="notice-box notice-box-success yabubird-status-strip">
          <p>
            <span className="banner-icon" aria-hidden="true">
              +
            </span>
            {statusMessage}
          </p>
        </div>

        <section className="yabubird-stage-panel">
          <div
            className={`yabubird-stage ${phase === 'playing' ? 'is-playing' : ''}`}
            role="button"
            tabIndex={0}
            aria-label="YabuBird oyun alani"
            onClick={() => {
              if (phase === 'playing') {
                performFlap()
              }
            }}
            onKeyDown={(event) => {
              if ((event.key === ' ' || event.key === 'ArrowUp') && phase === 'playing') {
                event.preventDefault()
                performFlap()
              }
            }}
          >
            <div className="yabubird-stage-sky" />
            <div className="yabubird-stage-stars" />
            <div className="yabubird-stage-haze yabubird-stage-haze-left" />
            <div className="yabubird-stage-haze yabubird-stage-haze-right" />

            {visiblePipes.map((pipe) => (
              <div key={pipe.index}>
                <div
                  className="yabubird-pipe yabubird-pipe-top"
                  style={{
                    left: `${pipe.x}px`,
                    width: `${PIPE_WIDTH}px`,
                    height: `${pipe.gapTop}px`,
                  }}
                />
                <div
                  className="yabubird-pipe yabubird-pipe-bottom"
                  style={{
                    left: `${pipe.x}px`,
                    width: `${PIPE_WIDTH}px`,
                    height: `${pipe.gapBottom}px`,
                  }}
                />
              </div>
            ))}

            <div className="yabubird-sun" aria-hidden="true" />

            {ghostPlayers.map((player, index) => (
              <div
                key={player.id}
                className="yabubird-ghost-player"
                style={{
                  left: `${BIRD_X + 26 + index * 16}px`,
                  top: `${clamp(player.latest_y, 0, PLAY_HEIGHT - 18)}px`,
                  backgroundColor: player.color_hex,
                }}
                title={`${player.employee_name} / skor ${player.latest_score}`}
              >
                <span>{player.employee_name.slice(0, 1).toUpperCase()}</span>
              </div>
            ))}

            <div className="yabubird-player" style={playerBirdStyle}>
              <span className="yabubird-player-eye" />
              <span className="yabubird-player-wing" />
            </div>

            <div className="yabubird-floor">
              <div className="yabubird-floor-line" />
            </div>

            <div className="yabubird-stage-hud">
              <div className="yabubird-hud-pill">
                <span>Skor</span>
                <strong>{frame.score}</strong>
              </div>
              <div className="yabubird-hud-pill">
                <span>Tur</span>
                <strong>{formatDuration(frame.elapsedMs)}</strong>
              </div>
            </div>

            <div className="yabubird-stage-overlay">
              {phase === 'joining' ? (
                <div className="yabubird-overlay-card">
                  <p className="yabubird-overlay-kicker">Baglaniyor</p>
                  <h3>Canli oda aciliyor...</h3>
                  <p>Diger oyuncularla ayni odaya giriyorsun.</p>
                </div>
              ) : null}

              {phase === 'idle' ? (
                <div className="yabubird-overlay-card">
                  <p className="yabubird-overlay-kicker">
                    {room ? 'Canli oda acik' : isRefreshing ? 'Arena yukleniyor' : 'Yeni tur hazir'}
                  </p>
                  <h3>{room ? 'Canli tura katil' : 'YabuBird turunu baslat'}</h3>
                  <p>
                    {room
                      ? `${livePlayers.length} oyuncu su anda aktif. Tura girip ayni akisa katilabilirsin.`
                      : 'Tek dokunusla global canli oda acilir ve leaderboard kaydi tutulur.'}
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!deviceFingerprint || isRefreshing}
                    onClick={() => void handleStartGame()}
                  >
                    {room ? 'Canli Odaya Gir' : 'YabuBird Baslat'}
                  </button>
                </div>
              ) : null}

              {phase === 'crashed' ? (
                <div className="yabubird-overlay-card">
                  <p className="yabubird-overlay-kicker">Tur bitti</p>
                  <h3>Skorun {frame.score}</h3>
                  <p>
                    Sure {formatDuration(frame.elapsedMs)} / En iyi skor {personalBest}
                  </p>
                  <div className="yabubird-overlay-actions">
                    <button type="button" className="btn btn-primary" onClick={() => void handleStartGame()}>
                      Tekrar Oyna
                    </button>
                    <Link className="btn btn-soft" to="/">
                      Uygulamaya Don
                    </Link>
                  </div>
                </div>
              ) : null}

              {phase === 'playing' ? (
                <div className="yabubird-live-tip">Dokun veya bosluk tusuna bas.</div>
              ) : null}
            </div>
          </div>
        </section>

        <div className="yabubird-panels">
          <section className="yabubird-panel">
            <div className="yabubird-panel-head">
              <div>
                <p className="yabubird-panel-kicker">Canli Oda</p>
                <h3>Aktif arena durumu</h3>
              </div>
              <span className={`status-pill ${room ? 'state-ok' : 'state-warn'}`}>
                {room ? 'Acik' : 'Beklemede'}
              </span>
            </div>
            <dl className="yabubird-meta-grid">
              <div>
                <dt>Oda anahtari</dt>
                <dd>{room?.room_key ?? '-'}</dd>
              </div>
              <div>
                <dt>Baslangic</dt>
                <dd>{formatClock(room?.started_at)}</dd>
              </div>
              <div>
                <dt>Aktif oyuncu</dt>
                <dd>{livePlayers.length}</dd>
              </div>
              <div>
                <dt>Durum</dt>
                <dd>{phase === 'playing' ? 'Sen de oyundasin' : 'Lobidesin'}</dd>
              </div>
            </dl>
            {phase === 'playing' ? (
              <button type="button" className="btn btn-soft yabubird-leave-btn" onClick={() => void leaveCurrentRoom()}>
                Odayi Birak
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-outline yabubird-leave-btn"
                disabled={!deviceFingerprint || phase === 'joining'}
                onClick={() => void handleStartGame()}
              >
                Yeni Tur Baslat
              </button>
            )}
          </section>

          <section className="yabubird-panel">
            <div className="yabubird-panel-head">
              <div>
                <p className="yabubird-panel-kicker">Leaderboard</p>
                <h3>En yuksek skorlar</h3>
              </div>
              <span className="status-pill state-info">Top 12</span>
            </div>
            <div className="yabubird-list">
              {leaderboard.length === 0 ? (
                <p className="muted small-text">Henuz kayitli skor yok. Ilk turu sen baslat.</p>
              ) : (
                leaderboard.map((entry, index) => (
                  <div key={entry.id} className="yabubird-list-row">
                    <div>
                      <p className="yabubird-list-title">
                        #{index + 1} {entry.employee_name}
                      </p>
                      <p className="yabubird-list-subtitle">{formatClock(entry.created_at)}</p>
                    </div>
                    <strong className="yabubird-score-badge">{entry.score}</strong>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="yabubird-panel">
            <div className="yabubird-panel-head">
              <div>
                <p className="yabubird-panel-kicker">Canli Oyuncular</p>
                <h3>Ayni turdaki calisanlar</h3>
              </div>
              <span className="status-pill state-info">{livePlayers.length} kisi</span>
            </div>
            <div className="yabubird-list">
              {livePlayers.length === 0 ? (
                <p className="muted small-text">Su anda aktif oyuncu yok. Odayi acan ilk kisi sen olabilirsin.</p>
              ) : (
                livePlayers.map((player) => (
                  <div key={player.id} className="yabubird-list-row">
                    <div className="yabubird-player-summary">
                      <span
                        className="yabubird-player-dot"
                        style={{ backgroundColor: player.color_hex }}
                        aria-hidden="true"
                      />
                      <div>
                        <p className="yabubird-list-title">
                          {player.employee_name}
                          {player.id === you?.id ? ' (Sen)' : ''}
                        </p>
                        <p className="yabubird-list-subtitle">
                          Son gorulme {formatClock(player.last_seen_at)}
                        </p>
                      </div>
                    </div>
                    <strong className="yabubird-score-badge">{player.latest_score}</strong>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <div className="device-box yabubird-device-box">
          <p className="muted small-text">
            Cihaz Parmak Izi: {deviceFingerprint ?? '-'}
          </p>
        </div>

        <BrandSignature />
      </section>
    </main>
  )
}
