import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Camera } from './Camera'
import { Landing } from './landing/Landing'
import { normalizeImage } from './lib/image'
import { fileToDataUrl, loadScans, removeScan, saveScan, type PastScan } from './lib/history'
import Store from './Store'
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
  tags?: string[]
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

type Screen = 'land' | 'scanning' | 'diagnosis' | 'shop' | 'cart' | 'store'

/** What the bag remembers about a line, so it survives a reload on its own. */
interface CartLine {
  id: string
  name: string
  brand: string
  hex: string
  shadeName?: string
  price?: number
}

const AISLES = [
  { key: 'foundation', label: 'Foundation' },
  { key: 'lipstick', label: 'Lipstick' },
  { key: 'blush', label: 'Blush' },
  { key: 'skincare', label: 'Skincare' },
  { key: 'hair', label: 'Hair' },
  { key: 'look', label: 'Full looks' },
  { key: 'clothes', label: 'Clothes' },
]

/** Studio aisles render on the canvas instead of listing products. */

/** Aisles YouCam can render, and the makeup subset that shares one payload. */
const MAKEUP_AISLES = ['foundation', 'lipstick', 'blush']
const RENDERABLE = [...MAKEUP_AISLES, 'clothes', 'hair', 'skincare', 'look']

/** Renderable but not purchasable: these are inspiration, not stock. */
const NOT_FOR_SALE = ['hair', 'look']

const CONCERN_LABEL: Record<string, string> = {
  oiliness: 'Oiliness', moisture: 'Moisture', redness: 'Redness', acne: 'Acne',
  texture: 'Texture', pore: 'Pores', dark_circle_v2: 'Dark circles',
  radiance: 'Radiance', age_spot: 'Age spots',
}

/* -- App ---------------------------------------------------------------- */

/** Screens are real URLs, so back, refresh and sharing all behave. */
const PATHS: Record<Screen, string> = {
  land: '/',
  scanning: '/scanning',
  diagnosis: '/diagnosis',
  shop: '/shop',
  cart: '/bag',
  store: '/store',
}
const SCREEN_BY_PATH = Object.fromEntries(
  Object.entries(PATHS).map(([k, v]) => [v, k as Screen]),
) as Record<string, Screen>

