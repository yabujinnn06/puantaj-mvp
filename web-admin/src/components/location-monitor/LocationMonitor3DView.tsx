import { useMemo } from 'react'

import type { LocationMonitorMapPoint, LocationMonitorPointSource } from '../../types/api'

function sourceColor(source: LocationMonitorPointSource): string {
  if (source === 'CHECKIN') return '#22c55e'
  if (source === 'CHECKOUT') return '#f43f5e'
  if (source === 'APP_OPEN') return '#f59e0b'
  if (source === 'APP_CLOSE') return '#818cf8'
  return '#38bdf8'
}

function projectPoint(value: number, min: number, max: number): number {
  if (max <= min) {
    return 0.5
  }
  return (value - min) / (max - min)
}

export function LocationMonitor3DView({ points }: { points: LocationMonitorMapPoint[] }) {
  const scene = useMemo(() => {
    if (!points.length) {
      return null
    }
    const sorted = [...points].sort((left, right) => new Date(left.ts_utc).getTime() - new Date(right.ts_utc).getTime())
    const lats = sorted.map((item) => item.lat)
    const lons = sorted.map((item) => item.lon)
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    const minLon = Math.min(...lons)
    const maxLon = Math.max(...lons)

    const projected = sorted.map((point, index) => {
      const xNorm = projectPoint(point.lon, minLon, maxLon)
      const yNorm = projectPoint(point.lat, minLat, maxLat)
      const planeX = 88 + xNorm * 430
      const planeY = 250 - yNorm * 150
      const height = 36 + index * 14
      const isoX = planeX - planeY * 0.38
      const isoY = planeY * 0.48
      return {
        point,
        index,
        isoX,
        isoY,
        height,
      }
    })

    return projected
  }, [points])

  if (!scene?.length) {
    return (
      <div className="flex h-[26rem] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-950/95 px-6 text-sm text-slate-300">
        Secili aralikta 3D iz olusturacak konum kaydi yok.
      </div>
    )
  }

  const polyline = scene.map((item) => `${item.isoX},${item.isoY - item.height}`).join(' ')

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 px-3 py-3 text-slate-100 shadow-2xl">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.12),transparent_36%),linear-gradient(180deg,rgba(15,23,42,0.15),rgba(2,6,23,0.88))]" />
      <div className="absolute inset-x-0 bottom-0 h-28 bg-[linear-gradient(180deg,rgba(15,23,42,0),rgba(14,116,144,0.08)),repeating-linear-gradient(90deg,rgba(148,163,184,0.10)_0,rgba(148,163,184,0.10)_1px,transparent_1px,transparent_46px),repeating-linear-gradient(180deg,rgba(148,163,184,0.08)_0,rgba(148,163,184,0.08)_1px,transparent_1px,transparent_26px)]" />
      <svg viewBox="0 0 560 300" className="relative h-[26rem] w-full">
        <polyline
          points={polyline}
          fill="none"
          stroke="rgba(226,232,240,0.32)"
          strokeWidth="3"
          strokeDasharray="7 7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {scene.map((item) => {
          const color = sourceColor(item.point.source)
          return (
            <g key={item.point.id}>
              <line
                x1={item.isoX}
                y1={item.isoY}
                x2={item.isoX}
                y2={item.isoY - item.height}
                stroke={color}
                strokeOpacity="0.95"
                strokeWidth="5"
                strokeLinecap="round"
              />
              <ellipse
                cx={item.isoX}
                cy={item.isoY}
                rx="12"
                ry="5"
                fill={color}
                fillOpacity="0.22"
              />
              <circle
                cx={item.isoX}
                cy={item.isoY - item.height}
                r="9"
                fill={color}
                stroke="rgba(255,255,255,0.75)"
                strokeWidth="2"
              />
              <text
                x={item.isoX + 12}
                y={item.isoY - item.height - 10}
                fill="rgba(226,232,240,0.94)"
                fontSize="11"
                fontWeight="700"
              >
                {item.point.source}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="relative mt-2 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
        <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1">Check-in</span>
        <span className="rounded-full border border-rose-400/30 bg-rose-500/10 px-3 py-1">Check-out</span>
        <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1">App Open</span>
        <span className="rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3 py-1">App Close</span>
      </div>
    </div>
  )
}
