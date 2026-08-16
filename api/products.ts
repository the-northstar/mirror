/**
 * Store-owner catalogue.
 *
 *   GET    /api/products         -> public list (feeds the shop shelves)
 *   POST   /api/products         -> add/update one, signed-in owner only
 *   POST   /api/products/import  -> add many from .xlsx or .csv, owner only
 *   DELETE /api/products?id=     -> remove one, signed-in owner only
 *
 * Ownership comes from the Clerk session token, never from the request body,
 * so an owner can only ever touch their own rows.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { verifyToken } from '@clerk/backend'
import readXlsx from 'read-excel-file/node'
import {
  allOrders,
  ordersFor,
  restoreOrders,
  setOwnerProducts,
  type Order,
} from '../src/lib/catalogue.ts'
import {
  normalizeProduct,
  summariseOrders,
  parseCsv,
  rowsToProducts,
  productId,
  type OwnerProduct,
} from '../src/lib/products.ts'

// ponytail: a JSON file is the whole database. Swap for Postgres when two
// processes write at once or the catalogue outgrows one file read.
const STORE = 'products.json'
const ORDERS = 'orders.json'
const UPLOADS = 'uploads'
const MAX_PHOTO_BYTES = 10 * 1024 * 1024
const PHOTO_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
const MAX_SHEET_BYTES = 5 * 1024 * 1024

export const config = { runtime: 'nodejs', maxDuration: 60 }

async function load(): Promise<OwnerProduct[]> {
  let rows: OwnerProduct[] = []
  try {
    rows = JSON.parse(await readFile(STORE, 'utf8'))
  } catch {
    rows = []
  }
  // Rows written before products carried a storeId would be visible in the
  // shop but silently unorderable, so derive it rather than stranding them.
  rows = rows.map((r) =>
    r.storeId ? r : { ...r, storeId: `own-${r.ownerId.slice(-8)}` },
  )
  // Republish on every read so a write cannot leave the registry stale.
  setOwnerProducts(rows)
  return rows
}

/** Upsert by id, so re-importing a corrected sheet updates instead of duplicating. */
async function save(incoming: OwnerProduct[]): Promise<void> {
  const ids = new Set(incoming.map((p) => p.id))
  const kept = (await load()).filter((p) => !ids.has(p.id))
  await writeFile(STORE, JSON.stringify([...kept, ...incoming], null, 2))
}

/**
 * Orders live in a teammate's in-memory map, which empties on restart. The
 * books have to survive that, so they are mirrored to disk: restored at boot,
 * rewritten whenever an order is placed.
 */
export async function restoreOrdersFromDisk(): Promise<void> {
  try {
    restoreOrders(JSON.parse(await readFile(ORDERS, 'utf8')) as Order[])
  } catch {
    // No file yet, or it is unreadable: an empty ledger is the right start.
  }
}

export async function persistOrders(): Promise<void> {
  await writeFile(ORDERS, JSON.stringify(allOrders(), null, 2))
}

/**
 * Save an uploaded product photo and return the path it is served at.
 *
 * Named after the product, so re-uploading replaces the old photo instead of
 * littering the disk with orphans. The extension comes from the sniffed type,
 * never from the client's filename, which is what keeps `../` out of the path.
 */
async function savePhoto(file: File, id: string): Promise<string> {
  const ext = PHOTO_TYPES[file.type]
  if (!ext) throw new HttpError('Photo must be a JPEG, PNG or WebP.', 400)
  if (file.size > MAX_PHOTO_BYTES) throw new HttpError('Photo is over 10MB.', 400)

  await mkdir(UPLOADS, { recursive: true })
  const name = `${id}.${ext}`
  await writeFile(join(UPLOADS, name), Buffer.from(await file.arrayBuffer()))
  return `/uploads/${name}`
}

/** The owner's own store id, derived from the token — never from the client. */
const storeIdOf = (ownerId: string) => `own-${ownerId.slice(-8)}`

class HttpError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** Clerk session token -> owner id. Throws 401 if it is missing or invalid. */
async function ownerOf(req: Request): Promise<string> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError('Sign in to manage your store.', 401)

  const secretKey = process.env.CLERK_SECRET_KEY
  if (!secretKey) {
    throw new HttpError('CLERK_SECRET_KEY is not set on the server.', 500)
  }
  try {
    const { sub } = await verifyToken(token, { secretKey })
    return sub
  } catch {
    throw new HttpError('Your session expired. Sign in again.', 401)
  }
}