export default function App() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // The URL decides the screen. Deep links to a screen that needs a scan fall
  // back to the landing rather than rendering an empty shell.
  const routed = SCREEN_BY_PATH[pathname] ?? 'land'
  const [screen, setScreenState] = useState<Screen>(routed)

  const setScreen = useCallback(
    (next: Screen) => {
      setScreenState(next)
      if (PATHS[next] !== pathname) navigate(PATHS[next])
    },
    [navigate, pathname],
  )

  // Back and forward move the screen too, not just the address bar.
  useEffect(() => {
    setScreenState(SCREEN_BY_PATH[pathname] ?? 'land')
  }, [pathname])
  const [reading, setReading] = useState<Reading | null>(null)
  const [shop, setShop] = useState<Shop | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cart, setCart] = useState<Record<string, number>>({})
  const [cartLines, setCartLines] = useState<Record<string, CartLine>>({})
  const [scans, setScans] = useState<PastScan[]>([])
  const [shooting, setShooting] = useState(false)

  // One key per module. The prescription is deliberately NOT persisted: the
  // shelf may have changed underneath it, so it is recomputed on restore.
  useEffect(() => {
    const raw = localStorage.getItem('mirror.cart')
    if (raw) setCart(JSON.parse(raw))
    const savedLines = localStorage.getItem('mirror.cart.lines')
    if (savedLines) setCartLines(JSON.parse(savedLines))
    const saved = loadScans()
    setScans(saved)
    // A reload keeps the scan but not the prescription, so restore the most
    // recent reading straight away rather than asking for a tap. Re-opening
    // is free; the shop is recomputed because the shelf may have moved.
    if (saved[0]) {
      setReading(saved[0].reading as Reading)
      setPhoto(saved[0].photo)
    }
  }, [])
  useEffect(() => {
    localStorage.setItem('mirror.cart', JSON.stringify(cart))
  }, [cart])
  // The bag keeps its own copy of each line: the prescription is recomputed on
  // restore, so without this a refresh on /bag leaves ids with nothing to
  // match against and the bag looks empty.
  useEffect(() => {
    localStorage.setItem('mirror.cart.lines', JSON.stringify(cartLines))
  }, [cartLines])

  const scan = useCallback(async (picked: File) => {
    setScreen('scanning')
    setError(null)
    // YouCam takes jpg/png only, so WebP, HEIC and oversized phone photos are
    // converted here rather than rejected at the picker.
    let file: File
    try {
      file = await normalizeImage(picked)
    } catch (err) {
      setError((err as Error).message)
      setScreen('land')
      return
    }
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

  /** The camera lives on the landing screen, so go there and open it. */
  const newScan = useCallback(() => {
    setShooting(true)
    setScreen('land')
  }, [setScreen])

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
          // Blush leads the palette rather than the face: a blush the colour
          // of her skin would disappear.
          blushHex: reading.palette.swatches[0]?.hex,
          concerns: reading.concerns,
          faceShape: reading.face?.faceshape,
          gender: reading.face?.agegender?.gender,
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.shortlists) {
        throw new Error(body?.error ?? 'Could not load the shop. Try again.')
      }
      setShop(body)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [reading, shop])

  const count = Object.values(cart).reduce((a, b) => a + b, 0)

  return (
    <div className="app">
      {/* On the landing the bar is part of the page: no rule, no fill, the
          landing's own type. Inside the app it becomes a real sticky chrome. */}
      <header className={screen === 'land' ? 'bar bar-land' : 'bar'}>
        <button
          className="brand"
          onClick={() => setScreen('land')}
          aria-label="Mirror, back to start"
        >
          <span className="brand-mark" aria-hidden />
          <span className="brand-word">Mirror</span>
        </button>

        {reading ? (
          <nav className="bar-nav" aria-label="Main">
            <button
              className={screen === 'diagnosis' ? 'navlink on' : 'navlink'}
              aria-current={screen === 'diagnosis' ? 'page' : undefined}
              onClick={() => setScreen('diagnosis')}
            >
              Diagnosis
            </button>
            <button
              className={screen === 'shop' ? 'navlink on' : 'navlink'}
              aria-current={screen === 'shop' ? 'page' : undefined}
              onClick={openShop}
            >
              Studio
            </button>
          </nav>
        ) : (
          <span className="bar-tag">instrument for skin · built on YouCam</span>
        )}

        {/* The landing already leads with the camera, and interrupting a scan
            in progress would throw away the units it is spending. */}
        {screen !== 'land' && screen !== 'scanning' && (
          <button className="navlink" onClick={newScan}>
            New scan
          </button>
        )}

        <button
          className={screen === 'store' ? 'navlink on' : 'navlink'}
          aria-current={screen === 'store' ? 'page' : undefined}
          onClick={() => setScreen('store')}
        >
          Store
        </button>

        {/* Nothing can be in the bag before a scan, so it stays out of the
            landing entirely rather than sitting there empty. */}
        {screen !== 'land' && (
          <button
            className={count > 0 ? 'cart-btn has-items' : 'cart-btn'}
            onClick={() => setScreen('cart')}
            aria-label={`Bag, ${count} item${count === 1 ? '' : 's'}`}
          >
            <svg viewBox="0 0 24 24" aria-hidden focusable="false">
              <path
                d="M6 8h12l-1 11.5a1.5 1.5 0 0 1-1.5 1.4h-9A1.5 1.5 0 0 1 5 19.5z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path
                d="M9 9.5V7a3 3 0 0 1 6 0v2.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
            <span className="cart-label">Bag</span>
            {count > 0 && <span className="pip">{count}</span>}
          </button>
        )}
      </header>

      {error && (
        <p className="notice notice-error wrap" role="alert">
          {error}
        </p>
      )}

      {screen === 'land' &&
        (shooting ? (
          <Camera
            mode="face"
            onCancel={() => setShooting(false)}
            onCapture={(f) => {
              setShooting(false)
              scan(f)
            }}
          />
        ) : (
          <Landing
            onCamera={() => setShooting(true)}
            onFile={scan}
            onStore={() => setScreen('store')}
            scans={scans}
            onReopen={reopen}
            onForget={(id) => setScans(removeScan(id))}
          />
        ))}
      {screen === 'scanning' && <Scanning photo={photo} />}
      {/* Without this the screen renders nothing at all and the page goes
          white — reached only when there is no saved scan to restore. */}
      {(screen === 'diagnosis' || screen === 'shop') && !reading && (
        <NoReading onStart={newScan} />
      )}
      {screen === 'diagnosis' && reading && (
        <Diagnosis reading={reading} photo={photo} onShop={openShop} />
      )}
      {screen === 'shop' && reading && (
        <ShopView
          shop={shop}
          reading={reading}
          photo={photo}
          onAdd={(id) => {
            setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }))
            const p = Object.values(shop?.shortlists ?? {})
              .flat()
              .find((x) => x.id === id)
            if (p) {
              setCartLines((l) => ({
                ...l,
                [id]: {
                  id,
                  name: p.name,
                  brand: p.brand,
                  hex: p.hex,
                  shadeName: p.shadeName,
                  price: p.price,
                },
              }))
            }
          }}
        />
      )}
      {screen === 'store' && <Store />}
      {screen === 'cart' && (
        <Cart cart={cart} lines={cartLines} shop={shop} onChange={setCart} />
      )}
    </div>
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
                  <span className="meter" aria-hidden>
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
  clothes: 'Try them on, and colours that suit your undertone',
  hair: 'Cuts rendered on your own photo',
  look: 'A complete makeup look, rendered in one go',
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
  // Shelves run to hundreds of rows, so they arrive a page at a time.
  const PAGE = 24
  const [shown, setShown] = useState(PAGE)

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

  const available = AISLES.filter(
    (a) => (shop.shortlists[a.key]?.length ?? 0) > 0,
  )

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
        <p className="tiny">
          {AISLE_BLURB[aisle] ?? ''}
          {items.length > 0 && ` · ${items.length} ranked for you`}
        </p>
      </section>

      <nav className="aisles" aria-label="Categories">
        {AISLES.filter((a) => (shop.shortlists[a.key]?.length ?? 0) > 0).map((a) => (
          <button
            key={a.key}
            className={aisle === a.key ? 'aisle on' : 'aisle'}
            aria-current={aisle === a.key}
            onClick={() => {
              setAisle(a.key)
              setShown(PAGE)
            }}
          >
            {a.label}
          </button>
        ))}
      </nav>

      <>
      <p className="aisle-note">
        {MAKEUP_AISLES.includes(aisle) ? (
          <>
            Try-on renders your prescribed formula, not a preset: the
            intensities come from your scan.
          </>
        ) : aisle === 'clothes' ? (
          <>Try any of these on your own photo.</>
        ) : aisle === 'skincare' ? (
          <>
            Try-on simulates the result: your own scan sets how much each
            concern improves.
          </>
        ) : (
          <>Rendered on your own photo.</>
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
        {items.slice(0, shown).map((p) => (
          <ProductCard
            key={p.id}
            product={p}
            featured={pick?.productId === p.id}
            featuredNote={pick?.productId === p.id ? pick : undefined}
            onAdd={onAdd}
            reading={reading}
            makeupEffects={shop.makeup.effects}
            photo={photo}
          />
        ))}
      </div>

      {items.length > shown && (
        <button
          className="btn btn-quiet more-btn"
          onClick={() => setShown((n) => n + PAGE)}
        >
          Show {Math.min(PAGE, items.length - shown)} more
          <span className="tiny"> · {items.length - shown} left</span>
        </button>
      )}
      </>
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
  photo,
}: {
  product: RankedItem
  featured: boolean
  featuredNote?: { source: 'model' | 'match' }
  onAdd: (id: string) => void
  reading: Reading
  makeupEffects: unknown[]
  photo?: string | null
}) {
  // Everything YouCam can render gets a try-on button.
  const canTryOn = RENDERABLE.includes(product.aisle)
  // But not everything is for sale: nobody ships a haircut or a makeup look.
  const canBuy = !NOT_FOR_SALE.includes(product.aisle)

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
          {canBuy && (
            <button className="btn btn-sm" onClick={() => onAdd(product.id)}>
              Add{product.price ? ` · $${product.price}` : ''}
            </button>
          )}
          {canTryOn && (
            <TryOnButton
              fileId={reading.fileId}
              effects={makeupEffects}
              product={product}
              concerns={reading.concerns}
              photo={photo}
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
/**
 * Try-on, on the card itself.
 *
 * Every aisle that YouCam can render gets the same control, and the result
 * appears in the card so the shade and the render sit together.
 */
function TryOnButton({
  fileId,
  effects,
  product,
  concerns = [],
  photo,
}: {
  fileId: string
  effects: unknown[]
  product: RankedItem
  concerns?: Reading['concerns']
  /** The scan photo, so every render can be compared against the original. */
  photo?: string | null
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const run = async () => {
    setBusy(true)
    setErr(null)
    try {
      const isGarment = product.aisle === 'clothes'
      const isHair = product.aisle === 'hair'
      const isSkincare = product.aisle === 'skincare'
      const isMakeup = MAKEUP_AISLES.includes(product.aisle)

      let res: Response
      if (isHair) {
        // The id IS YouCam's template id, so nothing user-supplied is fetched.
        res = await fetch('/api/tryon/hair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileId, templateId: product.id }),
        })
      } else if (product.aisle === 'look') {
        res = await fetch('/api/tryon/look', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileId, templateId: product.id }),
        })
      } else if (isSkincare) {
        // Shows the outcome the product is sold on, scaled by how pronounced
        // each concern actually is on her.
        res = await fetch('/api/tryon/skincare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileId,
            treats: product.tags ?? [],
            concerns,
          }),
        })
      } else if (isGarment) {
        // The server resolves the image by id, so the browser never chooses
        // which host we fetch from.
        res = await fetch('/api/tryon/cloth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modelFileId: fileId, garmentId: product.id }),
        })
      } else if (isMakeup) {
        // Swap this shade into the prescribed effects, so the render is still
        // her formula rather than a preset.
        const category =
          product.aisle === 'lipstick'
            ? 'lip_color'
            : product.aisle === 'blush'
              ? 'blush'
              : 'foundation'
        const tuned = (effects as Array<Record<string, any>>).map((e) =>
          e.category === category
            ? { ...e, palettes: [{ ...e.palettes[0], color: product.hex }] }
            : e,
        )
        res = await fetch('/api/tryon/makeup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileId, effects: tuned }),
        })
      } else {
        throw new Error('This one cannot be rendered.')
      }

      // A severed or empty response must not surface as a JSON parse error.
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.url) {
        throw new Error(
          body?.error ??
            'That render took too long and was cut short. Try again.',
        )
      }
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
        <figure className="tryon-result rise">
          <div className="ba">
            <div className="ba-half">
              {photo && <img src={photo} alt="Before" />}
              <figcaption className="ba-tag">Before</figcaption>
            </div>
            <div className="ba-half">
              <img src={url} alt={`After: ${product.name}`} />
              <figcaption className="ba-tag ba-tag-after">After</figcaption>
            </div>
          </div>
        </figure>
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

