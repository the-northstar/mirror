import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera } from './Camera'
import { Studio } from './Studio'
import { fileToDataUrl, loadScans, relativeTime, removeScan, saveScan, type PastScan } from './lib/history'
import './App.css'

/* -- Types mirroring the API ------------------------------------------- */

interface Reading {
  fileId: string
  color: Record<string, string>
  faceQuality: Record<string, unknown> | null
  concerns: Array<{ type: string; ui_score: number; raw_score: number; mask_urls?: string[] }>
  face: Record<string, any> | null
  palette: { season: string; undertone: string; depth: number; swatches: Array<{ name: string; hex: string }>; reason: string }
  formula: { finish: string; glowIntensity: number; coverageIntensity: number; because: string[] }
  partial: { concerns: boolean; face: boolean }
}

interface RankedItem {
  id: string
  aisle: string
  brand: string
  name: string
  hex: string
  colorName: string
  shadeName?: string
  price?: number
  image?: string
  url?: string
  reason: string
}

interface Shop {
  palette: Reading['palette']
  formula: Reading['formula']
  shortlists: Record<string, RankedItem[]>
  picks: Record<string, { productId: string; reason: string; source: 'model' | 'match' }>
  together: string
  concealer: { hex: string; from: string; shade?: string } | null
  makeup: { effects: unknown[]; explain: string }
}

type Screen = 'land' | 'scanning' | 'diagnosis' | 'shop' | 'cart'

const AISLES = [
  { key: 'foundation', label: 'Foundation' },
  { key: 'lipstick', label: 'Lipstick' },
  { key: 'blush', label: 'Blush' },
  { key: 'skincare', label: 'Skincare' },
  { key: 'clothes', label: 'Clothes' },
  { key: 'glasses', label: 'Glasses' },
  { key: 'jewellery', label: 'Jewellery' },
]

/** Studio aisles render on the canvas instead of listing products. */
const STUDIOS = [
  { key: 'cloth', label: 'Clothes try-on' },
  { key: 'hair', label: 'Hair try-on' },
] as const

const CONCERN_LABEL: Record<string, string> = {
  oiliness: 'Oiliness', moisture: 'Moisture', redness: 'Redness', acne: 'Acne',
  texture: 'Texture', pore: 'Pores', dark_circle_v2: 'Dark circles',
  radiance: 'Radiance', age_spot: 'Age spots',
}

/* -- App ---------------------------------------------------------------- */

