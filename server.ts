/**
 * API proxy. The YouCam key lives here and never reaches the browser.
 *
 * Also serves the built frontend and the renders directory, so one process runs
 * the whole app on any host.
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  analyzeConcerns,
  analyzeFace,
  analyzeTone,
  faultOf,
  clothTemplates,
  hairTemplates,
  tryOnClothTemplate,
  tryOnCloth,
  tryOnHair,
  tryOnMakeup,
  uploadFile,
  YouCamError,
  type ConcernOut,
  type GarmentCategory,
} from './src/lib/youcam'
import { formulaFor, paletteFor } from './src/lib/prescription'
import { GARMENTS } from './src/lib/garments'
import {
  addProducts,
  createStore,
  listStores,
  loadMakeup,
  loadShopify,
  ordersFor,
  placeOrder,
  productsForAisle,
  SNAPSHOT,
  type Aisle,
  type Product,
} from './src/lib/catalogue'
import {
  rankByPalette,
  rankFoundation,
  rankSkincare,
  type Ranked,
} from './src/lib/rank'
import { judge } from './src/lib/judge'
import { effectsFor, explainEffects, concealerFrom } from './src/lib/makeup'
import productsRoute, { ownedProducts } from './api/products'

const PORT = Number(process.env.PORT) || 8787
const MAX_BYTES = 10 * 1024 * 1024
// YouCam itself takes jpg/png only. The client converts anything else before
// upload; this stays strict so a direct API call cannot smuggle a format the
// upstream will reject with a worse error.
const ALLOWED = ['image/jpeg', 'image/png']

/**
 * Per-shelf cache. Nobody waits 30s for a page, so a stale shelf answers
 * immediately and refreshes behind the response.
 */
const shelves = new Map<string, { rows: Product[]; at: number; fellBack: boolean }>()
const SHELF_TTL = 60 * 60 * 1000

async function shelf(name: string, load: () => Promise<Product[]>): Promise<Product[]> {
  const hit = shelves.get(name)
  const fresh = hit && Date.now() - hit.at < SHELF_TTL
  if (hit && fresh) return hit.rows
  if (hit) void refresh(name, load) // stale-while-revalidate

  try {
    const rows = await load()
    if (rows.length) {
      shelves.set(name, { rows, at: Date.now(), fellBack: false })
      return rows
    }
    throw new Error('empty feed')
  } catch (err) {
    // Fallback is per shelf, not per catalogue: losing blush must not cost
    // the foundation match.
    console.warn(`[shelf:${name}] ${(err as Error).message}; using snapshot`)
    const snap = SNAPSHOT[name] ?? hit?.rows ?? []
    shelves.set(name, { rows: snap, at: Date.now(), fellBack: true })
    return snap
  }
}

