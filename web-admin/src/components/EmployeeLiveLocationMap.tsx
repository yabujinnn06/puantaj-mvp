import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export type EmployeeLiveLocationMapMarkerKind = 'latest' | 'first' | 'recent' | 'checkin' | 'checkout'

export type EmployeeLiveLocationMapMarker = {
  id: string
  lat: number
  lon: number
  label: string
  kind: EmployeeLiveLocationMapMarkerKind
}

type EmployeeLiveLocationMapProps = {
  markers: EmployeeLiveLocationMapMarker[]
  focusedMarkerId?: string | null
}

function markerStyle(kind: EmployeeLiveLocationMapMarkerKind): {
  color: string
  fillColor: string
  fillOpacity: number
  radius: number
  weight: number
} {
  if (kind === 'first') {
    return {
      radius: 10,
      color: '#7c3aed',
      fillColor: '#7c3aed',
      fillOpacity: 0.85,
      weight: 2,
    }
  }
  if (kind === 'recent') {
    return {
      radius: 7,
      color: '#1d4ed8',
      fillColor: '#bfdbfe',
      fillOpacity: 0.9,
      weight: 2,
    }
  }
  if (kind === 'checkin') {
    return {
      radius: 8,
      color: '#15803d',
      fillColor: '#15803d',
      fillOpacity: 0.85,
      weight: 2,
    }
  }
  if (kind === 'checkout') {
    return {
      radius: 11,
      color: '#be123c',
      fillColor: '#ffffff',
      fillOpacity: 0,
      weight: 3,
    }
  }
  return {
    radius: 9,
    color: '#0f6a8c',
    fillColor: '#0f6a8c',
    fillOpacity: 0.9,
    weight: 2,
  }
}

export function EmployeeLiveLocationMap({ markers, focusedMarkerId = null }: EmployeeLiveLocationMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const renderedMarkersRef = useRef<Map<string, L.CircleMarker>>(new Map())

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return
    }

    const initialLat = markers[0]?.lat ?? 41.015137
    const initialLon = markers[0]?.lon ?? 28.97953

    const map = L.map(mapContainerRef.current, {
      center: [initialLat, initialLon],
      zoom: 14,
      zoomControl: true,
    })
    mapRef.current = map

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap katki saglayanlar',
    }).addTo(map)

    layerRef.current = L.layerGroup().addTo(map)

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
      layerRef.current = null
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
    for (const marker of markers) {
      const key = `${marker.lat.toFixed(6)}:${marker.lon.toFixed(6)}`
      groupedByCoord.set(key, (groupedByCoord.get(key) ?? 0) + 1)
    }
    const groupedCursor = new Map<string, number>()

    for (const marker of markers) {
      const key = `${marker.lat.toFixed(6)}:${marker.lon.toFixed(6)}`
      const total = groupedByCoord.get(key) ?? 1
      const index = groupedCursor.get(key) ?? 0
      groupedCursor.set(key, index + 1)

      let displayLat = marker.lat
      let displayLon = marker.lon
      if (total > 1) {
        const angle = (2 * Math.PI * index) / total
        const offsetDeg = 0.00012
        displayLat = marker.lat + Math.sin(angle) * offsetDeg
        displayLon = marker.lon + Math.cos(angle) * offsetDeg
      }

      const style = markerStyle(marker.kind)
      const circleMarker = L.circleMarker([displayLat, displayLon], style)
        .bindPopup(
          `${marker.label}<br/>${marker.lat.toFixed(6)}, ${marker.lon.toFixed(6)}`,
        )
        .addTo(layer)
      renderedMarkersRef.current.set(marker.id, circleMarker)
      latLngs.push([displayLat, displayLon])
    }

    if (latLngs.length === 1) {
      map.setView(latLngs[0], 16, { animate: true })
      return
    }

    map.fitBounds(L.latLngBounds(latLngs), {
      padding: [24, 24],
      maxZoom: 17,
      animate: true,
    })
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
    mapRef.current.setView(markerLatLng, Math.max(mapRef.current.getZoom(), 16), { animate: true })
    marker.openPopup()
  }, [focusedMarkerId, markers])

  return (
    <div
      ref={mapContainerRef}
      className="h-72 w-full rounded-lg border border-slate-300 bg-slate-100"
      aria-label="Calisan konum haritasi"
    />
  )
}
