import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

import type {
  LocationMonitorGeofence,
  LocationMonitorMapPoint,
  LocationMonitorPointSource,
  LocationMonitorRepeatedPoint,
} from '../../types/api-yabujin'

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function markerStyle(
  source: LocationMonitorPointSource,
  markerKind: LocationMonitorMapPoint['marker_kind'],
  focused: boolean,
): L.CircleMarkerOptions {
  const base: L.CircleMarkerOptions = {
    radius: focused ? 8 : 6,
    color: '#0f172a',
    fillColor: '#38bdf8',
    fillOpacity: focused ? 0.95 : 0.88,
    weight: focused ? 3 : 2,
  }

  if (source === 'CHECKIN') {
    return { ...base, fillColor: '#22c55e', color: '#166534' }
  }
  if (source === 'CHECKOUT') {
    return { ...base, fillColor: '#f43f5e', color: '#9f1239', radius: focused ? 8.5 : 6.5 }
  }
  if (source === 'APP_OPEN') {
    return { ...base, fillColor: '#f59e0b', color: '#b45309', radius: focused ? 7.5 : 5.75 }
  }
  if (source === 'APP_CLOSE') {
    return { ...base, fillColor: '#818cf8', color: '#4338ca', radius: focused ? 7.5 : 5.75 }
  }
  if (source === 'DEMO_START') {
    return { ...base, fillColor: '#22d3ee', color: '#0f766e' }
  }
  if (source === 'DEMO_END') {
    return { ...base, fillColor: '#a78bfa', color: '#6d28d9' }
  }
  if (markerKind === 'JUMP') {
    return { ...base, fillColor: '#ef4444', color: '#7f1d1d', radius: focused ? 8.5 : 6.75 }
  }
  if (markerKind === 'LAST') {
    return { ...base, fillColor: '#0ea5e9', color: '#0f172a', radius: focused ? 9 : 7 }
  }
  return { ...base, fillColor: '#38bdf8', color: '#0369a1' }
}

function pointSourceLabel(value: LocationMonitorMapPoint['source']): string {
  if (value === 'CHECKIN') return 'Mesai girisi'
  if (value === 'CHECKOUT') return 'Mesai cikisi'
  if (value === 'APP_OPEN') return 'Uygulama girisi'
  if (value === 'APP_CLOSE') return 'Uygulama cikisi'
  if (value === 'DEMO_START') return 'Demo baslangici'
  if (value === 'DEMO_END') return 'Demo bitisi'
  if (value === 'LOCATION_PING') return 'Konum pingi'
  return 'Son bilinen konum'
}

function pointPopup(point: LocationMonitorMapPoint): string {
  const parsedDate = new Date(point.ts_utc)
  const timestamp = Number.isNaN(parsedDate.getTime()) ? point.ts_utc : DATE_TIME_FORMAT.format(parsedDate)
  const trust = point.trust_score == null ? '-' : `${point.trust_score}/100`
  const accuracy = point.accuracy_m == null ? '-' : `${Math.round(point.accuracy_m)} m`
  const geofence = point.geofence_status ?? '-'
  return [
    `<strong style="display:block;font-size:13px;margin-bottom:4px;">${point.label}</strong>`,
    `<div style="font-size:12px;line-height:1.5;">`,
    `<div><strong>Tip:</strong> ${pointSourceLabel(point.source)}</div>`,
    `<div><strong>Zaman:</strong> ${timestamp}</div>`,
    `<div><strong>Konum:</strong> ${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}</div>`,
    `<div><strong>Dogruluk:</strong> ${accuracy}</div>`,
    `<div><strong>Trust:</strong> ${trust}</div>`,
    `<div><strong>Geofence:</strong> ${geofence}</div>`,
    `<div><strong>Cihaz:</strong> ${point.device_id == null ? '-' : `#${point.device_id}`}</div>`,
    `<div><strong>IP:</strong> ${point.ip ?? '-'}</div>`,
    `</div>`,
  ].join('')
}

function buildDisplayPoints(points: LocationMonitorMapPoint[]): LocationMonitorMapPoint[] {
  return [...points].sort((left, right) => new Date(left.ts_utc).getTime() - new Date(right.ts_utc).getTime())
}

