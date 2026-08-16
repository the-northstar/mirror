/**
 * API proxy. The YouCam key lives here and never reaches the browser.
 *
 * Also serves the built frontend and the renders directory, so one process runs
 * the whole app on any host.
 */
import sharp from 'sharp'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  analyzeConcerns,
  analyzeFace,
  analyzeTone,
  faultOf,
  clothTemplates,
  hairTemplates,
  lookTemplates,
  tryOnLook,
  tryOnClothTemplate,
  simulateSkin,
  SIMULATION_CONCERNS,
  tryOnCloth,
  tryOnHair,
  tryOnMakeup,
  uploadFile,
  YouCamError,
  type ConcernOut,
  type GarmentCategory,
} from './src/lib/youcam'
import { colorName, dominantColor } from './src/lib/color'
import { formulaFor, paletteFor } from './src/lib/prescription'
import { GARMENTS } from './src/lib/garments'
import {
  addProducts,
  createStore,
  ensureStore,
  listStores,
  loadMakeup,
  loadClothes,
  loadSkincare,
  loadShopify,
  getStore,
  ordersFor,
  placeOrder,
  productsForAisle,
  productsForStore,
  replaceStoreProducts,
  setStoreFeed,
  storeByKey,
  SNAPSHOT,
  type Aisle,
  type Product,
} from './src/lib/catalogue'
import { detectKind, fetchFeed, type FeedKind } from './src/lib/feed'
import {
  rankByPalette,
  rankFoundation,
  rankSkincare,
  JUDGE_SLICE,
  type Ranked,
} from './src/lib/rank'
import { localFor } from './src/lib/localCatalogue'
import { judge } from './src/lib/judge'
import { effectsFor, explainEffects, concealerFrom } from './src/lib/makeup'
import productsRoute, {
  ownedProducts,
  persistOrders,
  restoreOrdersFromDisk,
  restoreStoresFromDisk,
  persistStores,
  storeFromOwnerKey,
} from './api/products'

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

/**
 * Every page of a template catalogue, not just the first.
 *
 * One page is 20 styles and YouCam splits them by category, so asking for a
 * single page left the Hair studio offering three male cuts out of hundreds,
 * which reads as a broken screen rather than a short catalogue. Cached,
 * because the catalogue is the same for every shopper.
 */
const TEMPLATE_PAGE = 20
const MAX_TEMPLATES = 200
const templateCache = new Map<string, { rows: unknown[]; at: number }>()

async function allTemplates<T>(
  fetchPage: (pageSize: number, token?: string) => Promise<{ templates: T[]; next_token?: string }>,
): Promise<T[]> {
  const key = fetchPage.name
  const hit = templateCache.get(key)
  if (hit && Date.now() - hit.at < SHELF_TTL) return hit.rows as T[]

  const rows: T[] = []
  let token: string | undefined
  while (rows.length < MAX_TEMPLATES) {
    const page = await fetchPage(TEMPLATE_PAGE, token)
    rows.push(...(page.templates ?? []))
    token = page.next_token
    if (!token || !page.templates?.length) break
  }
  templateCache.set(key, { rows, at: Date.now() })
  return rows
}

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

/**
 * Measure each garment's real colour from its own photo.
 *
 * Must happen HERE, not in the browser: the ranker sorts on colour server-side,
 * so a placeholder would have every row ranking as the same grey and the
 * recommendation would be arbitrary. Cached by URL, and a row we cannot measure
 * is dropped rather than left as a placeholder.
 */
const colorCache = new Map<string, string | null>()

async function measureColors(rows: Product[]): Promise<Product[]> {
  const out = await Promise.all(
    rows.map(async (row) => {
      if (!row.image || row.colorName !== 'unmeasured') return row
      if (colorCache.has(row.image)) {
        const hit = colorCache.get(row.image)
        return hit ? { ...row, hex: hit, colorName: colorName(hit) } : null
      }
      try {
        const res = await fetch(row.image)
        if (!res.ok) throw new Error(String(res.status))
        const hex = await averageColor(await res.arrayBuffer())
        colorCache.set(row.image, hex)
        return hex ? { ...row, hex, colorName: colorName(hex) } : null
      } catch {
        colorCache.set(row.image, null)
        return null
      }
    }),
  )
  return out.filter((r): r is Product => r !== null)
}

/**
 * Decode to a small bitmap and take the chroma-weighted average.
 *
 * sharp rather than canvas: Bun has no createImageBitmap or OffscreenCanvas,
 * so a canvas implementation here would silently drop every garment.
 */
