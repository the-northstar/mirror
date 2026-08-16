import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera } from './Camera'
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

  // One key per module. The prescription is deliberately NOT persisted: the
  // shelf may have changed underneath it, so it is recomputed on restore.
  useEffect(() => {
    const raw = localStorage.getItem('mirror.cart')
    if (raw) setCart(JSON.parse(raw))
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
      setScreen('diagnosis')
    } catch (err) {
      setError((err as Error).message)
      setScreen('land')
    }
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
          Mirror
        </button>
        <nav className="bar-nav">
          {reading && (
            <>
              <button className="textlink" onClick={() => setScreen('diagnosis')}>
                Diagnosis
              </button>
              <button className="textlink" onClick={openShop}>
                Shop
              </button>
            </>
          )}
          <button className="cart-btn" onClick={() => setScreen('cart')}>
            Bag{count > 0 && <span className="pip">{count}</span>}
          </button>
        </nav>
      </header>

      {error && (
        <p className="notice notice-error wrap" role="alert">
          {error}
        </p>
      )}

      {screen === 'land' && <Land onFile={scan} />}
      {screen === 'scanning' && <Scanning />}
      {screen === 'diagnosis' && reading && (
        <Diagnosis reading={reading} photo={photo} onShop={openShop} />
      )}
      {screen === 'shop' && reading && (
        <ShopView
          shop={shop}
          reading={reading}
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

function Land({ onFile }: { onFile: (f: File) => void }) {
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

function Scanning() {
  const steps = ['Uploading', 'Reading colour', 'Reading condition', 'Building your prescription']
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI((v) => Math.min(v + 1, steps.length - 1)), 3500)
    return () => clearInterval(t)
  }, [])
  return (
    <main className="wrap" aria-live="polite">
      <div className="skeleton" style={{ height: 280, borderRadius: 18 }} />
      <p className="working">{steps[i]}…</p>
      <div className="grid-2">
        <div className="skeleton" style={{ height: 90 }} />
        <div className="skeleton" style={{ height: 90 }} />
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

function ShopView({
  shop,
  reading,
  onAdd,
}: {
  shop: Shop | null
  reading: Reading
  onAdd: (id: string) => void
}) {
  const [aisle, setAisle] = useState('foundation')

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

  const items = shop.shortlists[aisle] ?? []
  const pick = shop.picks[aisle]

  return (
    <main className="wrap stack-lg">
      <section>
        <h2 className="display h-lg">Chosen for you</h2>
        {shop.together && <p className="lead">{shop.together}</p>}
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
      </nav>

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
