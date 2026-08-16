import { useEffect, useRef, useState } from 'react'
import { analyzeSkin, tryOn, type AnalyzeResponse } from './lib/api'
import {
  buildStyleProfile,
  CONCERN_LABELS,
  type StyleProfile,
} from './lib/styleProfile'
import { GARMENTS, rankGarments, type Garment } from './lib/garments'
import { Camera } from './Camera'
import './App.css'

type Tab = 'scan' | 'report' | 'try'

interface Session {
  analysis: AnalyzeResponse
  profile: StyleProfile
  selfie: string
}

export default function App() {
  const [tab, setTab] = useState<Tab>('scan')
  const [session, setSession] = useState<Session | null>(null)
  /** Full-body shot, kept separate: try-on needs a standing pose, not a face. */
  const [bodyFileId, setBodyFileId] = useState<string | null>(null)
  const [bodyPhoto, setBodyPhoto] = useState<string | null>(null)

  const reset = () => {
    if (session) URL.revokeObjectURL(session.selfie)
    if (bodyPhoto) URL.revokeObjectURL(bodyPhoto)
    setSession(null)
    setBodyFileId(null)
    setBodyPhoto(null)
    setTab('scan')
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Mirror</span>
        {session && (
          <button className="textlink" onClick={reset}>
            Start over
          </button>
        )}
      </header>

      {tab === 'scan' && (
        <Scan
          session={session}
          onDone={(analysis, selfie) => {
            setSession({
              analysis,
              profile: buildStyleProfile(analysis.scores),
              selfie,
            })
            setTab('report')
          }}
        />
      )}

      {tab === 'report' &&
        (session ? (
          <Report session={session} onTry={() => setTab('try')} />
        ) : (
          <Locked onGo={() => setTab('scan')} />
        ))}

      {tab === 'try' &&
        (session ? (
          <TryOn
            profile={session.profile}
            bodyFileId={bodyFileId}
            bodyPhoto={bodyPhoto}
            onBody={(id, url) => {
              setBodyFileId(id)
              setBodyPhoto(url)
            }}
          />
        ) : (
          <Locked onGo={() => setTab('scan')} />
        ))}

      <nav className="tabbar" aria-label="Sections">
        {(
          [
            ['scan', 'Scan'],
            ['report', 'Report'],
            ['try', 'Try on'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? 'tab active' : 'tab'}
            aria-current={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}

function Locked({ onGo }: { onGo: () => void }) {
  return (
    <main className="pad stack">
      <div className="card empty">
        <h2>Nothing to show yet</h2>
        <p>Scan your skin first and this fills in.</p>
        <button className="btn" onClick={onGo}>
          Start a scan
        </button>
      </div>
    </main>
  )
}

/* -- Scan --------------------------------------------------------------- */

function Scan({
  session,
  onDone,
}: {
  session: Session | null
  onDone: (res: AnalyzeResponse, selfie: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shooting, setShooting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const run = async (file: File) => {
    setBusy(true)
    setError(null)
    abortRef.current = new AbortController()
    try {
      const res = await analyzeSkin(file, abortRef.current.signal)
      onDone(res, URL.createObjectURL(file))
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (busy) return <Working caption="Reading your skin" />

  if (shooting) {
    return (
      <Camera
        mode="face"
        onCancel={() => setShooting(false)}
        onCapture={(file) => {
          setShooting(false)
          run(file)
        }}
      />
    )
  }

  return (
    <main className="pad stack">
      <section className="hero">
        <h1 className="display hero-title">
          Your skin
          <br />
          picks your
          <br />
          wardrobe.
        </h1>
        <p className="hero-sub">
          One selfie. Eight skin readings. A palette chosen from what your face
          is actually doing, then worn on you.
        </p>
      </section>

      {session && (
        <div className="card done-note">
          <img src={session.selfie} alt="" className="thumb" />
          <div>
            <strong>Scan complete</strong>
            <p className="tiny">Open Report to see your palette.</p>
          </div>
        </div>
      )}

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
      <button className="btn" onClick={() => setShooting(true)}>
        {session ? 'Scan again' : 'Open camera'}
      </button>
      <button className="btn btn-quiet" onClick={() => inputRef.current?.click()}>
        Upload a photo instead
      </button>

      <ul className="guides">
        <li>Face the camera straight on</li>
        <li>Even light, no hard shadows</li>
        <li>Fill the frame with your face, shoulders up</li>
      </ul>
      <p className="tiny">
        Your photo goes to Perfect Corp's YouCam API for analysis. We do not
        store it.
      </p>
    </main>
  )
}

function Working({ caption }: { caption: string }) {
  return (
    <main className="pad stack" aria-live="polite">
      <div className="skeleton" style={{ height: 260, borderRadius: 18 }} />
      <p className="working">{caption}…</p>
      <div className="skeleton" style={{ height: 56 }} />
      <div className="skeleton" style={{ height: 56 }} />
    </main>
  )
}

/* -- Report ------------------------------------------------------------- */

function Report({ session, onTry }: { session: Session; onTry: () => void }) {
  const { analysis, profile, selfie } = session
  const top = profile.ranked.slice(0, 4)

  return (
    <main className="stack rise">
      <section className="reveal pad">
        <img src={selfie} alt="Your scan" className="reveal-photo" />
        <div className="reveal-meta">
          <h2 className="display reveal-title">{profile.undertone} undertone</h2>
        </div>
      </section>

      <section className="pad stack">
        <div className="card">
          <h3>Most pronounced</h3>
          <p className="tiny">
            Ranked by how much each shows, out of eight readings.
          </p>
          <ul className="bars">
            {top.map((r) => (
              <li key={r.key}>
                <span>{CONCERN_LABELS[r.key] ?? r.key}</span>
                <span className="bar" aria-hidden>
                  <span style={{ width: `${Math.max(3, r.severity * 4)}%` }} />
                </span>
                <span className="num">{Math.round(analysis.scores[r.key])}</span>
              </li>
            ))}
          </ul>
          <p className="tiny footnote">
            Scores are YouCam's, 1-100, higher is healthier.
          </p>
        </div>

        <div className="card">
          <h3>Your palette</h3>
          <div className="palette">
            {profile.recommendedColors.map((c) => (
              <figure key={c.name} className="chip">
                <span className="chip-swatch" style={{ background: c.hex }} />
                <figcaption>
                  <strong>{c.name}</strong>
                  <span className="tiny">{c.reason}</span>
                </figcaption>
              </figure>
            ))}
          </div>

          {profile.avoidColors.length > 0 && (
            <>
              <h3 className="subhead">Worth avoiding</h3>
              <div className="avoid">
                {profile.avoidColors.map((c) => (
                  <span key={c.name} className="avoid-chip" title={c.reason}>
                    <i style={{ background: c.hex }} />
                    {c.name}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="card reasoning">
          <h3>Why</h3>
          {profile.rationale.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>

        <button className="btn btn-accent" onClick={onTry}>
          See these on me
        </button>
      </section>
    </main>
  )
}

/* -- Try on ------------------------------------------------------------- */

function TryOn({
  profile,
  bodyFileId,
  bodyPhoto,
  onBody,
}: {
  profile: StyleProfile
  bodyFileId: string | null
  bodyPhoto: string | null
  onBody: (fileId: string, url: string) => void
}) {
  const ranked = rankGarments(
    GARMENTS,
    profile.recommendedColors,
    profile.avoidColors,
  )

  if (!bodyFileId) return <BodyPrompt onBody={onBody} />

  return (
    <main className="pad stack rise">
      <section>
        <h2 className="display section-title">Try on</h2>
        <p className="tiny">
          Ranked against your palette. Each says why it was picked.
        </p>
      </section>
      {ranked.map((g) => (
        <GarmentCard
          key={g.id}
          garment={g}
          bodyFileId={bodyFileId}
          bodyPhoto={bodyPhoto}
        />
      ))}
    </main>
  )
}

/**
 * Try-on needs a full-length standing shot, which is a different photo from the
 * close-up selfie skin analysis requires. Asking for both is honest about the
 * two APIs' constraints rather than failing on one photo.
 */
function BodyPrompt({
  onBody,
}: {
  onBody: (fileId: string, url: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shooting, setShooting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const upload = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('image', file)
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? 'Upload failed.')
      onBody(body.fileId, URL.createObjectURL(file))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (busy) return <Working caption="Uploading your photo" />

  if (shooting) {
    return (
      <Camera
        mode="body"
        onCancel={() => setShooting(false)}
        onCapture={(file) => {
          setShooting(false)
          upload(file)
        }}
      />
    )
  }

  return (
    <main className="pad stack">
      <section>
        <h2 className="display section-title">One more photo</h2>
        <p>
          Try-on needs a full-length shot, standing and facing the camera. Your
          selfie is framed too close for it.
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
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) upload(file)
          e.target.value = ''
        }}
      />
      <button className="btn" onClick={() => setShooting(true)}>
        Open camera
      </button>
      <button className="btn btn-quiet" onClick={() => inputRef.current?.click()}>
        Upload a photo instead
      </button>
      <ul className="guides">
        <li>Standing, whole body in frame</li>
        <li>Facing forward, arms clear of your sides</li>
        <li>Plain background works best</li>
      </ul>
    </main>
  )
}

function GarmentCard({
  garment,
  bodyFileId,
  bodyPhoto,
}: {
  garment: Garment & {
    verdict: 'recommended' | 'caution' | 'neutral'
    reason?: string
  }
  bodyFileId: string
  bodyPhoto: string | null
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
        bodyFileId,
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
      <header className="garment-head">
        <span className="garment-swatch" style={{ background: garment.hex }} />
        <div>
          <h3>{garment.name}</h3>
          {garment.verdict === 'recommended' && (
            <span className="tag tag-good">In your palette</span>
          )}
          {garment.verdict === 'caution' && (
            <span className="tag tag-warn">Fights your undertone</span>
          )}
        </div>
      </header>

      {garment.reason && <p className="tiny">{garment.reason}</p>}

      <div className="frame">
        {busy && <div className="skeleton frame-fill" />}
        {!busy && result && (
          <img
            className="frame-fill rise"
            src={result}
            alt={`You wearing the ${garment.name}`}
          />
        )}
        {!busy && !result && (
          <>
            <img className="frame-fill contain" src={garment.url} alt={garment.name} />
            {bodyPhoto && <img className="frame-you" src={bodyPhoto} alt="" />}
          </>
        )}
      </div>

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}

      <button
        className={result ? 'btn btn-quiet' : 'btn'}
        onClick={run}
        disabled={busy}
      >
        {busy ? 'Rendering…' : result ? 'Render again' : 'See it on me'}
      </button>
    </article>
  )
}