/**
 * A reload restores the last scan automatically, so this is only reached by
 * someone deep-linking to /diagnosis or /shop who has never scanned.
 */
function NoReading({ onStart }: { onStart: () => void }) {
  return (
    <main className="wrap">
      <div className="card empty">
        <h3>No reading yet</h3>
        <p className="tiny">Scan your face and this fills in.</p>
        <div className="land-actions">
          <button className="btn" onClick={onStart}>
            Scan my face
          </button>
        </div>
      </div>
    </main>
  )
}

function Cart({
  cart,
  lines: saved,
  shop,
  onChange,
}: {
  cart: Record<string, number>
  lines: Record<string, CartLine>
  shop: Shop | null
  onChange: (c: Record<string, number>) => void
}) {
  const [placing, setPlacing] = useState(false)
  const [placed, setPlaced] = useState<Array<{ storeId: string; total: number }> | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // The live shelf is preferred when it is loaded, but the bag's own snapshot
  // is what makes a reload on /bag work at all.
  const all = shop ? Object.values(shop.shortlists).flat() : []
  const lines = Object.entries(cart)
    .map(([id, qty]) => ({ product: all.find((p) => p.id === id) ?? saved[id], qty, id }))
    .filter((l) => l.product)

  const total = lines.reduce((sum, l) => sum + (l.product!.price ?? 0) * l.qty, 0)

  const checkout = async () => {
    setPlacing(true)
    setErr(null)
    setNote(null)
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lines: lines.map((l) => ({ productId: l.id, qty: l.qty })),
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? 'Checkout failed.')
      const orders: Array<{ storeId: string; total: number }> = body.orders ?? []
      setPlaced(orders)
      if (orders.length === 0) {
        // Nothing here belongs to a merchant, so nothing was sent. That is a
        // normal outcome for feed-only picks, not a failure.
        setNote('None of these are sold by a listed store yet, so no order was sent.')
      } else {
        onChange({})
      }
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setPlacing(false)
    }
  }

  if (placed && placed.length > 0) {
    return (
      <main className="wrap">
        <div className="card empty">
          <h3>
            {placed.length === 1
              ? 'Order sent'
              : `${placed.length} orders sent`}
          </h3>
          <p className="tiny">
            {placed.length === 1 ? 'One store' : `${placed.length} stores`} received your
            order. They can see it in their Store dashboard.
          </p>
        </div>
      </main>
    )
  }

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
      <button className="btn" onClick={checkout} disabled={placing}>
        {placing ? 'Sending…' : 'Place order'}
      </button>
      {note && (
        <p className="notice wrap" role="status">
          {note}
        </p>
      )}
      {err && (
        <p className="notice notice-error wrap" role="alert">
          {err}
        </p>
      )}
      <p className="tiny">
        Checkout sends ids and quantities only; every line is re-priced on the
        server.
      </p>
    </main>
  )
}
