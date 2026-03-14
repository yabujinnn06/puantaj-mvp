import { useEffect, useMemo, useState } from 'react'

import { getAdminYabuBirdOverview } from '../api/admin'
import { EmployeeLiveLocationMap, type EmployeeLiveLocationMapMarker } from '../components/EmployeeLiveLocationMap'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import type { AdminYabuBirdOverview } from '../types/api'

function formatClock(value: string | null | undefined): string {
  if (!value) {
    return '-'
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return '-'
  }
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) {
    return '0.0 sn'
  }
  return `${(ms / 1000).toFixed(1)} sn`
}

function formatCoords(lat: number | null | undefined, lon: number | null | undefined): string {
  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return '-'
  }
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`
}

function formatEventLabel(value: string | null | undefined): string {
  switch (value) {
    case 'app_login':
      return 'App Login'
    case 'game_login':
      return 'Game Login'
    case 'game_session_start':
      return 'Session Start'
    case 'game_session_end':
      return 'Session End'
    case 'game_logout':
      return 'Game Logout'
    case 'emoji_reaction':
      return 'Emoji'
    case 'game_score_update':
      return 'Score'
    default:
      return value ?? '-'
  }
}

export function YabuBirdPage() {
  const [overview, setOverview] = useState<AdminYabuBirdOverview | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)

  async function refreshOverview(silent = false): Promise<void> {
    if (!silent) {
      setIsLoading(true)
    } else {
      setIsRefreshing(true)
    }
    try {
      const nextOverview = await getAdminYabuBirdOverview()
      setOverview(nextOverview)
      setLastUpdatedAt(new Date().toISOString())
      setErrorMessage(null)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'YabuBird verileri yuklenemedi.')
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    void refreshOverview()
    const intervalId = window.setInterval(() => {
      void refreshOverview(true)
    }, 8000)
    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  const liveRooms = overview?.live_rooms ?? []
  const livePlayers = overview?.live_players ?? []
  const leaderboard = overview?.leaderboard ?? []
  const latestScores = overview?.latest_scores ?? []
  const liveLocations = overview?.live_player_locations ?? []
  const recentLocations = overview?.recent_player_locations ?? []
  const appEntries = overview?.app_entry_locations ?? []
  const recentActivity = overview?.recent_activity ?? []

  const liveMarkers = useMemo<EmployeeLiveLocationMapMarker[]>(
    () =>
      liveLocations
        .filter((entry) => entry.location)
        .map((entry) => ({
          id: `live-${entry.presence_id ?? entry.employee_id}`,
          lat: entry.location!.lat,
          lon: entry.location!.lon,
          label: `${entry.employee_name} / ${entry.room_label ?? 'Oda'}`,
          kind: 'latest',
        })),
    [liveLocations],
  )

  const recentMarkers = useMemo<EmployeeLiveLocationMapMarker[]>(
    () =>
      recentLocations
        .filter((entry) => entry.location)
        .map((entry) => ({
          id: `recent-${entry.score_id ?? entry.employee_id}`,
          lat: entry.location!.lat,
          lon: entry.location!.lon,
          label: `${entry.employee_name} / skor ${entry.score}`,
          kind: 'recent',
        })),
    [recentLocations],
  )

  const appEntryMarkers = useMemo<EmployeeLiveLocationMapMarker[]>(
    () =>
      appEntries
        .filter((entry) => entry.location)
        .map((entry) => ({
          id: `entry-${entry.audit_id}`,
          lat: entry.location!.lat,
          lon: entry.location!.lon,
          label: `${entry.employee_name} / ${entry.source}`,
          kind: 'checkin',
        })),
    [appEntries],
  )

  return (
    <>
      <PageHeader
        title="YabuBird Tracking"
        description="Bu ekran oyunu degil, calisan konum akislarini izlemek icin. Canli oyun, son oyun ve uygulama giris konumlari burada toplanir."
        action={
          <button
            type="button"
            onClick={() => void refreshOverview(true)}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            {isRefreshing ? 'Yenileniyor...' : 'Yenile'}
          </button>
        }
      />

      {errorMessage ? (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {errorMessage}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-4">
        <Panel>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-sky-700">Live Rooms</p>
          <strong className="mt-2 block text-3xl text-slate-900">{liveRooms.length}</strong>
          <p className="mt-2 text-sm text-slate-600">Acik oda sayisi.</p>
        </Panel>
        <Panel>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-sky-700">Canli Oyuncu</p>
          <strong className="mt-2 block text-3xl text-slate-900">{livePlayers.length}</strong>
          <p className="mt-2 text-sm text-slate-600">O an aktif oynayan calisanlar.</p>
        </Panel>
        <Panel>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-sky-700">Canli Konum</p>
          <strong className="mt-2 block text-3xl text-slate-900">{liveLocations.length}</strong>
          <p className="mt-2 text-sm text-slate-600">Oyunda olanlarin son bildirdigi konum.</p>
        </Panel>
        <Panel>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-sky-700">App Giris</p>
          <strong className="mt-2 block text-3xl text-slate-900">{appEntries.length}</strong>
          <p className="mt-2 text-sm text-slate-600">Uygulama acilis konumlari / saat akisiyla.</p>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
        <Panel>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-sky-700">Rooms + Players</p>
              <h3 className="mt-1 text-lg font-semibold text-slate-900">Canli YabuBird odalari</h3>
            </div>
            <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
              Son yenileme {formatClock(lastUpdatedAt)}
            </span>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {liveRooms.length === 0 ? (
              <p className="text-sm text-slate-500">Acik oda yok.</p>
            ) : (
              liveRooms.map((room) => (
                <div key={room.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{room.room_type}</p>
                  <strong className="mt-2 block text-base text-slate-900">{room.room_label}</strong>
                  <p className="mt-1 text-sm text-slate-600">
                    Oyuncu {room.player_count} / Kod {room.share_code ?? '-'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">Acilis {formatClock(room.started_at)}</p>
                </div>
              ))
            )}
          </div>

          <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">Oyuncu</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">Oda</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">Skor</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">Son gorulme</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {isLoading ? (
                  <tr>
                    <td className="px-4 py-4 text-slate-500" colSpan={4}>Yukleniyor...</td>
                  </tr>
                ) : livePlayers.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-slate-500" colSpan={4}>Canli oyuncu yok.</td>
                  </tr>
                ) : (
                  livePlayers.map((player) => (
                    <tr key={player.id}>
                      <td className="px-4 py-3 font-semibold text-slate-900">{player.employee_name}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {player.room_label ?? '-'} {player.share_code ? `/ ${player.share_code}` : ''}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900">{player.latest_score}</td>
                      <td className="px-4 py-3 text-right text-slate-500">{formatClock(player.last_seen_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="grid gap-4">
          <Panel>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-sky-700">Canli Oyun Konumu</p>
            <h3 className="mt-1 text-lg font-semibold text-slate-900">Oyunu o an oynayanlar</h3>
            <div className="mt-4">
              {liveMarkers.length === 0 ? (
                <p className="text-sm text-slate-500">Canli konum yok.</p>
              ) : (
                <EmployeeLiveLocationMap markers={liveMarkers} />
              )}
            </div>
          </Panel>
          <Panel>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-sky-700">Uygulama Giris Konumu</p>
            <h3 className="mt-1 text-lg font-semibold text-slate-900">Saat saat giris takibi</h3>
            <div className="mt-4">
              {appEntryMarkers.length === 0 ? (
                <p className="text-sm text-slate-500">App giris konumu yok.</p>
              ) : (
                <EmployeeLiveLocationMap markers={appEntryMarkers} />
              )}
            </div>
          </Panel>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-sky-700">Son Oyun Konumlari</p>
          <div className="mt-4">
            {recentMarkers.length === 0 ? (
              <p className="text-sm text-slate-500">Son oyun konumu yok.</p>
            ) : (
              <EmployeeLiveLocationMap markers={recentMarkers} />
            )}
          </div>
        </Panel>

        <Panel>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-sky-700">Recent Runs</p>
          <div className="mt-4 space-y-3">
            {recentLocations.length === 0 ? (
              <p className="text-sm text-slate-500">Oyun konumu kaydi yok.</p>
            ) : (
              recentLocations.map((entry) => (
                <div key={`${entry.score_id}-${entry.employee_id}`} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-sm font-semibold text-slate-900">{entry.employee_name}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {entry.room_label ?? '-'} / skor {entry.score} / {formatDuration(entry.survived_ms)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatCoords(entry.location?.lat, entry.location?.lon)} / {formatClock(entry.played_at)}
                  </p>
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-sky-700">App Entry Timeline</p>
          <div className="mt-4 space-y-3">
            {appEntries.length === 0 ? (
              <p className="text-sm text-slate-500">Uygulama giris konumu yok.</p>
            ) : (
              appEntries.map((entry) => (
                <div key={entry.audit_id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-sm font-semibold text-slate-900">{entry.employee_name}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {entry.source} / {formatClock(entry.logged_at)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatCoords(entry.location?.lat, entry.location?.lon)} / durum {entry.location_state}
                  </p>
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-sky-700">Leaderboard</p>
          <div className="mt-4 space-y-3">
            {leaderboard.map((entry, index) => (
              <div key={entry.id} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">#{index + 1} {entry.employee_name}</p>
                  <p className="mt-1 text-xs text-slate-500">{entry.room_label ?? '-'} / {formatClock(entry.created_at)}</p>
                </div>
                <strong className="rounded-full bg-sky-100 px-3 py-1 text-sm text-sky-700">{entry.score}</strong>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-sky-700">Latest Scores</p>
          <div className="mt-4 space-y-3">
            {latestScores.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{entry.employee_name}</p>
                  <p className="mt-1 text-xs text-slate-500">{entry.room_label ?? '-'} / {formatDuration(entry.survived_ms)}</p>
                </div>
                <strong className="rounded-full bg-emerald-100 px-3 py-1 text-sm text-emerald-700">{entry.score}</strong>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="mt-4">
        <Panel>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-sky-700">Recent Activity</p>
          <h3 className="mt-1 text-lg font-semibold text-slate-900">App ve oyun event akisi</h3>
          <div className="mt-4 space-y-3">
            {recentActivity.length === 0 ? (
              <p className="text-sm text-slate-500">Son activity event yok.</p>
            ) : (
              recentActivity.map((entry) => (
                <div key={entry.audit_id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white">
                      {entry.module}
                    </span>
                    <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-sky-700">
                      {formatEventLabel(entry.event_type)}
                    </span>
                    <span className="text-xs text-slate-500">{formatClock(entry.logged_at)}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-slate-900">
                    {entry.employee_name ?? `Calisan ${entry.employee_id ?? '-'}`}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">{entry.summary}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    entity {entry.entity_type ?? '-'} / {entry.entity_id ?? '-'} / device {entry.device_id ?? '-'}
                  </p>
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>
    </>
  )
}
