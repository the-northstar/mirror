import { useEffect, useRef, useState } from 'react'
import { analyzeSkin, tryOn, type AnalyzeResponse } from './lib/api'
import { buildStyleProfile, type StyleProfile } from './lib/styleProfile'
import { GARMENTS, rankGarments, type Garment } from './lib/garments'
import './App.css'

type Stage = 'capture' | 'report'

export default function App() {
  const [stage, setStage] = useState<Stage>('capture')
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null)
  const [profile, setProfile] = useState<StyleProfile | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)

  const reset = () => {
    setStage('capture')
    setAnalysis(null)
    setProfile(null)
    if (photo) URL.revokeObjectURL(photo)
    setPhoto(null)
  }

  return (
    <div className="shell">
      <Header onReset={stage === 'report' ? reset : undefined} />
      {stage === 'capture' ? (
        <Capture
          onDone={(res, file) => {
            setAnalysis(res)
            setProfile(buildStyleProfile(res.scores))
            setPhoto(URL.createObjectURL(file))
            setStage('report')
          }}
        />
      ) : (
        analysis &&
        profile && <Report analysis={analysis} profile={profile} photo={photo} />
      )}
    </div>
  )
}

function Header({ onReset }: { onReset?: () => void }) {
  return (
    <header className="masthead">
      <div>
        <h1 className="wordmark">Mirror</h1>
        <p className="muted">Skin analysis that picks your clothes.</p>
      </div>
      {onReset && (
        <button className="link-btn" onClick={onReset}>
          Start over
        </button>
      )}
    </header>
  )
}

/* -- Capture ------------------------------------------------------------ */

function Capture({
  onDone,
}: {
  onDone: (res: AnalyzeResponse, file: File) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Analysis can outlive the screen if the user navigates away mid-flight.
  useEffect(() => () => abortRef.current?.abort(), [])

  const run = async (file: File) => {
    setBusy(true)
    setError(null)
    abortRef.current = new AbortController()
    try {
      onDone(await analyzeSkin(file, abortRef.current.signal), file)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (busy) return <AnalysingState />

  return (
    <main className="stack">
      <section className="card hero-card">
        <h2>Start with a selfie</h2>
        <p>
          We read 8 skin signals, then work out which colours flatter your
          complexion and show you wearing them.
        </p>
      </section>

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        capture="user"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) run(file)
          e.target.value = ''
        }}
      />
      <button className="btn" onClick={() => inputRef.current?.click()}>
        Take or choose a photo
      </button>
      <p className="muted fineprint">
        Front-facing, even lighting, face filling most of the frame. Your photo
        goes to Perfect Corp's YouCam API for analysis and is not stored by us.
      </p>
    </main>
  )
}

/** Honest progress: the API genuinely takes this long, so we say what it does. */
function AnalysingState() {
  const steps = ['Uploading your photo', 'Reading skin signals', 'Building your palette']
  const [step, setStep] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setStep((s) => Math.min(s + 1, steps.length - 1)), 4000)
    return () => clearInterval(id)
  }, [])

  return (
    <main className="stack" aria-live="polite">
      <div className="skeleton" style={{ height: 200 }} />
      <p className="analysing">{steps[step]}…</p>
      <div className="skeleton" style={{ height: 64 }} />
      <div className="skeleton" style={{ height: 64 }} />
    </main>
  )
}

/* -- Report ------------------------------------------------------------- */

const LABELS: Record<string, string> = {
  redness: 'Redness',
  age_spot: 'Age spots',
  texture: 'Texture',
  acne: 'Acne',
  oiliness: 'Oiliness',
  moisture: 'Moisture',
  radiance: 'Radiance',
  pore: 'Pores',
}

function Report({
  analysis,
  profile,
  photo,
}: {
  analysis: AnalyzeResponse
  profile: StyleProfile
  photo: string | null
}) {
  const ranked = rankGarments(
    GARMENTS,
    profile.recommendedColors,
    profile.avoidColors,
  )

  return (
    <main className="stack">
      <section className="card">
        <h2>Your skin, right now</h2>
        <p className="fineprint muted">
          Scored 0-100, where higher is healthier.
        </p>
        <ul className="scores">
          {Object.entries(analysis.scores).map(([key, score]) => (
            <li key={key}>
              <span>{LABELS[key] ?? key}</span>
              <span className="score-bar" aria-hidden>
                <span style={{ width: `${score}%` }} />
              </span>
              <span className="num">{Math.round(score)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Why these colours</h2>
        <div className="stack">
          {profile.rationale.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <div className="swatches">
          {profile.recommendedColors.map((c) => (
            <span key={c.name} className="swatch" title={c.reason}>
              <i style={{ background: c.hex }} />
              {c.name}
            </span>
          ))}
        </div>
      </section>

      <section className="stack">
        <h2>Try them on</h2>
        {ranked.map((g) => (
          <GarmentRow key={g.id} garment={g} modelFileId={analysis.modelFileId} photo={photo} />
        ))}
      </section>
    </main>
  )
}

function GarmentRow({
  garment,
  modelFileId,
  photo,
}: {
  garment: Garment & { verdict: 'recommended' | 'caution' | 'neutral'; reason?: string }
  modelFileId: string
  photo: string | null
}) {
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const run = async () => {
    setBusy(true)
    setError(null)
    abortRef.current = new AbortController()
    try {
      const { url } = await tryOn(
        modelFileId,
        garment.url,
        garment.category,
        abortRef.current.signal,
      )
      setResult(url)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="card garment">
      <div className="garment-head">
        <i className="dot" style={{ background: garment.hex }} aria-hidden />
        <div>
          <h3>{garment.name}</h3>
          {garment.reason && (
            <p className={garment.verdict === 'caution' ? 'reason warn' : 'reason'}>
              {garment.verdict === 'caution' ? 'Worth knowing: ' : ''}
              {garment.reason}
            </p>
          )}
        </div>
      </div>

      {busy && <div className="skeleton try-frame" />}

      {!busy && result && (
        <img className="try-frame" src={result} alt={`You wearing the ${garment.name}`} />
      )}

      {!busy && !result && photo && (
        <img className="try-frame ghost" src={photo} alt="" />
      )}

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}

      <button className="btn btn-ghost" onClick={run} disabled={busy}>
        {busy ? 'Rendering…' : result ? 'Try again' : 'See it on me'}
      </button>
    </article>
  )
}