export function LocationMonitorMap({
  points,
  simplifiedPoints = [],
  repeatedGroups = [],
  geofence = null,
  focusedPointId = null,
  className = '',
}: {
  points: LocationMonitorMapPoint[]
  simplifiedPoints?: LocationMonitorMapPoint[]
  repeatedGroups?: LocationMonitorRepeatedPoint[]
  geofence?: LocationMonitorGeofence | null
  focusedPointId?: string | null
  className?: string
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

    const orderedPoints = buildDisplayPoints(points)
    const routePoints = buildDisplayPoints(simplifiedPoints.length ? simplifiedPoints : points)

    if (!orderedPoints.length && !(geofence?.home_lat != null && geofence?.home_lon != null)) {
      return
    }

    const bounds = L.latLngBounds([])
    const pathLatLngs: L.LatLngExpression[] = []

    if (geofence?.home_lat != null && geofence?.home_lon != null) {
      const geofenceCenter: L.LatLngExpression = [geofence.home_lat, geofence.home_lon]
      bounds.extend(geofenceCenter)
      if (geofence.radius_m != null && geofence.radius_m > 0) {
        L.circle(geofenceCenter, {
          radius: geofence.radius_m,
          color: geofence.status === 'OUTSIDE' ? '#f97316' : '#0f766e',
          opacity: 0.55,
          dashArray: '6 6',
          weight: 2,
          fillColor: geofence.status === 'OUTSIDE' ? '#fdba74' : '#99f6e4',
          fillOpacity: 0.08,
        }).addTo(layer)
      }
      L.circleMarker(geofenceCenter, {
        radius: 4,
        color: '#0f172a',
        fillColor: '#f8fafc',
        fillOpacity: 0.9,
        weight: 2,
      })
        .bindPopup('<strong>Geofence merkezi</strong>')
        .addTo(layer)
    }

    for (const group of repeatedGroups) {
      const groupLatLng: L.LatLngExpression = [group.lat, group.lon]
      bounds.extend(groupLatLng)
      L.circle(groupLatLng, {
        radius: Math.max(18, group.dwell_minutes * 2.5),
        color: '#7c3aed',
        opacity: 0.28,
        weight: 1.5,
        fillColor: '#a78bfa',
        fillOpacity: 0.08,
      })
        .bindPopup(
          `<strong>${group.label}</strong><br/>Bekleme: ${group.dwell_minutes} dk<br/>Tekrar: ${group.point_count} nokta`,
        )
        .addTo(layer)
    }

    for (const point of routePoints) {
      pathLatLngs.push([point.lat, point.lon])
      bounds.extend([point.lat, point.lon])
    }

    if (pathLatLngs.length > 1) {
      L.polyline(pathLatLngs, {
        color: '#0f172a',
        opacity: 0.22,
        weight: 6,
      }).addTo(layer)
      L.polyline(pathLatLngs, {
        color: '#0ea5e9',
        opacity: 0.78,
        weight: 3.25,
      }).addTo(layer)
    }

    const highlightedPoint = orderedPoints.find((point) => point.id === focusedPointId) ?? orderedPoints[orderedPoints.length - 1] ?? null

    for (const point of orderedPoints) {
      const isFocused = highlightedPoint?.id === point.id
      const marker = L.circleMarker(
        [point.lat, point.lon],
        markerStyle(point.source, point.marker_kind, isFocused),
      )
        .bindPopup(pointPopup(point))
        .addTo(layer)

      if (isFocused && point.accuracy_m != null && point.accuracy_m > 0) {
        L.circle([point.lat, point.lon], {
          radius: point.accuracy_m,
          color: '#38bdf8',
          opacity: 0.28,
          weight: 1.5,
          fillColor: '#7dd3fc',
          fillOpacity: 0.08,
        }).addTo(layer)
      }

      markerRef.current.set(point.id, marker)
    }

    if (bounds.isValid()) {
      map.fitBounds(bounds, {
        padding: [28, 28],
        maxZoom: orderedPoints.length <= 1 ? 17 : 16,
        animate: false,
      })
    }

    if (highlightedPoint) {
      map.setView([highlightedPoint.lat, highlightedPoint.lon], Math.max(map.getZoom(), 15.5), { animate: false })
    }

    if (invalidateTimerRef.current != null) {
      window.clearTimeout(invalidateTimerRef.current)
    }
    invalidateTimerRef.current = window.setTimeout(() => {
      map.invalidateSize(false)
      invalidateTimerRef.current = null
    }, 90)
  }, [focusedPointId, geofence, points, repeatedGroups, simplifiedPoints])

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

  return (
    <div
      ref={containerRef}
      className={`w-full rounded-2xl border border-slate-200 bg-slate-100 ${className || 'h-[33rem]'}`}
    />
  )
}
