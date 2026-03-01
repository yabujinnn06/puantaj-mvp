import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

import { eventSourceLabel, eventTypeLabel, formatDateTime, locationStatusLabel } from './utils'

export interface ManagementConsoleMapEvent {
  id: number
  employeeId: number
  employeeName: string
  departmentName: string | null
  lat: number
  lon: number
  accuracyM: number | null
  eventType: 'IN' | 'OUT'
  locationStatus: 'VERIFIED_HOME' | 'UNVERIFIED_LOCATION' | 'NO_LOCATION'
  tsUtc: string
  deviceId: number
  source: 'DEVICE' | 'MANUAL'
  note: string | null
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function clusterCellSize(zoom: number): number {
  if (zoom >= 15) return 0
  if (zoom >= 13) return 0.004
  if (zoom >= 11) return 0.008
  if (zoom >= 9) return 0.018
  return 0.03
}

function markerStyle(event: ManagementConsoleMapEvent, isFocused: boolean): L.CircleMarkerOptions {
  if (event.eventType === 'IN') {
    return {
      radius: isFocused ? 9 : 7,
      color: '#0f4c81',
      fillColor: '#2563eb',
      fillOpacity: 0.9,
      weight: isFocused ? 3 : 2,
    }
  }
  return {
    radius: isFocused ? 9 : 7,
    color: '#8a5a00',
    fillColor: '#d97706',
    fillOpacity: 0.9,
    weight: isFocused ? 3 : 2,
  }
}

function clusterIcon(count: number): L.DivIcon {
  return L.divIcon({
    className: 'mc-map__cluster',
    html: `<span>${count}</span>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  })
}

function popupHtml(event: ManagementConsoleMapEvent, showTechnicalDetails: boolean): string {
  const lines = [
    `<strong>${escapeHtml(event.employeeName)}</strong>`,
    `<div>${escapeHtml(eventTypeLabel(event.eventType))} • ${escapeHtml(formatDateTime(event.tsUtc))}</div>`,
    `<div>${escapeHtml(event.departmentName ?? 'Departman yok')}</div>`,
    `<div>Konum durumu: ${escapeHtml(locationStatusLabel(event.locationStatus))}</div>`,
  ]

  if (showTechnicalDetails) {
    lines.push(`<div>Cihaz: #${event.deviceId}</div>`)
    lines.push(`<div>Kaynak: ${escapeHtml(eventSourceLabel(event.source))}</div>`)
    lines.push(`<div>Koordinat: ${event.lat.toFixed(5)}, ${event.lon.toFixed(5)}</div>`)
    if (event.accuracyM != null) {
      lines.push(`<div>Doğruluk: ${Math.round(event.accuracyM)} m</div>`)
    }
    if (event.note) {
      lines.push(`<div>Not: ${escapeHtml(event.note)}</div>`)
    }
  }

  return `<div class="mc-map__popup">${lines.join('')}</div>`
}

export function ManagementConsoleMap({
  events,
  focusedEventId = null,
  showTechnicalDetails,
  onSelectEmployee,
}: {
  events: ManagementConsoleMapEvent[]
  focusedEventId?: number | null
  showTechnicalDetails: boolean
  onSelectEmployee: (employeeId: number) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const renderedMarkersRef = useRef<Map<number, L.Layer>>(new Map())
  const hasInitialFitRef = useRef(false)
  const [viewportVersion, setViewportVersion] = useState(0)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return
    }

    const map = L.map(containerRef.current, {
      center: [39.92077, 32.85411],
      zoom: 6,
      zoomControl: true,
      attributionControl: false,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map)

    map.on('moveend zoomend', () => {
      setViewportVersion((current) => current + 1)
    })

    mapRef.current = map
    layerRef.current = L.layerGroup().addTo(map)
    setViewportVersion((current) => current + 1)

    return () => {
      map.remove()
      mapRef.current = null
      layerRef.current = null
      renderedMarkersRef.current.clear()
      hasInitialFitRef.current = false
    }
  }, [])

  const clusteredEvents = useMemo(() => {
    if (!mapRef.current) {
      return []
    }

    const map = mapRef.current
    const bounds = map.getBounds().pad(0.25)
    const zoom = map.getZoom()
    const visibleEvents = events.filter((event) => bounds.contains([event.lat, event.lon]))
    const cellSize = clusterCellSize(zoom)

    if (cellSize <= 0) {
      return visibleEvents.map((event) => ({ kind: 'single' as const, event }))
    }

    const groups = new Map<string, ManagementConsoleMapEvent[]>()
    for (const event of visibleEvents) {
      const cellX = Math.floor(event.lat / cellSize)
      const cellY = Math.floor(event.lon / cellSize)
      const key = `${cellX}:${cellY}`
      groups.set(key, [...(groups.get(key) ?? []), event])
    }

    return [...groups.values()].map((group) => {
      if (group.length === 1) {
        return { kind: 'single' as const, event: group[0] }
      }

      const centerLat = group.reduce((sum, item) => sum + item.lat, 0) / group.length
      const centerLon = group.reduce((sum, item) => sum + item.lon, 0) / group.length
      return {
        kind: 'cluster' as const,
        eventIds: group.map((item) => item.id),
        count: group.length,
        centerLat,
        centerLon,
      }
    })
  }, [events, viewportVersion])

  useEffect(() => {
    if (!mapRef.current || !layerRef.current) {
      return
    }

    const map = mapRef.current
    const layer = layerRef.current
    layer.clearLayers()
    renderedMarkersRef.current.clear()

    if (!events.length) {
      hasInitialFitRef.current = false
      return
    }

    const latLngs: L.LatLngExpression[] = []

    clusteredEvents.forEach((item) => {
      if (item.kind === 'single') {
        const marker = L.circleMarker(
          [item.event.lat, item.event.lon],
          markerStyle(item.event, focusedEventId === item.event.id),
        )
          .bindPopup(popupHtml(item.event, showTechnicalDetails))
          .on('click', () => onSelectEmployee(item.event.employeeId))
          .addTo(layer)
        renderedMarkersRef.current.set(item.event.id, marker)
        latLngs.push([item.event.lat, item.event.lon])
        return
      }

      const marker = L.marker([item.centerLat, item.centerLon], { icon: clusterIcon(item.count) })
        .bindPopup(
          `<div class="mc-map__popup"><strong>${item.count} kayıt</strong><div>Küme görünümü</div></div>`,
        )
        .on('click', () => {
          map.setView([item.centerLat, item.centerLon], Math.min(map.getZoom() + 2, 16), { animate: true })
        })
        .addTo(layer)

      item.eventIds.forEach((eventId) => renderedMarkersRef.current.set(eventId, marker))
      latLngs.push([item.centerLat, item.centerLon])
    })

    if (!hasInitialFitRef.current && latLngs.length) {
      if (latLngs.length === 1) {
        map.setView(latLngs[0], 14, { animate: true })
      } else {
        map.fitBounds(L.latLngBounds(latLngs), {
          padding: [28, 28],
          maxZoom: 14,
          animate: true,
        })
      }
      hasInitialFitRef.current = true
    }

    window.setTimeout(() => map.invalidateSize(), 80)
  }, [clusteredEvents, events.length, focusedEventId, onSelectEmployee, showTechnicalDetails])

  useEffect(() => {
    if (!focusedEventId || !mapRef.current) {
      return
    }
    const marker = renderedMarkersRef.current.get(focusedEventId)
    if (!marker) {
      return
    }
    if ('getLatLng' in marker) {
      const markerWithLatLng = marker as L.Marker | L.CircleMarker
      mapRef.current.setView(markerWithLatLng.getLatLng(), Math.max(mapRef.current.getZoom(), 14), {
        animate: true,
      })
    }
    if ('openPopup' in marker) {
      marker.openPopup()
    }
  }, [focusedEventId])

  return <div ref={containerRef} className="mc-map" aria-label="Yönetim konsolu haritası" />
}