async function averageColor(bytes: ArrayBuffer): Promise<string | null> {
  try {
    const { data } = await sharp(Buffer.from(bytes))
      .resize(24, 24, { fit: 'fill' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    return dominantColor(new Uint8Array(data))
  } catch {
    return null
  }
}

/**
 * The SDK is embedded on domains we do not know in advance, so the origin is
 * open. Safe here because these routes carry no cookies and no session: the
 * only privileged one is authenticated by a Bearer key, which a browser will
 * not attach on its own.
 */
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
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
  // Never answer 502: Cloudflare and Traefik treat it as the origin being
  // broken and replace this JSON body with their own HTML error page, which
  // the client then fails to parse ("Unexpected token '<'"). 500 is passed
  // through untouched and is truthful — the upstream call failed, not the
  // gateway.
  return json({ error: message, code: e.code, owner }, owner === 'shopper' ? 400 : 500)
}

/**
 * The store behind an SDK request's key.
 *
 * Read from the Authorization header rather than the body or a query string:
 * a key in a URL ends up in access logs and Referer headers.
 */
async function storeFromKey(req: Request): Promise<{ id: string } | undefined> {
  const header = req.headers.get('authorization') ?? ''
  const key = header.replace(/^Bearer\s+/i, '').trim()
  if (!key) return undefined

  // A store registered through POST /api/stores carries its own key.
  const registered = storeByKey(key)
  if (registered) return registered

  // A signed-in owner's key names its own store and is verified by recomputing
  // the mac — nothing stored, so it survives a restart.
  const owned = await storeFromOwnerKey(key)
  return owned ? { id: owned } : undefined
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
    const owned = await ownedProducts().catch(() => [])
    const fromOwner = owned.find((p) => p.id === garmentId)
    const product = fromOwner ?? fromStore ?? fromShelf
    const legacy = GARMENTS.find((g) => g.id === garmentId)

    // An uploaded photo is a path on our own origin; YouCam fetches from its
    // servers, so it has to go out absolute.
    const imageUrl = product?.image
      ? absolute(product.image, req)
      : legacy
        ? absolute(legacy.url, req)
        : null
    if (!imageUrl) return json({ error: 'Unknown garment.' }, 400)

    const url = await tryOnCloth(
      { fileId: modelFileId },
      { url: imageUrl },
      // The feed knows what each garment is; falling back to upper_body would
      // render a dress as a shirt.
      ((product?.garmentCategory ?? legacy?.category) as GarmentCategory) ?? 'auto',
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

  /**
   * Skincare try-on: her own scan drives which concerns improve, so the render
   * answers "what would this fix on me" rather than showing a stock before-and-
   * after.
   */
  'POST /api/tryon/skincare': async (req) => {
    const { fileId, treats, concerns = [] } = (await req.json()) as {
      fileId?: string
      treats?: string[]
      concerns?: ConcernOut[]
    }
    if (!fileId) return json({ error: 'Missing photo.' }, 400)

    const intensities: Record<string, number> = {}
    for (const concern of treats ?? []) {
      const key = SIMULATION_CONCERNS[concern]
      if (!key) continue
      const row = concerns.find((c) => c.type === concern)
      // Improve in proportion to how pronounced it actually is, so a product
      // aimed at something she does not have barely moves the picture.
      const severity = row ? (100 - row.raw_score) / 100 : 0.5
      intensities[key] = Math.max(0.35, Math.min(1, severity * 1.6))
    }
    if (Object.keys(intensities).length === 0) {
      return json(
        { error: 'This product does not target anything your scan measured.' },
        400,
      )
    }

    const url = await simulateSkin(fileId, intensities, req.signal)
    return json({ url })
  },

  'POST /api/tryon/look': async (req) => {
    const { fileId, templateId } = (await req.json()) as Record<string, string>
    if (!fileId || !templateId) return json({ error: 'Missing photo or look.' }, 400)
    return json({ url: await tryOnLook(fileId, templateId, req.signal) })
  },

  'GET /api/hair/templates': async () => json({ templates: await allTemplates(hairTemplates) }),

  'GET /api/cloth/templates': async () => json({ templates: await allTemplates(clothTemplates) }),

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
    const { skinHex, lipHex, concerns = [], faceShape, gender, storeId } = (await req.json()) as {
      storeId?: string
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

    const [foundations, lipsticks, blushes, skincare, clothes] = await Promise.all([
      shelf('foundation', () => loadMakeup('foundation', req.signal)),
      shelf('lipstick', () => loadMakeup('lipstick', req.signal)),
      shelf('blush', () => loadMakeup('blush', req.signal)),
      // dummyjson first: its photos are on a CDN that stays up and each row
      // declares its garment category. The storefront scrapes stay as a
      // supplement, so one dead feed cannot empty the shelf.
      // Skincare has real photos now; the snapshot stays as the floor.
      shelf('skincare', async () => {
        const rows = await loadSkincare(req.signal)
        return rows.length ? rows : SNAPSHOT.skincare
      }),
      shelf('clothes', async () => {
        const [primary, extra] = await Promise.allSettled([
          loadClothes(req.signal),
          loadShopify('us.kotn.com', req.signal),
        ])
        const rows = [
          ...(primary.status === 'fulfilled' ? primary.value : []),
          ...(extra.status === 'fulfilled' ? extra.value : []),
        ]
        return measureColors(rows.filter((r) => r.image))
      }),
    ])

    // Merchant rows join the public feeds rather than replacing them, and
    // ranking treats them identically: a store gets reach by matching the
    // shopper, not by being uploaded.
    //
    // The SDK is the exception: embedded on a retailer's own site, it must
    // recommend only what that retailer actually sells, so neither the public
    // feeds nor the committed CSV catalogue may leak into it.
    const withStore = (aisle: Aisle, rows: Product[]) =>
      storeId
        ? productsForStore(storeId).filter((p) => p.aisle === aisle)
        : [
            ...rows,
            // The committed CSV catalogue joins on the same terms as a
            // merchant's rows: it widens the shelf, it does not jump it.
            ...localFor(aisle),
            ...productsForAisle(aisle),
          ]

    // Hair templates are YouCam's own catalogue, shaped as products so the
    // aisle behaves like the others. Ordered by the detected gender when we
    // have one, never filtered by it.
    // The whole catalogue, not the first page: one page is 20 styles split by
    // category, which left the aisle showing a handful.
    const hair = await allTemplates(hairTemplates)
      .then((templates) =>
        templates.map(
          (h): Ranked => ({
            id: h.id,
            aisle: 'hair' as never,
            brand: h.category_name,
            name: h.title,
            hex: '#e8e4dd',
            colorName: 'neutral',
            image: h.thumb,
            score: 0,
            reason: `A ${h.category_name.toLowerCase()} cut from YouCam's own style catalogue.`,
          }),
        ),
      )
      .catch(() => [])

    const looks = await lookTemplates(20)
      .then(({ templates }) =>
        templates.map(
          (l): Ranked => ({
            id: l.id,
            aisle: 'look' as never,
            brand: l.category_name,
            name: l.title,
            hex: '#e8e4dd',
            colorName: 'neutral',
            image: l.thumb,
            score: 0,
            reason: `A complete ${l.category_name.toLowerCase()} look from YouCam's artist catalogue.`,
          }),
        ),
      )
      .catch(() => [])

    const shortlists: Record<string, Ranked[]> = {
      hair,
      look: looks,
      foundation: rankFoundation(withStore('foundation', foundations), skinHex),
      lipstick: rankByPalette(withStore('lipstick', lipsticks), palette),
      blush: rankByPalette(withStore('blush', blushes), palette),
      clothes: rankByPalette(withStore('clothes', clothes), palette),
      skincare: rankSkincare(withStore('skincare', skincare), concerns),
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

    // The model sees a slice; the shopper sees the whole shelf.
    const forJudge = Object.fromEntries(
      Object.entries(shortlists).map(([k, v]) => [k, v.slice(0, JUDGE_SLICE)]),
    )
    const verdict = await judge(
      forJudge,
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

  /** Which optional layers are live on THIS instance. */
  'GET /api/health': async () =>
    json({
      youcam: Boolean(process.env.YOUCAM_API_KEY),
      stylist: Boolean(process.env.GEMINI_API_KEY),
    }),

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
    const store = createStore({ name: name.trim(), contactEmail })
    await persistStores()
    return json({ store })
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
      const result = addProducts(storeId, products as never)
      await persistStores()
      return json(result)
    } catch {
      return json({ error: 'Unknown store.' }, 404)
    }
  },

  /* -- SDK: server-to-server feed, authenticated by the store's key -------- */

  /**
   * Push a catalogue. The key identifies the store, so a merchant can only
   * ever write to their own shelf — the body never names one.
   */
  'POST /api/sdk/products': async (req) => {
    const store = await storeFromKey(req)
    if (!store) return json({ error: 'Invalid or missing API key.' }, 401)
    // An owner's store is implicit until they first use the SDK.
    ensureStore(store.id)

    const { products, replace } = (await req.json()) as {
      products?: unknown
      replace?: boolean
    }
    if (!Array.isArray(products) || products.length === 0) {
      return json({ error: 'No products supplied.' }, 400)
    }
    // `replace` swaps the catalogue wholesale; without it rows are merged by
    // id, so a repeated push updates instead of duplicating.
    if (replace) replaceStoreProducts(store.id, [])
    const result = addProducts(store.id, products as never)
    await persistStores()
    return json(result)
  },

  /** Point the store at a hosted feed and pull it once, now. */
  'POST /api/sdk/feed': async (req) => {
    const store = await storeFromKey(req)
    if (!store) return json({ error: 'Invalid or missing API key.' }, 401)
    // An owner's store is implicit until they first use the SDK.
    ensureStore(store.id)

    const { url, kind } = (await req.json()) as { url?: string; kind?: FeedKind }
    if (!url || !/^https?:\/\//i.test(url)) {
      return json({ error: 'A feed url is required.' }, 400)
    }
    try {
      const rows = await fetchFeed(url, kind ?? detectKind(url))
      // A feed is the whole catalogue, so it replaces rather than appends.
      replaceStoreProducts(store.id, [])
      const result = addProducts(store.id, rows as never)
      setStoreFeed(store.id, url, kind ?? detectKind(url))
      await persistStores()
      return json({ ...result, url })
    } catch (err) {
      return json({ error: `Could not read that feed: ${(err as Error).message}` }, 400)
    }
  },

  /** What the widget calls on load: the store's own shelf, public and keyless. */
  'GET /api/sdk/catalogue': async (req) => {
    const storeId = new URL(req.url).searchParams.get('storeId')
    if (!storeId) return json({ error: 'Missing storeId.' }, 400)
    // An owner's store exists as soon as they have an id, whether or not the
    // SDK has been used yet — an empty shelf is a valid answer, not a 404.
    if (!getStore(storeId) && !storeId.startsWith('own-')) {
      return json({ error: 'Unknown store.' }, 404)
    }
    return json({ products: productsForStore(storeId) })
  },

  /** Checkout takes ids and quantities only; prices are set here. */
  'POST /api/orders': async (req) => {
    const { lines } = (await req.json()) as { lines?: Array<{ productId: string; qty: number }> }
    if (!Array.isArray(lines) || lines.length === 0) {
      return json({ error: 'Your bag is empty.' }, 400)
    }
    const placed = placeOrder(lines)
    if (placed.length) await persistOrders()
    // An empty result is a real outcome, not an error: a bag of feed-only picks
    // has no merchant to send to, so it places zero orders and says so.
    return json({ orders: placed })
  },

  'GET /api/catalogue': async () => json({ garments: GARMENTS }),

  /** Store-owner catalogue. Auth and ownership live in the handler. */
  'GET /api/products': productsRoute,
  'GET /api/products/orders': productsRoute,
  'GET /api/products/credentials': productsRoute,
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

    // The SDK runs on the retailer's own domain, so its routes are the only
    // cross-origin ones. Everything else stays same-origin by default.
    const isSdk =
      url.pathname.startsWith('/api/sdk/') || url.pathname === '/api/stores/products'
    if (isSdk && req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    const route = routes[`${req.method} ${url.pathname}`]

    if (route) {
      try {
        const res = await route(req)
        if (!isSdk) return res
        const headers = new Headers(res.headers)
        for (const [k, v] of Object.entries(CORS)) headers.set(k, v)
        return new Response(res.body, { status: res.status, headers })
      } catch (err) {
        return fail(err, url.pathname)
      }
    }

    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404)

    // Renders are served from here, not from Vite's public dir: Vite's static
    // middleware does not notice a just-written file and answers index.html,
    // which makes every first try-on look broken.
    // Store-owner product photos. Served from disk, not from dist, so a photo
    // uploaded a second ago is visible without a rebuild.
    if (url.pathname.startsWith('/uploads/')) {
      // Only ever the flat filenames savePhoto writes. Traversal happens to
      // miss today because Bun leaves the pathname encoded, which is luck, not
      // a policy — so the name is checked rather than trusted.
      const name = url.pathname.slice('/uploads/'.length)
      if (!/^[\w.-]+$/.test(name) || name.includes('..')) {
        return new Response('Not found', { status: 404 })
      }
      // Same root the writer uses: in production that is the mounted volume,
      // not the app directory a deploy replaces.
      const f = Bun.file(join(process.env.DATA_DIR ?? '.', 'uploads', name))
      return (await f.exists()) ? new Response(f) : new Response('Not found', { status: 404 })
    }

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

// Prime the registry from disk, or try-on cannot resolve a stored product
// until something else happens to read the store first.
await ownedProducts().catch(() => [])
await restoreOrdersFromDisk()
await restoreStoresFromDisk()

console.log(
  `  stylist layer: ${process.env.GEMINI_API_KEY ? 'on' : 'off (set GEMINI_API_KEY to enable)'}`,
)
if (!process.env.YOUCAM_API_KEY) {
  console.warn('\n  !  YOUCAM_API_KEY is not set. Add it to .env.\n')
}
console.log(`  ->  http://localhost:${PORT}\n`)
