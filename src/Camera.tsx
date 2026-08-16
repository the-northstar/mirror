import { useCallback, useEffect, useRef, useState } from 'react'

export type CaptureMode = 'face' | 'body'

/**
 * Live camera capture.
 *
 * The two APIs want different framing (a close-up face for skin analysis, a
 * full-length standing shot for try-on), so the overlay guide changes with
 * `mode`. Getting framing right in the viewfinder is cheaper than a rejected
 * task, which costs a round trip and, on failure, still confuses the user.
 */
export function Camera({
  mode,
  onCapture,
  onCancel,
}: {
  mode: CaptureMode
  onCapture: (file: File) => void
  onCancel: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            // Selfie camera for faces, rear for full-body (someone else holds it).
            facingMode: mode === 'face' ? 'user' : 'environment',
            width: { ideal: 1440 },
            height: { ideal: 1920 },
          },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        setReady(true)
      } catch (err) {
        const e = err as DOMException
        setError(
          e.name === 'NotAllowedError'
            ? 'Camera access was blocked. Allow it in your browser settings, or upload a photo instead.'
            : e.name === 'NotFoundError'
              ? 'No camera found on this device. Upload a photo instead.'
              : 'Could not open the camera. Upload a photo instead.',
        )
      }
    })()

    return () => {
      cancelled = true
      stop()
    }
  }, [mode, stop])

  const shoot = () => {
    const video = videoRef.current
    if (!video) return

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // The preview is mirrored for the selfie camera because that is what people
    // expect; the saved frame must not be, or text and moles flip.
    ctx.drawImage(video, 0, 0)

    canvas.toBlob(
      (blob) => {
        if (!blob) return
        stop()
        onCapture(new File([blob], `${mode}.jpg`, { type: 'image/jpeg' }))
      },
      'image/jpeg',
      0.92,
    )
  }

  if (error) {
    return (
      <div className="cam-error">
        <p className="notice notice-error" role="alert">
          {error}
        </p>
        <button className="btn btn-quiet" onClick={onCancel}>
          Go back
        </button>
      </div>
    )
  }

  return (
    <div className="cam">
      <div className="cam-stage">
        <video
          ref={videoRef}
          className={mode === 'face' ? 'cam-video mirrored' : 'cam-video'}
          playsInline
          muted
          autoPlay
        />
        <div className={`cam-guide cam-guide-${mode}`} aria-hidden />
        <p className="cam-hint">
          {mode === 'face'
            ? 'Fill the oval with your face, even light, look straight ahead'
            : 'Stand back so your whole body fits the frame, facing forward'}
        </p>
      </div>

      <div className="cam-actions">
        <button className="textlink" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="shutter"
          onClick={shoot}
          disabled={!ready}
          aria-label="Take photo"
        />
        <span className="cam-spacer" />
      </div>
    </div>
  )
}