/** Read the uploaded sheet into a raw grid, whichever format it arrived in. */
async function gridOf(file: File): Promise<unknown[][]> {
  if (file.size > MAX_SHEET_BYTES) {
    throw new HttpError('That file is over 5MB.', 400)
  }
  const buf = Buffer.from(await file.arrayBuffer())
  // .xlsx is a zip; .csv and .txt are text. Sniff the zip magic rather than
  // trusting the extension or the browser's content type.
  if (buf.subarray(0, 2).toString() === 'PK') {
    try {
      // Depending on the runtime, this returns either the grid itself or the
      // multi-sheet shape [{ sheet, data }]. Accept both.
      const out = (await readXlsx(buf)) as unknown[]
      return (Array.isArray(out[0])
        ? out
        : ((out[0] as { data?: unknown[][] })?.data ?? [])) as unknown[][]
    } catch {
      throw new HttpError(
        'Could not read that spreadsheet. Save it as .xlsx or .csv and try again.',
        400,
      )
    }
  }
  return parseCsv(buf.toString('utf8'))
}

export default async function handler(req: Request): Promise<Response> {
  try {
    const { pathname } = new URL(req.url)

    if (req.method === 'GET' && pathname.endsWith('/orders')) {
      const ownerId = await ownerOf(req)
      // Scoped to the caller's own store: an owner cannot read another's books
      // by passing a storeId, because no storeId is accepted.
      const orders = ordersFor(storeIdOf(ownerId))
      return Response.json({ orders, finance: summariseOrders(orders) })
    }

    if (req.method === 'GET') {
      // Public: shoppers get the products only. A signed-in owner additionally
      // gets `mine`, so the store page can show what they may edit without
      // ever exposing one owner's id to another.
      const me = req.headers.get('authorization')
        ? await ownerOf(req).catch(() => null)
        : null
      const products = (await load()).map(({ ownerId, ...p }) => ({
        ...p,
        mine: ownerId === me,
      }))
      return Response.json({ products })
    }

    if (req.method === 'POST' && pathname.endsWith('/import')) {
      const ownerId = await ownerOf(req)
      const file = (await req.formData()).get('sheet')
      if (!(file instanceof File)) throw new HttpError('No file uploaded.', 400)

      const { products, errors } = rowsToProducts(await gridOf(file), ownerId)
      if (products.length) await save(products)
      // Partial success is the normal case for a hand-kept sheet, so report
      // both halves instead of picking one.
      return Response.json({ added: products.length, errors })
    }

    if (req.method === 'POST') {
      const ownerId = await ownerOf(req)

      // The form posts a photo, so it arrives as multipart; JSON is still
      // accepted for anything scripting against this.
      let input: Record<string, unknown>
      if (req.headers.get('content-type')?.includes('multipart/form-data')) {
        const form = await req.formData()
        input = Object.fromEntries(
          [...form.entries()].filter(([, v]) => typeof v === 'string'),
        )
        const photo = form.get('photo')
        if (photo instanceof File && photo.size > 0) {
          input.image = await savePhoto(photo, productId(String(input.name ?? ''), ownerId))
        }
      } else {
        input = (await req.json().catch(() => null)) as Record<string, unknown>
      }

      const product = normalizeProduct(input, ownerId)
      await save([product])
      return Response.json({ product })
    }

    if (req.method === 'DELETE') {
      const ownerId = await ownerOf(req)
      const id = new URL(req.url).searchParams.get('id')
      const all = await load()
      const target = all.find((p) => p.id === id)
      if (!target) throw new HttpError('No such product.', 404)
      if (target.ownerId !== ownerId) throw new HttpError('Not your product.', 403)
      await writeFile(STORE, JSON.stringify(all.filter((p) => p !== target), null, 2))
      return Response.json({ ok: true })
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 400
    const error = err instanceof Error ? err.message : 'Could not save that product.'
    if (status >= 500) console.error('[products]', error)
    return Response.json({ error }, { status })
  }
}

/** Owner products for a shelf, so the shop ranks them beside scraped rows. */
export async function ownedProducts(): Promise<OwnerProduct[]> {
  return load()
}
