import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export type EmployeeLiveLocationMapMarkerKind = 'latest' | 'checkin' | 'checkout'

export type EmployeeLiveLocationMapMarker = {
  id: string
  lat: number
  lon: number
  label: string
  kind: EmployeeLiveLocationMapMarkerKind
}

type EmployeeLiveLocationMapProps = {
  markers: EmployeeLiveLocationMapMarker[]
}

function markerStyle(kind: EmployeeLiveLocationMapMarkerKind): {
  color: string
  fillColor: string
  fillOpacity: number
  radius: number
  weight: number
} {
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
      radius: 8,
      color: '#be123c',
      fillColor: '#be123c',
      fillOpacity: 0.85,
      weight: 2,
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

export function EmployeeLiveLocationMap({ markers }: EmployeeLiveLocationMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)

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

    if (!markers.length) {
      return
    }

    const latLngs: L.LatLngExpression[] = []
    for (const marker of markers) {
      const style = markerStyle(marker.kind)
      L.circleMarker([marker.lat, marker.lon], style)
        .bindPopup(
          `${marker.label}<br/>${marker.lat.toFixed(6)}, ${marker.lon.toFixed(6)}`,
        )
        .addTo(layer)
      latLngs.push([marker.lat, marker.lon])
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

  return (
    <div
      ref={mapContainerRef}
      className="h-72 w-full rounded-lg border border-slate-300 bg-slate-100"
      aria-label="Calisan konum haritasi"
    />
  )
}

