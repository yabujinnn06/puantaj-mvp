import { useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser'

function toCameraErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError' || error.name === 'SecurityError') {
      return 'Kamera izni verilmedi. Tarayıcı ayarlarından kamera izni verin.'
    }
    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
      return 'Kamera bulunamadı. Bu cihazda kullanılabilir kamera olmayabilir.'
    }
    if (error.name === 'NotReadableError' || error.name === 'AbortError') {
      return 'Kamera açılamadı. Başka bir uygulama kamerayı kullanıyor olabilir.'
    }
  }
  return 'Kamera açılamadı. Lütfen tekrar deneyin veya QR metnini manuel girin.'
}

export function QrScanner({
  active,
  onDetected,
  onError,
}: {
  active: boolean
  onDetected: (rawValue: string) => void
  onError: (message: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const readerRef = useRef<BrowserQRCodeReader | null>(null)
  const hasDetectedRef = useRef(false)
  const [isPreparing, setIsPreparing] = useState(false)

  useEffect(() => {
    const stop = () => {
      controlsRef.current?.stop()
      controlsRef.current = null

      const video = videoRef.current
      if (video?.srcObject) {
        const stream = video.srcObject as MediaStream
        stream.getTracks().forEach((track) => track.stop())
        video.srcObject = null
      }

      readerRef.current = null
      hasDetectedRef.current = false
      setIsPreparing(false)
    }

    const start = async () => {
      if (!active) {
        stop()
        return
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        onError('Bu tarayıcıda kamera erişimi desteklenmiyor.')
        return
      }

      if (!videoRef.current) {
        onError('Kamera alanı hazır değil. Sayfayı yenileyip tekrar deneyin.')
        return
      }

      setIsPreparing(true)
      hasDetectedRef.current = false
      const reader = new BrowserQRCodeReader(undefined, {
        delayBetweenScanAttempts: 250,
      })
      readerRef.current = reader

      try {
        const onResult = (result: { getText: () => string } | undefined) => {
          if (!result || hasDetectedRef.current) {
            return
          }

          const rawValue = result.getText().trim()
          if (!rawValue) {
            return
          }

          hasDetectedRef.current = true
          stop()
          onDetected(rawValue)
        }

        let controls: IScannerControls
        try {
          controls = await reader.decodeFromConstraints(
            {
              video: {
                facingMode: { ideal: 'environment' },
              },
            },
            videoRef.current,
            onResult,
          )
        } catch {
          controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, onResult)
        }

        controlsRef.current = controls
        setIsPreparing(false)
      } catch (error) {
        stop()
        onError(toCameraErrorMessage(error))
      }
    }

    void start()
    return () => {
      stop()
    }
  }, [active, onDetected, onError])

  return (
    <div className="scanner-wrap">
      <video ref={videoRef} className="scanner-video" playsInline muted />
      {isPreparing ? <div className="scanner-overlay">Kamera hazırlanıyor...</div> : null}
      <div className="scanner-frame-hint">Kodu çerçeve içine hizalayın</div>
    </div>
  )
}
