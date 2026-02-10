import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type QrPointMapPickerProps = {
  lat: number | null
  lon: number | null
  radiusM: number
  onSelect: (lat: number, lon: number) => void
}

const SCRIPT_ID = 'google-maps-sdk-script'
const DEFAULT_CENTER = { lat: 41.0082, lng: 28.9784 } // Istanbul

function getGoogleMapsApiKey(): string {
  return (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() ?? ''
}

function formatCoord(value: number): string {
  return value.toFixed(6)
}

async function loadGoogleMapsScript(apiKey: string): Promise<void> {
  if ((window as { google?: unknown }).google) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    if (existing) {
      if ((window as { google?: unknown }).google) {
        resolve()
        return
      }
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Google Maps script load failed')), {
        once: true,
      })
      return
    }

    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.async = true
    script.defer = true
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Google Maps script load failed'))
    document.head.appendChild(script)
  })
}

export function QrPointMapPicker({ lat, lon, radiusM, onSelect }: QrPointMapPickerProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const markerRef = useRef<any>(null)
  const circleRef = useRef<any>(null)
  const geocoderRef = useRef<any>(null)

  const [mapsReady, setMapsReady] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchBusy, setSearchBusy] = useState(false)
  const [loadingError, setLoadingError] = useState<string | null>(null)
  const [infoMessage, setInfoMessage] = useState<string | null>(null)

  const apiKey = getGoogleMapsApiKey()
  const hasApiKey = apiKey.length > 0
  const currentCenter = useMemo(() => {
    if (lat !== null && lon !== null) {
      return { lat, lng: lon }
    }
    return DEFAULT_CENTER
  }, [lat, lon])

  useEffect(() => {
    let cancelled = false

    if (!hasApiKey) {
      setLoadingError('Google Maps API key eksik. VITE_GOOGLE_MAPS_API_KEY tanimlayin.')
      setMapsReady(false)
      return () => {
        cancelled = true
      }
    }

    void loadGoogleMapsScript(apiKey)
      .then(() => {
        if (cancelled) return
        setMapsReady(true)
        setLoadingError(null)
      })
      .catch(() => {
        if (cancelled) return
        setMapsReady(false)
        setLoadingError('Google Maps yuklenemedi. API key, domain veya billing ayarini kontrol edin.')
      })

    return () => {
      cancelled = true
    }
  }, [apiKey, hasApiKey])

  useEffect(() => {
    if (!mapsReady || !mapContainerRef.current || mapRef.current) {
      return
    }

    const googleMaps = (window as { google?: any }).google
    if (!googleMaps?.maps) {
      setLoadingError('Google Maps nesnesi hazir degil.')
      return
    }

    const map = new googleMaps.maps.Map(mapContainerRef.current, {
      center: currentCenter,
      zoom: lat !== null && lon !== null ? 17 : 12,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: false,
      gestureHandling: 'greedy',
    })
    mapRef.current = map

    const marker = new googleMaps.maps.Marker({
      map,
      position: currentCenter,
      title: 'Secili nokta',
    })
    markerRef.current = marker

    const circle = new googleMaps.maps.Circle({
      map,
      center: currentCenter,
      radius: Number.isFinite(radiusM) && radiusM > 0 ? radiusM : 75,
      fillColor: '#0f6a8c',
      fillOpacity: 0.14,
      strokeColor: '#0f6a8c',
      strokeOpacity: 0.75,
      strokeWeight: 2,
    })
    circleRef.current = circle

    geocoderRef.current = new googleMaps.maps.Geocoder()

    map.addListener('click', (event: any) => {
      const clickedLat = event?.latLng?.lat?.()
      const clickedLng = event?.latLng?.lng?.()
      if (typeof clickedLat !== 'number' || typeof clickedLng !== 'number') return
      onSelect(clickedLat, clickedLng)
      setInfoMessage(`Haritadan secildi: ${formatCoord(clickedLat)}, ${formatCoord(clickedLng)}`)
    })
  }, [mapsReady, currentCenter, lat, lon, radiusM, onSelect])

  useEffect(() => {
    if (!mapRef.current || !markerRef.current || !circleRef.current) {
      return
    }

    const map = mapRef.current
    const marker = markerRef.current
    const circle = circleRef.current

    if (lat !== null && lon !== null) {
      const nextCenter = { lat, lng: lon }
      marker.setPosition(nextCenter)
      circle.setCenter(nextCenter)
      map.panTo(nextCenter)
    }

    const nextRadius = Number.isFinite(radiusM) && radiusM > 0 ? radiusM : 75
    circle.setRadius(nextRadius)
  }, [lat, lon, radiusM])

  const searchAddress = useCallback(() => {
    if (!mapsReady || !mapRef.current || !geocoderRef.current) {
      return
    }
    const query = searchQuery.trim()
    if (!query) {
      setInfoMessage('Lutfen adres veya lokasyon adi girin.')
      return
    }

    setSearchBusy(true)
    geocoderRef.current.geocode({ address: query }, (results: any[] | null, status: string) => {
      setSearchBusy(false)
      if (status !== 'OK' || !results || results.length === 0) {
        setInfoMessage('Adres bulunamadi. Daha net bir sorgu deneyin.')
        return
      }

      const location = results[0].geometry?.location
      const nextLat = typeof location?.lat === 'function' ? location.lat() : null
      const nextLng = typeof location?.lng === 'function' ? location.lng() : null
      if (typeof nextLat !== 'number' || typeof nextLng !== 'number') {
        setInfoMessage('Adres koordinata cevrilemedi.')
        return
      }

      onSelect(nextLat, nextLng)
      mapRef.current.setZoom(17)
      mapRef.current.panTo({ lat: nextLat, lng: nextLng })
      setInfoMessage(`Adres bulundu: ${formatCoord(nextLat)}, ${formatCoord(nextLng)}`)
    })
  }, [mapsReady, onSelect, searchQuery])

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
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Google Maps Nokta Secici</p>
      <p className="mt-1 text-xs text-slate-600">
        Haritaya tiklayarak veya adres arayarak lat/lon alanlarini otomatik doldurabilirsiniz.
      </p>

      {!hasApiKey ? (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Google Maps devre disi. VITE_GOOGLE_MAPS_API_KEY ekleyin.
        </div>
      ) : loadingError ? (
        <div className="mt-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {loadingError}
        </div>
      ) : null}

      <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto_auto]">
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Adres / isyeri / bolge adi ara"
          disabled={!mapsReady}
        />
        <button
          type="button"
          onClick={searchAddress}
          disabled={!mapsReady || searchBusy}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-white disabled:opacity-60"
        >
          {searchBusy ? 'Araniyor...' : 'Ara'}
        </button>
        <button
          type="button"
          onClick={pickCurrentLocation}
          disabled={!mapsReady}
          className="rounded-lg border border-brand-300 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-60"
        >
          Konumum
        </button>
      </div>

      <div
        ref={mapContainerRef}
        className="mt-3 h-64 w-full rounded-lg border border-slate-300 bg-slate-100"
        aria-label="Google maps qr point picker"
      />

      <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
        <span className="rounded-md bg-white px-2 py-1">
          Lat: {lat !== null ? formatCoord(lat) : '-'}
        </span>
        <span className="rounded-md bg-white px-2 py-1">
          Lon: {lon !== null ? formatCoord(lon) : '-'}
        </span>
        <span className="rounded-md bg-white px-2 py-1">Radius: {radiusM}m</span>
      </div>

      {infoMessage ? (
        <p className="mt-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600">{infoMessage}</p>
      ) : null}
    </div>
  )
}