export default function App() {
  const [screen, setScreen] = useState<Screen>('land')
  const [reading, setReading] = useState<Reading | null>(null)
  const [shop, setShop] = useState<Shop | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cart, setCart] = useState<Record<string, number>>({})
  const [scans, setScans] = useState<PastScan[]>([])

  // One key per module. The prescription is deliberately NOT persisted: the
  // shelf may have changed underneath it, so it is recomputed on restore.
  useEffect(() => {
    const raw = localStorage.getItem('mirror.cart')
    if (raw) setCart(JSON.parse(raw))
    setScans(loadScans())
  }, [])
  useEffect(() => {
    localStorage.setItem('mirror.cart', JSON.stringify(cart))
  }, [cart])

  const scan = useCallback(async (file: File) => {
    setScreen('scanning')
    setError(null)
    setPhoto(URL.createObjectURL(file))
    try {
      const form = new FormData()
      form.append('image', file)
      const res = await fetch('/api/read', { method: 'POST', body: form })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.color) throw new Error(body?.error ?? 'The scan failed.')
      setReading(body)
      // A scan costs units, so keep it: re-opening one later is free.
      try {
        const dataUrl = await fileToDataUrl(file)
        setPhoto(dataUrl)
        setScans(
          saveScan({
            photo: dataUrl,
            fileId: body.fileId,
            skinHex: body.color.skin_color,
            season: body.palette.season,
            reading: body,
          }),
        )
      } catch {
        // History is a convenience; a failure here must not lose the scan.
      }
      setScreen('diagnosis')
    } catch (err) {
      setError((err as Error).message)
      setScreen('land')
    }
  }, [])

  const reopen = useCallback((scan: PastScan) => {
    setReading(scan.reading as Reading)
    setPhoto(scan.photo)
    // The shop is recomputed rather than restored: the shelf may have moved.
    setShop(null)
    setScreen('diagnosis')
  }, [])

  const openShop = useCallback(async () => {
    if (!reading) return
    setScreen('shop')
    if (shop) return
    try {
      const res = await fetch('/api/shop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skinHex: reading.color.skin_color,
          lipHex: reading.color.lip_color,
          concerns: reading.concerns,
          faceShape: reading.face?.faceshape,
          gender: reading.face?.agegender?.gender,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Could not load the shop.')
      setShop(body)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [reading, shop])

  const count = Object.values(cart).reduce((a, b) => a + b, 0)

  return (
    <div className="app">
      <header className="bar">
        <button className="brand" onClick={() => setScreen(reading ? 'diagnosis' : 'land')}>
          <span className="brand-mark" aria-hidden />
          Mirror
        </button>

        {reading && (
          <nav className="bar-nav" aria-label="Main">
            <button
              className={screen === 'diagnosis' ? 'navlink on' : 'navlink'}
              aria-current={screen === 'diagnosis'}
              onClick={() => setScreen('diagnosis')}
            >
              Diagnosis
            </button>
            <button
              className={screen === 'shop' ? 'navlink on' : 'navlink'}
              aria-current={screen === 'shop'}
              onClick={openShop}
            >
              Studio
            </button>
          </nav>
        )}

        <button
          className="cart-btn"
          onClick={() => setScreen('cart')}
          aria-label={`Bag, ${count} item${count === 1 ? '' : 's'}`}
        >
          Bag{count > 0 && <span className="pip">{count}</span>}
        </button>
      </header>

      {error && (
        <p className="notice notice-error wrap" role="alert">
          {error}
        </p>
      )}

      {screen === 'land' && (
        <Land
          onFile={scan}
          scans={scans}
          onReopen={reopen}
          onForget={(id) => setScans(removeScan(id))}
        />
      )}
      {screen === 'scanning' && <Scanning photo={photo} />}
      {screen === 'diagnosis' && reading && (
        <Diagnosis reading={reading} photo={photo} onShop={openShop} />
      )}
      {screen === 'shop' && reading && (
        <ShopView
          shop={shop}
          reading={reading}
          photo={photo}
          onAdd={(id) => setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }))}
        />
      )}
      {screen === 'cart' && (
        <Cart cart={cart} shop={shop} onChange={setCart} />
      )}
    </div>
  )
}

/* -- Land --------------------------------------------------------------- */

