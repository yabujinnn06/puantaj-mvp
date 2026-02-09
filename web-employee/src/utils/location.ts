export interface CurrentLocation {
  lat: number
  lon: number
  accuracy_m: number
}

export interface LocationFetchResult {
  location: CurrentLocation | null
  warning: string | null
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
        resolve({
          location: {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy_m: pos.coords.accuracy,
          },
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