async function refresh(name: string, load: () => Promise<Product[]>) {
  try {
    const rows = await load()
    if (rows.length) shelves.set(name, { rows, at: Date.now(), fellBack: false })
  } catch {
    // Keep serving what we have.
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/** Turn any thrown error into a fault-classified response. */
function fail(err: unknown, where: string): Response {
  const e =
    err instanceof YouCamError
      ? err
      : new YouCamError(String((err as Error)?.message ?? err), 'Unknown')
  const { owner, message } = faultOf(e.code)
  console.error(`[${where}] ${e.code}: ${e.message}`)
  return json({ error: message, code: e.code, owner }, owner === 'shopper' ? 400 : 502)
}

async function readImage(req: Request): Promise<File> {
  const form = await req.formData()
  const image = form.get('image')
  if (!(image instanceof File)) throw new YouCamError('No image supplied.', 'error_no_image', 400)
  if (!ALLOWED.includes(image.type)) {
    throw new YouCamError(
      'That format cannot be analysed. Upload a JPEG or PNG.',
      'error_bad_format',
      400,
    )
  }
  if (image.size > MAX_BYTES) {
    throw new YouCamError('Photo is over 10MB.', 'exceed_max_filesize', 400)
  }
  return image
}

const routes: Record<string, (req: Request) => Promise<Response>> = {
  /**
   * The reading: one upload, three tasks.
   *
   * The concern half may fail alone. A colour reading still recommends a shade,
   * so each half is settled independently rather than failing wholesale.
   */
  'POST /api/read': async (req) => {
    const image = await readImage(req)
    const fileId = await uploadFile(
      await image.arrayBuffer(),
      image.name || 'face.jpg',
      image.type,
    )

    const [tone, concerns, face] = await Promise.allSettled([
      analyzeTone(fileId, req.signal),
      analyzeConcerns(fileId, req.signal),
      analyzeFace(fileId, req.signal),
    ])

    // Colour is the one hard requirement: without it there is no shade and no
    // palette, so that failure is the shopper's to fix.
    if (tone.status === 'rejected') throw tone.reason

    const rows: ConcernOut[] = concerns.status === 'fulfilled' ? concerns.value : []
    const skinHex = tone.value.color.skin_color

    return json({
      fileId,
      color: tone.value.color,
      faceQuality: tone.value.face_quality ?? null,
      concerns: rows,
      face: face.status === 'fulfilled' ? face.value : null,
      palette: paletteFor(skinHex),
      formula: formulaFor(rows),
      // Say plainly which halves answered, rather than passing a partial
      // reading off as complete.
      partial: {
        concerns: concerns.status === 'fulfilled',
        face: face.status === 'fulfilled',
      },
    })
  },

  'POST /api/upload': async (req) => {
    const image = await readImage(req)
    const fileId = await uploadFile(
      await image.arrayBuffer(),
      image.name || 'body.jpg',
      image.type,
    )
    return json({ fileId })
  },

  /**
   * Clothes try-on.
   *
   * The garment URL is resolved from the catalogue by id, never taken from the
   * request body, or the browser could point this server at an arbitrary host.
   */
  'POST /api/tryon/cloth': async (req) => {
    const { modelFileId, garmentId } = (await req.json()) as {
      modelFileId?: string
      garmentId?: string
    }
    if (!modelFileId) return json({ error: 'Missing model photo.' }, 400)

    // Resolve by id against what is actually on the shelf, never from the
    // request body, or the browser could point this server at any host.
    const shelfRows = shelves.get('clothes')?.rows ?? []
    const fromShelf = shelfRows.find((p) => p.id === garmentId)
    const fromStore = productsForAisle('clothes').find((p) => p.id === garmentId)
    const product = fromStore ?? fromShelf
    const legacy = GARMENTS.find((g) => g.id === garmentId)

    const imageUrl = product?.image ?? (legacy ? absolute(legacy.url, req) : null)
    if (!imageUrl) return json({ error: 'Unknown garment.' }, 400)

    const url = await tryOnCloth(
      { fileId: modelFileId },
      { url: imageUrl },
      (legacy?.category as GarmentCategory) ?? 'upper_body',
      req.signal,
    )
    return json({ url })
  },

  /** Makeup try-on, rendering the intensities formulaFor() computed. */
  'POST /api/tryon/makeup': async (req) => {
    const { fileId, effects } = (await req.json()) as {
      fileId?: string
      effects?: unknown
    }
    if (!fileId) return json({ error: 'Missing photo.' }, 400)
    if (!Array.isArray(effects) || effects.length === 0) {
      return json({ error: 'No makeup effects supplied.' }, 400)
    }
    const url = await tryOnMakeup(fileId, effects as never, req.signal)
    return json({ url })
  },

  'GET /api/hair/templates': async () => json(await hairTemplates(20)),

  'GET /api/cloth/templates': async () => json(await clothTemplates(20)),

  /** Template try-on: the id is YouCam's own, so nothing user-supplied is fetched. */
  'POST /api/tryon/cloth-template': async (req) => {
    const { fileId, templateId } = (await req.json()) as {
      fileId?: string
      templateId?: string
    }
    if (!fileId || !templateId) return json({ error: 'Missing photo or style.' }, 400)
    const url = await tryOnClothTemplate({ fileId }, templateId, req.signal)
    return json({ url })
  },

  'POST /api/tryon/hair': async (req) => {
    const { fileId, templateId } = (await req.json()) as {
      fileId?: string
      templateId?: string
    }
    if (!fileId || !templateId) return json({ error: 'Missing photo or style.' }, 400)
    const url = await tryOnHair(fileId, templateId, req.signal)
    return json({ url })
  },


  /**
   * The prescription: rank every aisle, then let the model pick one each.
   *
   * Takes the reading rather than a photo, so re-opening a track costs no
   * YouCam units.
   */
  'POST /api/shop': async (req) => {
    const { skinHex, lipHex, concerns = [], faceShape, gender } = (await req.json()) as {
      skinHex?: string
      lipHex?: string
      concerns?: ConcernOut[]
      faceShape?: string
      gender?: string
    }
    if (!skinHex || !/^#[0-9a-f]{6}$/i.test(skinHex)) {
      return json({ error: 'Missing skin colour from the scan.' }, 400)
    }

    const palette = paletteFor(skinHex)
    const formula = formulaFor(concerns)

    const [foundations, lipsticks, blushes, clothes] = await Promise.all([
      shelf('foundation', () => loadMakeup('foundation', req.signal)),
      shelf('lipstick', () => loadMakeup('lipstick', req.signal)),
      shelf('blush', () => loadMakeup('blush', req.signal)),
      // Two stores, so one dead feed cannot empty the shelf. Kotn and Rothys
      // both publish plain colour names that resolve to a hex.
      shelf('clothes', async () => {
        const stores = ['us.kotn.com', 'www.rothys.com']
        const results = await Promise.allSettled(
          stores.map((s) => loadShopify(s, req.signal)),
        )
        return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
      }),
    ])

    // Merchant rows join the public feeds rather than replacing them, and
    // ranking treats them identically: a store gets reach by matching the
    // shopper, not by being uploaded.
    const owned = await ownedProducts().catch(() => [])
    const withStore = (aisle: Aisle, rows: Product[]) => [
      ...rows,
      ...productsForAisle(aisle),
      ...owned.filter((p) => p.aisle === aisle),
    ]

    const shortlists: Record<string, Ranked[]> = {
      foundation: rankFoundation(withStore('foundation', foundations), skinHex),
      lipstick: rankByPalette(withStore('lipstick', lipsticks), palette),
      blush: rankByPalette(withStore('blush', blushes), palette),
      clothes: rankByPalette(withStore('clothes', clothes), palette),
      skincare: rankSkincare(withStore('skincare', SNAPSHOT.skincare), concerns),
    }

    // Detected gender demotes mismatched rows rather than removing them: the
    // read can be wrong, and hiding menswear from a misread is worse than
    // showing it lower down.
    const wants = gender?.toLowerCase() === 'male' ? 'men' : gender?.toLowerCase() === 'female' ? 'women' : null
    if (wants) {
      for (const list of Object.values(shortlists)) {
        list.sort((a, b) => rankAudience(a, wants) - rankAudience(b, wants))
      }
    }

    const verdict = await judge(
      shortlists,
      {
        undertone: palette.undertone,
        season: palette.season,
        finish: formula.finish,
        because: formula.because,
      },
      req.signal,
    )

    // Concealer is derived, not stocked: no free catalogue carries one.
    const top = shortlists.foundation[0]
    const concealer = top
      ? { hex: concealerFrom(top.hex), from: top.name, shade: top.shadeName }
      : null

    return json({
      palette,
      formula,
      shortlists,
      picks: verdict.picks,
      together: verdict.together,
      concealer,
      makeup: {
        effects: effectsFor(formula, top?.hex ?? skinHex, lipHex),
        explain: explainEffects(formula, palette),
      },
      fellBack: Object.fromEntries(
        [...shelves.entries()].map(([k, v]) => [k, v.fellBack]),
      ),
    })
  },

  /** Per-feed row counts and which shelves fell back to the snapshot. */
  'GET /api/orders': async (req) => {
    const storeId = new URL(req.url).searchParams.get('storeId')
    if (!storeId) return json({ error: 'Missing store.' }, 400)
    return json({ orders: ordersFor(storeId) })
  },

  'GET /api/feeds': async () =>
    json({
      shelves: Object.fromEntries(
        [...shelves.entries()].map(([name, v]) => [
          name,
          { rows: v.rows.length, fellBack: v.fellBack, ageMs: Date.now() - v.at },
        ]),
      ),
    }),

  /* -- Merchant stores. A teammate owns persistence; this owns the shape. -- */

  'POST /api/stores': async (req) => {
    const { name, contactEmail } = (await req.json()) as Record<string, string>
    if (!name?.trim()) return json({ error: 'A store needs a name.' }, 400)
    if (!contactEmail?.includes('@')) {
      return json({ error: 'A contact email is required for orders.' }, 400)
    }
    return json({ store: createStore({ name: name.trim(), contactEmail }) })
  },

  'GET /api/stores': async () => json({ stores: listStores() }),

  /** Uploaded rows are validated, and rejects are reported with a reason. */
  'POST /api/stores/products': async (req) => {
    const { storeId, products } = (await req.json()) as {
      storeId?: string
      products?: unknown
    }
    if (!storeId) return json({ error: 'Missing store.' }, 400)
    if (!Array.isArray(products) || products.length === 0) {
      return json({ error: 'No products supplied.' }, 400)
    }
    try {
      return json(addProducts(storeId, products as never))
    } catch {
      return json({ error: 'Unknown store.' }, 404)
    }
  },

  /** Checkout takes ids and quantities only; prices are set here. */
  'POST /api/orders': async (req) => {
    const { lines } = (await req.json()) as { lines?: Array<{ productId: string; qty: number }> }
    if (!Array.isArray(lines) || lines.length === 0) {
      return json({ error: 'Your bag is empty.' }, 400)
    }
    const placed = placeOrder(lines)
    if (placed.length === 0) {
      return json(
        { error: 'Nothing in your bag can be ordered yet. Only store-listed items ship.' },
        400,
      )
    }
    return json({ orders: placed })
  },

  'GET /api/catalogue': async () => json({ garments: GARMENTS }),

  /** Store-owner catalogue. Auth and ownership live in the handler. */
  'GET /api/products': productsRoute,
  'POST /api/products': productsRoute,
  'POST /api/products/import': productsRoute,
  'DELETE /api/products': productsRoute,
}

/** Mismatched audience sinks; unisex and unset stay neutral. */
function rankAudience(p: { audience?: string }, wants: string): number {
  if (!p.audience || p.audience === 'unisex') return 0
  return p.audience === wants ? -1 : 1
}

/** YouCam fetches ref_file_url from its own servers, so it must be public. */
function absolute(path: string, req: Request): string {
  if (/^https?:\/\//i.test(path)) return path
  const base = process.env.PUBLIC_BASE_URL ?? new URL(req.url).origin
  return new URL(path, base).href
}

const DIST = 'dist'
const MIME: Record<string, string> = {
  html: 'text/html',
  js: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  webmanifest: 'application/manifest+json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
}

Bun.serve({
  port: PORT,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url)
    const route = routes[`${req.method} ${url.pathname}`]

    if (route) {
      try {
        return await route(req)
      } catch (err) {
        return fail(err, url.pathname)
      }
    }

    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404)

    // Renders are served from here, not from Vite's public dir: Vite's static
    // middleware does not notice a just-written file and answers index.html,
    // which makes every first try-on look broken.
    if (url.pathname.startsWith('/generated/')) {
      const f = Bun.file(join('renders', url.pathname.slice('/generated/'.length)))
      return (await f.exists()) ? new Response(f) : new Response('Not found', { status: 404 })
    }

    const path = url.pathname === '/' ? '/index.html' : url.pathname
    const file = Bun.file(join(DIST, path.replace(/^\/+/, '')))
    if (await file.exists()) {
      const ext = path.split('.').pop() ?? ''
      return new Response(file, {
        headers: { 'Content-Type': MIME[ext] ?? 'application/octet-stream' },
      })
    }
    const index = Bun.file(join(DIST, 'index.html'))
    return (await index.exists())
      ? new Response(index, { headers: { 'Content-Type': 'text/html' } })
      : new Response('Run "bun run build" first.', { status: 404 })
  },
})

if (!process.env.YOUCAM_API_KEY) {
  console.warn('\n  !  YOUCAM_API_KEY is not set. Add it to .env.\n')
}
console.log(`  ->  http://localhost:${PORT}\n`)
