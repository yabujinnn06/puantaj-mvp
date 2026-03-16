import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

import type { LocationMonitorMapPoint, LocationMonitorPointSource } from '../../types/api'

function markerStyle(source: LocationMonitorPointSource): L.CircleMarkerOptions {
  if (source === 'CHECKIN') {
    return {
      radius: 5.5,
      color: '#15803d',
      fillColor: '#22c55e',
      fillOpacity: 0.9,
      weight: 2,
    }
  }
  if (source === 'CHECKOUT') {
    return {
      radius: 6.5,
      color: '#be123c',
      fillColor: '#ffffff',
      fillOpacity: 0.15,
      weight: 3,
    }
  }
  if (source === 'APP_OPEN') {
    return {
      radius: 4.75,
      color: '#b45309',
      fillColor: '#f59e0b',
      fillOpacity: 0.9,
      weight: 2,
    }
  }
  if (source === 'APP_CLOSE') {
    return {
      radius: 4.75,
      color: '#4338ca',
      fillColor: '#818cf8',
      fillOpacity: 0.9,
      weight: 2,
    }
  }
  if (source === 'DEMO_START' || source === 'DEMO_MARK') {
    return {
      radius: 5.25,
      color: '#0f766e',
      fillColor: '#22d3ee',
      fillOpacity: 0.95,
      weight: 2,
    }
  }
  if (source === 'DEMO_END') {
    return {
      radius: 5.25,
      color: '#6d28d9',
      fillColor: '#a78bfa',
      fillOpacity: 0.95,
      weight: 2,
    }
  }
  return {
    radius: 5.5,
    color: '#0369a1',
    fillColor: '#38bdf8',
    fillOpacity: 0.92,
    weight: 2,
  }
}

export function LocationMonitorMap({
  points,
  focusedPointId = null,
}: {
  points: LocationMonitorMapPoint[]
  focusedPointId?: string | null
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const markerRef = useRef<Map<string, L.CircleMarker>>(new Map())
  const invalidateTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return
    }
    const initial = points[0] ?? null
    const map = L.map(containerRef.current, {
      center: [initial?.lat ?? 41.015137, initial?.lon ?? 28.97953],
      zoom: 13,
      zoomControl: true,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
    })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap katki saglayanlar',
    }).addTo(map)
    mapRef.current = map
    layerRef.current = L.layerGroup().addTo(map)

    return () => {
      if (invalidateTimerRef.current != null) {
        window.clearTimeout(invalidateTimerRef.current)
        invalidateTimerRef.current = null
      }
      if (mapRef.current) {
        mapRef.current.stop()
        mapRef.current.remove()
      }
      mapRef.current = null
      layerRef.current = null
      markerRef.current.clear()
    }
  }, [points])

  useEffect(() => {
    if (!mapRef.current || !layerRef.current) {
      return
    }

    const map = mapRef.current
    const layer = layerRef.current
    layer.clearLayers()
    markerRef.current.clear()

    if (!points.length) {
      return
    }

    const sortedPoints = [...points].sort(
      (left, right) => new Date(left.ts_utc).getTime() - new Date(right.ts_utc).getTime(),
    )
    const groupedByCoord = new Map<string, number>()
    for (const point of sortedPoints) {
      const key = `${point.lat.toFixed(6)}:${point.lon.toFixed(6)}`
      groupedByCoord.set(key, (groupedByCoord.get(key) ?? 0) + 1)
    }
    const groupedCursor = new Map<string, number>()
    const pathLatLngs: L.LatLngExpression[] = []

    for (const point of sortedPoints) {
      const key = `${point.lat.toFixed(6)}:${point.lon.toFixed(6)}`
      const total = groupedByCoord.get(key) ?? 1
      const offsetIndex = groupedCursor.get(key) ?? 0
      groupedCursor.set(key, offsetIndex + 1)

      let displayLat = point.lat
      let displayLon = point.lon
      if (total > 1) {
        const angle = (2 * Math.PI * offsetIndex) / total
        const offset = 0.0001
        displayLat += Math.sin(angle) * offset
        displayLon += Math.cos(angle) * offset
      }

      pathLatLngs.push([displayLat, displayLon])
      const marker = L.circleMarker([displayLat, displayLon], markerStyle(point.source))
        .bindPopup(
          `<strong>${point.label}</strong><br/>${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`,
        )
        .addTo(layer)
      markerRef.current.set(point.id, marker)
    }

    if (pathLatLngs.length > 1) {
      L.polyline(pathLatLngs, {
        color: '#0f172a',
        opacity: 0.42,
        weight: 3,
      }).addTo(layer)
    }

    if (pathLatLngs.length === 1) {
      map.setView(pathLatLngs[0], 16, { animate: false })
    } else {
      map.fitBounds(L.latLngBounds(pathLatLngs), {
        padding: [28, 28],
        maxZoom: 16,
        animate: false,
      })
    }

    if (invalidateTimerRef.current != null) {
      window.clearTimeout(invalidateTimerRef.current)
    }
    invalidateTimerRef.current = window.setTimeout(() => {
      map.invalidateSize(false)
      invalidateTimerRef.current = null
    }, 90)
  }, [points])

  useEffect(() => {
    if (!focusedPointId || !mapRef.current) {
      return
    }
    const marker = markerRef.current.get(focusedPointId)
    if (!marker) {
      return
    }
    mapRef.current.setView(marker.getLatLng(), Math.max(mapRef.current.getZoom(), 16), { animate: false })
    marker.openPopup()
  }, [focusedPointId, points])

  return <div ref={containerRef} className="h-[26rem] w-full rounded-2xl border border-slate-200 bg-slate-100" />
}
