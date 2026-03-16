export interface CurrentLocation {
  lat: number
  lon: number
  accuracy_m: number
}

export interface LocationFetchResult {
  location: CurrentLocation | null
  warning: string | null
}

const LAST_KNOWN_LOCATION_STORAGE = 'employee_last_known_location'

export function cacheCurrentLocation(location: CurrentLocation | null): void {
  if (typeof window === 'undefined') {
    return
  }
  if (!location) {
    window.sessionStorage.removeItem(LAST_KNOWN_LOCATION_STORAGE)
    return
  }
  window.sessionStorage.setItem(LAST_KNOWN_LOCATION_STORAGE, JSON.stringify(location))
}

export function getCachedLocation(): CurrentLocation | null {
  if (typeof window === 'undefined') {
    return null
  }
  const raw = window.sessionStorage.getItem(LAST_KNOWN_LOCATION_STORAGE)
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CurrentLocation>
    if (
      typeof parsed.lat === 'number' &&
      typeof parsed.lon === 'number' &&
      typeof parsed.accuracy_m === 'number'
    ) {
      return {
        lat: parsed.lat,
        lon: parsed.lon,
        accuracy_m: parsed.accuracy_m,
      }
    }
  } catch {
    window.sessionStorage.removeItem(LAST_KNOWN_LOCATION_STORAGE)
  }
  return null
}

export async function getCurrentLocation(timeoutMs = 8000): Promise<LocationFetchResult> {
  if (!navigator.geolocation) {
    return {
      location: null,
      warning: 'Bu cihazda konum desteği yok. Kayıt konum bilgisi olmadan gönderildi.',
    }
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const location = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy_m: pos.coords.accuracy,
        }
        cacheCurrentLocation(location)
        resolve({
          location,
          warning: null,
        })
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          resolve({
            location: null,
            warning: 'Konum izni verilmedi. Kayıt konum bilgisi olmadan gönderildi.',
          })
          return
        }
        resolve({
          location: null,
          warning: 'Konum alınamadı. Kayıt konum bilgisi olmadan gönderildi.',
        })
      },
      {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 10000,
      },
    )
  })
}
