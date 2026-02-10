import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

type QrPointMapPickerProps = {
  lat: number | null
  lon: number | null
  radiusM: number
  onSelect: (lat: number, lon: number) => void
}

type NominatimResult = {
  lat: string
  lon: string
  display_name?: string
}

const DEFAULT_CENTER: [number, number] = [41.0082, 28.9784] // Istanbul

function formatCoord(value: number): string {
  return value.toFixed(6)
}

export function QrPointMapPicker({ lat, lon, radiusM, onSelect }: QrPointMapPickerProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.CircleMarker | null>(null)
  const circleRef = useRef<L.Circle | null>(null)

  const [mapReady, setMapReady] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchBusy, setSearchBusy] = useState(false)
  const [loadingError, setLoadingError] = useState<string | null>(null)
  const [infoMessage, setInfoMessage] = useState<string | null>(null)

  const currentCenter = useMemo<[number, number]>(() => {
    if (lat !== null && lon !== null) {
      return [lat, lon]
    }
    return DEFAULT_CENTER
  }, [lat, lon])

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return
    }

    try {
      const map = L.map(mapContainerRef.current, {
        center: currentCenter,
        zoom: lat !== null && lon !== null ? 17 : 12,
        zoomControl: true,
      })
      mapRef.current = map

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap katkida bulunanlar',
      }).addTo(map)

      const marker = L.circleMarker(currentCenter, {
        radius: 8,
        color: '#0f6a8c',
        fillColor: '#0f6a8c',
        fillOpacity: 0.85,
        weight: 2,
      }).addTo(map)
      markerRef.current = marker

      const circle = L.circle(currentCenter, {
        radius: Number.isFinite(radiusM) && radiusM > 0 ? radiusM : 75,
        color: '#0f6a8c',
        fillColor: '#0f6a8c',
        fillOpacity: 0.14,
        weight: 2,
      }).addTo(map)
      circleRef.current = circle

      map.on('click', (event: L.LeafletMouseEvent) => {
        const clickedLat = event.latlng.lat
        const clickedLng = event.latlng.lng
        onSelect(clickedLat, clickedLng)
        setInfoMessage(`Haritadan secildi: ${formatCoord(clickedLat)}, ${formatCoord(clickedLng)}`)
      })

      setMapReady(true)
      setLoadingError(null)
    } catch {
      setLoadingError('Harita yuklenemedi. Lutfen tekrar deneyin.')
      setMapReady(false)
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
      markerRef.current = null
      circleRef.current = null
      setMapReady(false)
    }
  }, [currentCenter, lat, lon, onSelect, radiusM])

  useEffect(() => {
    if (!mapRef.current || !markerRef.current || !circleRef.current) {
      return
    }

    const map = mapRef.current
    const marker = markerRef.current
    const circle = circleRef.current

    if (lat !== null && lon !== null) {
      const nextCenter: [number, number] = [lat, lon]
      marker.setLatLng(nextCenter)
      circle.setLatLng(nextCenter)
      map.panTo(nextCenter, { animate: true })
    }

    const nextRadius = Number.isFinite(radiusM) && radiusM > 0 ? radiusM : 75
    circle.setRadius(nextRadius)
  }, [lat, lon, radiusM])

  const searchAddress = useCallback(async () => {
    if (!mapReady || !mapRef.current) {
      return
    }
    const query = searchQuery.trim()
    if (!query) {
      setInfoMessage('Lutfen adres veya lokasyon adi girin.')
      return
    }

    setSearchBusy(true)
    try {
      const url = new URL('https://nominatim.openstreetmap.org/search')
      url.searchParams.set('q', query)
      url.searchParams.set('format', 'json')
      url.searchParams.set('limit', '1')
      url.searchParams.set('addressdetails', '1')
      url.searchParams.set('accept-language', 'tr')

      const response = await fetch(url.toString(), {
        headers: {
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error('search_failed')
      }

      const results = (await response.json()) as NominatimResult[]
      if (!Array.isArray(results) || results.length === 0) {
        setInfoMessage('Adres bulunamadi. Daha net bir sorgu deneyin.')
        return
      }

      const first = results[0]
      const nextLat = Number(first.lat)
      const nextLng = Number(first.lon)
      if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) {
        setInfoMessage('Adres koordinata cevrilemedi.')
        return
      }

      onSelect(nextLat, nextLng)
      mapRef.current.setView([nextLat, nextLng], 17, { animate: true })
      setInfoMessage(
        `Adres bulundu: ${formatCoord(nextLat)}, ${formatCoord(nextLng)}${first.display_name ? ` (${first.display_name})` : ''}`,
      )
    } catch {
      setInfoMessage('Adres aramasi gecici olarak kullanilamiyor. Lutfen tekrar deneyin.')
    } finally {
      setSearchBusy(false)
    }
  }, [mapReady, onSelect, searchQuery])

  const pickCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setInfoMessage('Tarayiciniz konum API destegi vermiyor.')
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLat = position.coords.latitude
        const nextLng = position.coords.longitude
        onSelect(nextLat, nextLng)
        setInfoMessage(`Mevcut konum alindi: ${formatCoord(nextLat)}, ${formatCoord(nextLng)}`)
      },
      () => {
        setInfoMessage('Konum alinamadi. Konum iznini kontrol edin.')
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      },
    )
  }, [onSelect])

  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50/40 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Harita Nokta Secici (Ucretsiz)</p>
      <p className="mt-1 text-xs text-slate-600">
        OpenStreetMap uzerinden haritaya tiklayarak veya adres arayarak lat/lon alanlarini otomatik doldurabilirsiniz.
      </p>

      {loadingError ? (
        <div className="mt-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {loadingError}
        </div>
      ) : (
        <div className="mt-3 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          API key gerektirmez. OpenStreetMap/Nominatim kullanilir.
        </div>
      )}

      <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto_auto]">
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Adres / isyeri / bolge adi ara"
          disabled={!mapReady}
        />
        <button
          type="button"
          onClick={() => {
            void searchAddress()
          }}
          disabled={!mapReady || searchBusy}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-white disabled:opacity-60"
        >
          {searchBusy ? 'Araniyor...' : 'Ara'}
        </button>
        <button
          type="button"
          onClick={pickCurrentLocation}
          disabled={!mapReady}
          className="rounded-lg border border-brand-300 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-60"
        >
          Konumum
        </button>
      </div>

      <div
        ref={mapContainerRef}
        className="mt-3 h-64 w-full rounded-lg border border-slate-300 bg-slate-100"
        aria-label="OpenStreetMap qr point picker"
      />

      <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
        <span className="rounded-md bg-white px-2 py-1">Lat: {lat !== null ? formatCoord(lat) : '-'}</span>
        <span className="rounded-md bg-white px-2 py-1">Lon: {lon !== null ? formatCoord(lon) : '-'}</span>
        <span className="rounded-md bg-white px-2 py-1">Radius: {radiusM}m</span>
      </div>

      {infoMessage ? (
        <p className="mt-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600">{infoMessage}</p>
      ) : null}
    </div>
  )
}
