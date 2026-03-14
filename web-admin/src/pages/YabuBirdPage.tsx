import { useEffect, useState } from 'react';

import { getAdminYabuBirdOverview } from '../api/admin';
import { PageHeader } from '../components/PageHeader';
import { Panel } from '../components/Panel';
import type { AdminYabuBirdOverview } from '../types/api';

function formatClock(value: string | null | undefined): string {
  if (!value) {
    return '-';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '-';
  }
  return new Intl.DateTimeFormat('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(parsed);
}

function formatDuration(ms: number): string {
  if (ms <= 0) {
    return '0.0 sn';
  }
  return `${(ms / 1000).toFixed(1)} sn`;
}

export function YabuBirdPage() {
  const [overview, setOverview] = useState<AdminYabuBirdOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  async function refreshOverview(silent = false): Promise<void> {
    if (!silent) {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }

    try {
      const nextOverview = await getAdminYabuBirdOverview();
      setOverview(nextOverview);
      setLastUpdatedAt(new Date().toISOString());
      setErrorMessage(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'YabuBird verileri yuklenemedi.';
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    void refreshOverview();
    const intervalId = window.setInterval(() => {
      void refreshOverview(true);
    }, 8000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const liveRoom = overview?.live_room ?? null;
  const livePlayers = overview?.live_players ?? [];
  const leaderboard = overview?.leaderboard ?? [];
  const latestScores = overview?.latest_scores ?? [];

  return (
    <>
      <PageHeader
        title="YabuBird Arena"
        description="Employee uygulamasindaki canli Flappy Bird odasini ve kalici leaderboard'u izleyin."
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

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Panel>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-sky-700">
                Live Room
              </p>
              <h3 className="mt-1 text-lg font-semibold text-slate-900">
                {liveRoom ? 'Canli oda aktif' : 'Su anda acik oda yok'}
              </h3>
              <p className="mt-2 text-sm text-slate-600">
                {liveRoom
                  ? 'Calisanlar ayni seed ve ayni zaman akisi uzerinden birlikte oynuyor.'
                  : 'Yeni bir calisan oyun turu baslatinca burada oda detaylari otomatik gorunur.'}
              </p>
            </div>
            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-right">
              <p className="text-xs uppercase tracking-[0.18em] text-sky-700">
                Son Guncelleme
              </p>
              <strong className="mt-1 block text-base text-slate-900">
                {formatClock(lastUpdatedAt)}
              </strong>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Oda anahtari</p>
              <strong className="mt-2 block break-all text-sm text-slate-900">
                {liveRoom?.room_key ?? '-'}
              </strong>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Seed</p>
              <strong className="mt-2 block text-sm text-slate-900">
                {liveRoom?.seed ?? '-'}
              </strong>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Baslangic</p>
              <strong className="mt-2 block text-sm text-slate-900">
                {formatClock(liveRoom?.started_at)}
              </strong>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Canli oyuncu</p>
              <strong className="mt-2 block text-sm text-slate-900">
                {livePlayers.length}
              </strong>
            </div>
          </div>

          <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">Oyuncu</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">Durum</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">Skor</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">Son gorulme</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {isLoading ? (
                  <tr>
                    <td className="px-4 py-4 text-slate-500" colSpan={4}>
                      YabuBird verileri yukleniyor...
                    </td>
                  </tr>
                ) : livePlayers.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-slate-500" colSpan={4}>
                      Aktif oyuncu yok.
                    </td>
                  </tr>
                ) : (
                  livePlayers.map((player) => (
                    <tr key={player.id}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span
                            className="h-3 w-3 rounded-full shadow-sm"
                            style={{ backgroundColor: player.color_hex }}
                            aria-hidden="true"
                          />
                          <div>
                            <p className="font-semibold text-slate-900">
                              {player.employee_name}
                            </p>
                            <p className="text-xs text-slate-500">
                              Flap {player.flap_count}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                            player.is_alive
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          {player.is_alive ? 'Ucus halinde' : 'Tur bitti'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900">
                        {player.latest_score}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-500">
                        {formatClock(player.last_seen_at)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel>
          <p className="text-xs font-black uppercase tracking-[0.24em] text-sky-700">
            Arena Ozeti
          </p>
          <h3 className="mt-1 text-lg font-semibold text-slate-900">
            YabuBird sistem durumu
          </h3>
          <div className="mt-5 space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                Leaderboard kaydi
              </p>
              <strong className="mt-2 block text-2xl text-slate-900">
                {leaderboard.length}
              </strong>
              <p className="mt-2 text-sm text-slate-600">
                Tekil en iyi skorlar kalici olarak saklaniyor.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                Son turlar
              </p>
              <strong className="mt-2 block text-2xl text-slate-900">
                {latestScores.length}
              </strong>
              <p className="mt-2 text-sm text-slate-600">
                En son biten oyunlar buradan izlenir.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                Oda durumu
              </p>
              <strong className="mt-2 block text-2xl text-slate-900">
                {liveRoom ? 'OPEN' : 'IDLE'}
              </strong>
              <p className="mt-2 text-sm text-slate-600">
                Chat yok; sadece ayni arena akisi ve skor takibi var.
              </p>
            </div>
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-sky-700">
                Leaderboard
              </p>
              <h3 className="mt-1 text-lg font-semibold text-slate-900">
                En yuksek YabuBird skorlar
              </h3>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              Top {leaderboard.length}
            </span>
          </div>

          <div className="mt-5 space-y-3">
            {leaderboard.length === 0 ? (
              <p className="text-sm text-slate-500">Henüz skor kaydı oluşmadı.</p>
            ) : (
              leaderboard.map((entry, index) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      #{index + 1} {entry.employee_name}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Oda {entry.room_id ?? '-'} / {formatClock(entry.created_at)}
                    </p>
                  </div>
                  <strong className="rounded-full bg-sky-100 px-3 py-1 text-sm text-sky-700">
                    {entry.score}
                  </strong>
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-sky-700">
                Latest Scores
              </p>
              <h3 className="mt-1 text-lg font-semibold text-slate-900">
                Son tamamlanan turlar
              </h3>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              Son {latestScores.length}
            </span>
          </div>

          <div className="mt-5 space-y-3">
            {latestScores.length === 0 ? (
              <p className="text-sm text-slate-500">Henüz biten tur kaydı yok.</p>
            ) : (
              latestScores.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {entry.employee_name}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatDuration(entry.survived_ms)} / {formatClock(entry.created_at)}
                    </p>
                  </div>
                  <strong className="rounded-full bg-emerald-100 px-3 py-1 text-sm text-emerald-700">
                    {entry.score}
                  </strong>
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}