function Land({
  onFile,
  scans,
  onReopen,
  onForget,
}: {
  onFile: (f: File) => void
  scans: PastScan[]
  onReopen: (s: PastScan) => void
  onForget: (id: string) => void
}) {
  const [shooting, setShooting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  if (shooting) {
    return (
      <Camera
        mode="face"
        onCancel={() => setShooting(false)}
        onCapture={(f) => {
          setShooting(false)
          onFile(f)
        }}
      />
    )
  }

  return (
    <main className="wrap land">
      <div className="land-copy">
        <h1 className="display land-title">
          Your skin sets
          <br />
          the formula.
        </h1>
        <p className="lead">
          One selfie. We measure your skin colour and its condition, then every
          product names the reading that chose it.
        </p>
        <p className="lead lead-2">
          Colour picks the shade. Condition picks the formula. That is why the
          same matched shade is prescribed matte on oily skin and dewy on dry.
        </p>
        <div className="land-actions">
          <button className="btn" onClick={() => setShooting(true)}>
            Open camera
          </button>
          <button className="btn btn-quiet" onClick={() => inputRef.current?.click()}>
            Upload a photo
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onFile(f)
            e.target.value = ''
          }}
        />
        <ul className="guides">
          <li>One person only, no one else in frame</li>
          <li>Close up, your face filling most of the photo</li>
          <li>Even light, facing the camera</li>
        </ul>

        {scans.length > 0 && (
          <section className="history">
            <h2 className="kicker">Your earlier scans</h2>
            <p className="tiny">Re-open one to skip the scan. It costs nothing.</p>
            <ul className="history-row">
              {scans.map((s) => (
                <li key={s.id}>
                  <button className="history-item" onClick={() => onReopen(s)}>
                    <img src={s.photo} alt="" />
                    <span className="history-meta">
                      <span className="history-season">{s.season}</span>
                      <span className="tiny">{relativeTime(s.at)}</span>
                    </span>
                  </button>
                  <button
                    className="history-x"
                    onClick={() => onForget(s.id)}
                    aria-label="Forget this scan"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <aside className="land-aside" aria-hidden>
        <div className="chip-row">
          {['#3a2a20', '#6b4a35', '#b18d70', '#d9c9b0', '#efe6d2'].map((h) => (
            <span key={h} className="tone" style={{ background: h }} />
          ))}
        </div>
        <p className="tiny">Measured, not guessed.</p>
      </aside>
    </main>
  )
}

const SCAN_STEPS = [
  'Uploading your photo',
  'Measuring skin colour',
  'Reading skin condition',
  'Reading face shape',
  'Building your prescription',
]

function Scanning({ photo }: { photo: string | null }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    // Roughly matches how long the three parallel tasks actually take; the
    // point is to name the work, not to fake a percentage.
    const t = setInterval(() => setI((v) => Math.min(v + 1, SCAN_STEPS.length - 1)), 3200)
    return () => clearInterval(t)
  }, [])

  return (
    <main className="wrap scanning" aria-live="polite" aria-busy="true">
      <div className="scanning-media">
        {photo && <img src={photo} alt="" className="scan-photo scanning-photo" />}
        <span className="scan-sweep" aria-hidden />
      </div>
      <div className="scanning-body">
        <p className="kicker">Scanning</p>
        <h2 className="display h-lg">{SCAN_STEPS[i]}</h2>
        <ol className="steps">
          {SCAN_STEPS.map((s, idx) => (
            <li key={s} className={idx < i ? 'done' : idx === i ? 'now' : ''}>
              <span className="step-dot" aria-hidden />
              {s}
            </li>
          ))}
        </ol>
        <p className="tiny">This takes about twenty seconds. Three YouCam reads run at once.</p>
      </div>
    </main>
  )
}

/* -- Diagnosis ---------------------------------------------------------- */

function Diagnosis({
  reading,
  photo,
  onShop,
}: {
  reading: Reading
  photo: string | null
  onShop: () => void
}) {
  const ranked = [...reading.concerns]
    .map((c) => ({ ...c, severity: 100 - c.raw_score }))
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 5)
  // On healthy skin every severity is tiny, so a fixed scale renders five
  // empty bars. Scaling to the widest reading keeps the RANKING legible,
  // which is what this panel is for; the printed score stays absolute.
  const widest = Math.max(...ranked.map((c) => c.severity), 1)
  const masks = reading.concerns.filter((c) => c.mask_urls?.length).slice(0, 4)

  return (
    <main className="wrap diagnosis">
      {/* The formula IS the idea, so it leads rather than sitting below the
          fold under a wall of measurements. */}
      <section className="verdict">
        <div className="verdict-media">
          {photo && <img src={photo} alt="Your scan" className="scan-photo" />}
        </div>

        <div className="verdict-body">
          <p className="kicker">Your prescription</p>
          <h2 className="display verdict-title">
            {reading.formula.finish} base,
            <br />
            {reading.palette.season.toLowerCase()} palette
          </h2>

          {reading.partial.concerns ? (
            reading.formula.because.length > 0 ? (
              <ul className="because">
                {reading.formula.because.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            ) : (
              <p className="lead">
                Nothing measured strongly enough to push the formula either way,
                so this is a balanced base matched to your skin colour.
              </p>
            )
          ) : (
            <div className="notice notice-error">
              <strong>We only got half the reading.</strong>
              <p className="tiny">
                Your colour came back, but the condition scan needs one face,
                close up and filling the frame. Rescan for the full formula.
              </p>
            </div>
          )}

          <div className="verdict-stats">
            <div>
              <span className="kicker">Skin</span>
              <span className="stat">
                <i className="dot" style={{ background: reading.color.skin_color }} />
                {reading.color.skin_color}
              </span>
            </div>
            <div>
              <span className="kicker">Undertone</span>
              <span className="stat cap">{reading.palette.undertone}</span>
            </div>
            <div>
              <span className="kicker">Depth</span>
              <span className="stat">{reading.palette.depth} of 6</span>
            </div>
            {reading.face?.faceshape && (
              <div>
                <span className="kicker">Face</span>
                <span className="stat cap">{String(reading.face.faceshape)}</span>
              </div>
            )}
          </div>

          <div className="swatch-row">
            {reading.palette.swatches.map((s) => (
              <span key={s.name} className="swatch" title={s.name}>
                <i style={{ background: s.hex }} />
                {s.name}
              </span>
            ))}
          </div>

          <button className="btn" onClick={onShop}>
            See what suits you
          </button>
        </div>
      </section>

      <div className="detail-grid">
        {ranked.length > 0 && (
          <section className="card">
            <h3>Most pronounced</h3>
            <p className="tiny">
              YouCam scores 1-100, where higher is healthier. Ranked by how much
              each shows on you.
            </p>
            <ul className="bars">
              {ranked.map((c) => (
                <li key={c.type}>
                  <span>{CONCERN_LABEL[c.type] ?? c.type}</span>
                  <span className="bar" aria-hidden>
                    <span style={{ width: `${Math.max(4, (c.severity / widest) * 100)}%` }} />
                  </span>
                  <span className="num">{Math.round(c.raw_score)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {masks.length > 0 && (
          <section className="card">
            <h3>Where we saw it</h3>
            <p className="tiny">
              YouCam's own detection masks, so you can see the measurement rather
              than take our word for it.
            </p>
            <div className="mask-row">
              {masks.map((m) => (
                <figure key={m.type}>
                  <img src={m.mask_urls![0]} alt={`${CONCERN_LABEL[m.type] ?? m.type} mask`} />
                  <figcaption className="tiny">{CONCERN_LABEL[m.type] ?? m.type}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

/* -- Shop --------------------------------------------------------------- */

/** What each aisle is for, so the chooser reads as a decision not a menu. */
const AISLE_BLURB: Record<string, string> = {
  foundation: 'Matched to your measured skin colour',
  lipstick: 'Ranked against your palette',
  blush: 'Ranked against your palette',
  skincare: 'Aimed at what your scan flagged',
  clothes: 'Colours that suit your undertone',
  glasses: 'Frames for your measured face shape',
  jewellery: 'Metals for your undertone',
  cloth: 'See garments on your own photo',
  hair: 'See cuts on your own photo',
}

function ShopView({
  shop,
  reading,
  photo,
  onAdd,
}: {
  shop: Shop | null
  reading: Reading
  photo: string | null
  onAdd: (id: string) => void
}) {
  // Null means "not chosen yet", which is what shows the chooser.
  const [aisle, setAisle] = useState<string | null>(null)

  if (!shop) {
    return (
      <main className="wrap stack-lg">
        <div className="skeleton" style={{ height: 60 }} />
        <div className="grid-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton" style={{ height: 190 }} />
          ))}
        </div>
      </main>
    )
  }

  const available = [
    ...AISLES.filter((a) => (shop.shortlists[a.key]?.length ?? 0) > 0),
    ...STUDIOS.map((s) => ({ key: s.key as string, label: s.label })),
  ]

  // Choose what you are shopping for first; a wall of foundation is not a
  // starting point when six other aisles are ranked and waiting.
  if (!aisle) {
    return (
      <main className="wrap stack-lg">
        <section>
          <h2 className="display h-lg">What are you shopping for?</h2>
          <p className="lead">
            Everything below is already ranked against your scan. Pick where to
            start.
          </p>
          {shop.together && <p className="lead lead-2">{shop.together}</p>}
        </section>
        <div className="chooser">
          {available.map((a) => {
            const top = shop.shortlists[a.key]?.[0]
            return (
              <button key={a.key} className="choice" onClick={() => setAisle(a.key)}>
                <span className="choice-art">
                  {top?.image ? (
                    <img src={top.image} alt="" loading="lazy" />
                  ) : (
                    <span
                      className="choice-fill"
                      style={{ background: top?.hex ?? 'var(--paper-2)' }}
                    />
                  )}
                </span>
                <span className="choice-body">
                  <strong>{a.label}</strong>
                  <span className="tiny">{AISLE_BLURB[a.key] ?? ''}</span>
                  {shop.shortlists[a.key] && (
                    <span className="tiny choice-count">
                      {shop.shortlists[a.key].length} ranked
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </main>
    )
  }

  const items = shop.shortlists[aisle] ?? []
  const pick = shop.picks[aisle]

  return (
    <main className="wrap stack-lg">
      <section className="shop-head">
        <button className="backlink" onClick={() => setAisle(null)}>
          ← All categories
        </button>
        <h2 className="display h-lg">
          {available.find((a) => a.key === aisle)?.label ?? 'Chosen for you'}
        </h2>
        <p className="tiny">{AISLE_BLURB[aisle] ?? ''}</p>
      </section>

      <nav className="aisles" aria-label="Categories">
        {AISLES.filter((a) => (shop.shortlists[a.key]?.length ?? 0) > 0).map((a) => (
          <button
            key={a.key}
            className={aisle === a.key ? 'aisle on' : 'aisle'}
            aria-current={aisle === a.key}
            onClick={() => setAisle(a.key)}
          >
            {a.label}
          </button>
        ))}
        {STUDIOS.map((s) => (
          <button
            key={s.key}
            className={aisle === s.key ? 'aisle on studio-tab' : 'aisle studio-tab'}
            aria-current={aisle === s.key}
            onClick={() => setAisle(s.key)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {(aisle === 'cloth' || aisle === 'hair') && (
        <Studio
          kind={aisle as 'cloth' | 'hair'}
          fileId={reading.fileId}
          photo={photo}
          formulaNote={
            aisle === 'cloth'
              ? `Styles are ranked against your ${shop.palette.season} palette.`
              : undefined
          }
        />
      )}

      {aisle !== 'cloth' && aisle !== 'hair' && (
        <>
      <p className="aisle-note">
        {aisle === 'foundation' || aisle === 'lipstick' ? (
          <>
            Try-on renders your prescribed formula, not a preset: the
            intensities come from your scan.
          </>
        ) : (
          <>
            No try-on here. YouCam renders makeup, clothes and hair, so we only
            offer it where it would actually be your face, not a guess.
          </>
        )}
      </p>

      {aisle === 'foundation' && shop.concealer && (
        <p className="notice">
          Matching concealer is {shop.concealer.hex}, derived from your
          foundation match rather than stocked.{' '}
          <i className="dot" style={{ background: shop.concealer.hex }} />
        </p>
      )}

      <div className="grid-3">
        {items.map((p) => (
          <ProductCard
            key={p.id}
            product={p}
            featured={pick?.productId === p.id}
            featuredNote={pick?.productId === p.id ? pick : undefined}
            onAdd={onAdd}
            reading={reading}
            makeupEffects={shop.makeup.effects}
          />
        ))}
      </div>
        </>
      )}
    </main>
  )
}

function ProductCard({
  product,
  featured,
  featuredNote,
  onAdd,
  reading,
  makeupEffects,
}: {
  product: RankedItem
  featured: boolean
  featuredNote?: { source: 'model' | 'match' }
  onAdd: (id: string) => void
  reading: Reading
  makeupEffects: unknown[]
}) {
  const canTryOn = product.aisle === 'foundation' || product.aisle === 'lipstick'

  return (
    <article className={featured ? 'product featured' : 'product'}>
      {featured && (
        <span className="ribbon">
          Top pick{featuredNote?.source === 'match' ? ' (closest match)' : ''}
        </span>
      )}
      <div className="product-media">
        {product.image ? (
          <img src={product.image} alt="" loading="lazy" />
        ) : (
          <span className="product-fill" style={{ background: product.hex }} />
        )}
        <span className="product-chip" style={{ background: product.hex }} />
      </div>
      <div className="product-body">
        <p className="brand-line">{product.brand}</p>
        <h4>{decode(product.name)}</h4>
        {product.shadeName && <p className="tiny">{product.shadeName}</p>}
        <p className="why">{product.reason}</p>
        <div className="product-actions">
          <button className="btn btn-sm" onClick={() => onAdd(product.id)}>
            Add{product.price ? ` · $${product.price}` : ''}
          </button>
          {canTryOn && (
            <TryOnButton
              fileId={reading.fileId}
              effects={makeupEffects}
              product={product}
            />
          )}
        </div>
      </div>
    </article>
  )
}

/**
 * Try-on is only offered where it can actually render. An unconditional button
 * would post jewellery to the clothes route and render a necklace as a shirt.
 */
function TryOnButton({
  fileId,
  effects,
  product,
}: {
  fileId: string
  effects: unknown[]
  product: RankedItem
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const run = async () => {
    setBusy(true)
    setErr(null)
    try {
      // Swap the shade being previewed into the prescribed effect list, so the
      // render still carries her measured intensities.
      const tuned = (effects as Array<Record<string, any>>).map((e) =>
        e.category === (product.aisle === 'lipstick' ? 'lip_color' : 'foundation')
          ? { ...e, palettes: [{ ...e.palettes[0], color: product.hex }] }
          : e,
      )
      const res = await fetch('/api/tryon/makeup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId, effects: tuned }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Try-on failed.')
      setUrl(body.url)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button className="btn btn-sm btn-quiet" onClick={run} disabled={busy}>
        {busy ? 'Rendering…' : url ? 'Again' : 'Try it on'}
      </button>
      {url && (
        <div className="tryon-result rise">
          <img src={url} alt={`You wearing ${product.name}`} />
        </div>
      )}
      {err && <p className="tiny error-text">{err}</p>}
    </>
  )
}

/** Feed names arrive with raw entities like &trade; in them. */
function decode(s: string): string {
  return s
    .replace(/&trade;?/gi, '\u2122')
    .replace(/&amp;/gi, '&')
    .replace(/&reg;?/gi, '\u00ae')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .trim()
}

/* -- Cart --------------------------------------------------------------- */

function Cart({
  cart,
  shop,
  onChange,
}: {
  cart: Record<string, number>
  shop: Shop | null
  onChange: (c: Record<string, number>) => void
}) {
  const all = shop ? Object.values(shop.shortlists).flat() : []
  const lines = Object.entries(cart)
    .map(([id, qty]) => ({ product: all.find((p) => p.id === id), qty, id }))
    .filter((l) => l.product)

  const total = lines.reduce((sum, l) => sum + (l.product!.price ?? 0) * l.qty, 0)

  if (lines.length === 0) {
    return (
      <main className="wrap">
        <div className="card empty">
          <h3>Your bag is empty</h3>
          <p className="tiny">Anything you add from the shop shows up here.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="wrap stack-lg">
      <h2 className="display h-lg">Your bag</h2>
      <ul className="lines">
        {lines.map((l) => (
          <li key={l.id}>
            <span className="dot" style={{ background: l.product!.hex }} />
            <div>
              <strong>{l.product!.name}</strong>
              <p className="tiny">
                {l.product!.brand}
                {l.product!.shadeName ? ` · ${l.product!.shadeName}` : ''}
              </p>
            </div>
            <span className="num">
              {l.qty} × {l.product!.price ? `$${l.product!.price}` : '—'}
            </span>
            <button
              className="textlink"
              onClick={() => {
                const next = { ...cart }
                delete next[l.id]
                onChange(next)
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="card total-card">
        <span>Total</span>
        <strong className="num">${total.toFixed(2)}</strong>
      </div>
      <p className="tiny">
        Checkout sends ids and quantities only; every line is re-priced on the
        server.
      </p>
    </main>
  )
}
