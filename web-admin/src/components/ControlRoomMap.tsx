import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

import type { ControlRoomLocationState } from '../types/api'

export interface ControlRoomMapMarker {
  id: string
  lat: number
  lon: number
  label: string
  todayStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'FINISHED'
  locationState: ControlRoomLocationState
}

function markerStyle(marker: ControlRoomMapMarker): {
  color: string
  fillColor: string
  fillOpacity: number
  radius: number
  weight: number
} {
  if (marker.todayStatus === 'IN_PROGRESS' && marker.locationState === 'LIVE') {
    return {
      radius: 9,
      color: '#74ff9a',
      fillColor: '#74ff9a',
      fillOpacity: 0.9,
      weight: 2,
    }
  }
  if (marker.locationState === 'STALE') {
    return {
      radius: 8,
      color: '#ffd166',
      fillColor: '#ffd166',
      fillOpacity: 0.86,
      weight: 2,
    }
  }
  if (marker.todayStatus === 'NOT_STARTED') {
    return {
      radius: 8,
      color: '#ff6b6b',
      fillColor: '#ff6b6b',
      fillOpacity: 0.82,
      weight: 2,
    }
  }
  if (marker.locationState === 'DORMANT') {
    return {
      radius: 7,
      color: '#8fb6d9',
      fillColor: '#0b1520',
      fillOpacity: 0.72,
      weight: 2,
    }
  }
  return {
    radius: 8,
    color: '#40e0d0',
    fillColor: '#40e0d0',
    fillOpacity: 0.82,
    weight: 2,
  }
}

export function ControlRoomMap({
  markers,
  focusedMarkerId = null,
}: {
  markers: ControlRoomMapMarker[]
  focusedMarkerId?: string | null
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const renderedMarkersRef = useRef<Map<string, L.CircleMarker>>(new Map())

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return
    }

    const initialLat = markers[0]?.lat ?? 39.92077
    const initialLon = markers[0]?.lon ?? 32.85411
    const map = L.map(mapContainerRef.current, {
      center: [initialLat, initialLon],
      zoom: 6,
      zoomControl: true,
      attributionControl: false,
    })
    mapRef.current = map

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map)

    layerRef.current = L.layerGroup().addTo(map)

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
      layerRef.current = null
      renderedMarkersRef.current.clear()
    }
  }, [markers])

  useEffect(() => {
    if (!mapRef.current || !layerRef.current) {
      return
    }

    const map = mapRef.current
    const layer = layerRef.current
    layer.clearLayers()
    renderedMarkersRef.current.clear()

    if (!markers.length) {
      return
    }

    const latLngs: L.LatLngExpression[] = []
    const groupedByCoord = new Map<string, number>()
    const groupedCursor = new Map<string, number>()

    for (const marker of markers) {
      const coordKey = `${marker.lat.toFixed(6)}:${marker.lon.toFixed(6)}`
      groupedByCoord.set(coordKey, (groupedByCoord.get(coordKey) ?? 0) + 1)
    }

    for (const marker of markers) {
      const coordKey = `${marker.lat.toFixed(6)}:${marker.lon.toFixed(6)}`
      const total = groupedByCoord.get(coordKey) ?? 1
      const index = groupedCursor.get(coordKey) ?? 0
      groupedCursor.set(coordKey, index + 1)

      let displayLat = marker.lat
      let displayLon = marker.lon
      if (total > 1) {
        const angle = (2 * Math.PI * index) / total
        const offsetDeg = 0.00018
        displayLat = marker.lat + Math.sin(angle) * offsetDeg
        displayLon = marker.lon + Math.cos(angle) * offsetDeg
      }

      const circleMarker = L.circleMarker([displayLat, displayLon], markerStyle(marker))
        .bindPopup(`${marker.label}<br/>${marker.lat.toFixed(5)}, ${marker.lon.toFixed(5)}`)
        .addTo(layer)

      renderedMarkersRef.current.set(marker.id, circleMarker)
      latLngs.push([displayLat, displayLon])
    }

    if (latLngs.length === 1) {
      map.setView(latLngs[0], 15, { animate: true })
    } else {
      map.fitBounds(L.latLngBounds(latLngs), {
        padding: [26, 26],
        maxZoom: 15,
        animate: true,
      })
    }

    window.setTimeout(() => {
      map.invalidateSize()
    }, 80)
  }, [markers])

  useEffect(() => {
    if (!focusedMarkerId || !mapRef.current) {
      return
    }
    const marker = renderedMarkersRef.current.get(focusedMarkerId)
    if (!marker) {
      return
    }
    const markerLatLng = marker.getLatLng()
    mapRef.current.setView(markerLatLng, Math.max(mapRef.current.getZoom(), 14), { animate: true })
    marker.openPopup()
  }, [focusedMarkerId, markers])

  return (
    <div
      ref={mapContainerRef}
      className="control-room-map-canvas"
      aria-label="Kontrol odasi calisan haritasi"
    />
  )
}
