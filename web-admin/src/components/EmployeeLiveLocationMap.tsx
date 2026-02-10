import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

type EmployeeLiveLocationMapProps = {
  lat: number
  lon: number
}

export function EmployeeLiveLocationMap({ lat, lon }: EmployeeLiveLocationMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.CircleMarker | null>(null)

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return
    }

    const map = L.map(mapContainerRef.current, {
      center: [lat, lon],
      zoom: 16,
      zoomControl: true,
    })
    mapRef.current = map

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap katki saglayanlar',
    }).addTo(map)

    markerRef.current = L.circleMarker([lat, lon], {
      radius: 9,
      color: '#0f6a8c',
      fillColor: '#0f6a8c',
      fillOpacity: 0.9,
      weight: 2,
    }).addTo(map)

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
      markerRef.current = null
    }
  }, [lat, lon])

  useEffect(() => {
    if (!mapRef.current || !markerRef.current) {
      return
    }
    markerRef.current.setLatLng([lat, lon])
    mapRef.current.setView([lat, lon], mapRef.current.getZoom(), { animate: true })
  }, [lat, lon])

  return (
    <div
      ref={mapContainerRef}
      className="h-64 w-full rounded-lg border border-slate-300 bg-slate-100"
      aria-label="Calisan son konum haritasi"
    />
  )
}

