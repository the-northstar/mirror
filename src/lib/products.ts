/**
 * Store-owner products: what a signed-in retailer adds to the shop.
 *
 * An owner product is an ordinary catalogue Product plus the owner's id, so it
 * drops straight onto the right shelf and is ranked by the same colour logic as
 * every scraped row. Pure validation, shared by the browser form, the
 * spreadsheet import and the API route, so the rules cannot drift apart.
 *
 * Imports carry explicit .ts extensions because the API route is run by Node's
 * type stripper, which does not do bundler-style extension resolution.
 */
import { colorName } from './color.ts'
import type { Order, Product } from './catalogue.ts'

export interface OwnerProduct extends Product {
  /** Clerk user id of the store owner who added it. */
  ownerId: string
}

/**
 * Only aisles the app can actually act on. Glasses and jewellery were dropped:
 * YouCam has no render path for either on this key, so a shopper would get a
 * recommendation she could never see on herself.
 */
export const AISLES: Product['aisle'][] = [
  'clothes',
  'foundation',
  'lipstick',
  'blush',
  'skincare',
]

/** Spreadsheet columns, in the order the template writes them. */
export const COLUMNS = [
  'name', 'brand', 'aisle', 'hex', 'image', 'price', 'url', 'garmentCategory',
] as const

/** What YouCam renders a garment as. 'auto' lets it guess from the photo. */
export const GARMENT_CATEGORIES = [
  'auto', 'upper_body', 'lower_body', 'full_body', 'outer', 'shoes',
] as const

export interface ProductInput {
  garmentCategory?: unknown
  name?: unknown
  brand?: unknown
  aisle?: unknown
  hex?: unknown
  image?: unknown
  price?: unknown
  url?: unknown
}

/**
 * Validate one submitted product. Throws with a message the owner can act on.
 *
 * Runs server-side as well as in the form: the API route is a trust boundary
 * and the browser's copy of these rules proves nothing.
 */
/** The product's id, needed before normalising to name an uploaded file. */
export const productId = (name: string, ownerId: string) =>
  `own-${ownerId.slice(-8)}-${slug(name.trim())}`

export function normalizeProduct(input: unknown, ownerId: string): OwnerProduct {
  const p = (input ?? {}) as ProductInput
  const name = str(p.name)
  const brand = str(p.brand) || 'Your store'
  const hex = str(p.hex).toLowerCase()
  const image = str(p.image)
  const url = str(p.url)
  const aisle = (str(p.aisle) || 'clothes') as Product['aisle']
  const garmentCategory = str(p.garmentCategory) || 'auto'

  if (!name) throw new Error('Give the product a name.')
  if (name.length > 80) throw new Error('Name is too long (80 characters max).')
  if (!AISLES.includes(aisle)) {
    throw new Error(`Unknown aisle "${aisle}". Use one of: ${AISLES.join(', ')}.`)
  }
  // A row we cannot colour is invisible to the ranker, so it is refused rather
  // than stocked with a placeholder — same rule the scraped shelves apply.
  if (!/^#[0-9a-f]{6}$/.test(hex)) {
    throw new Error('Colour must be a 6-digit hex like #2f5d62.')
  }
  // Try-on fetches the image from YouCam's own servers, so it has to be
  // reachable: either a public https URL, or one of our own uploads, which the
  // try-on route resolves against PUBLIC_BASE_URL before handing it over.
  if (!/^https:\/\/[^\s"']+$/i.test(image) && !/^\/uploads\/[\w.-]+$/.test(image)) {
    throw new Error('Add a photo, or paste a public https:// image URL.')
  }
  if (url && !/^https:\/\/[^\s"']+$/i.test(url)) {
    throw new Error('Product link must be a public https:// URL.')
  }

  const price = p.price === '' || p.price == null ? undefined : Number(p.price)
  if (price !== undefined && !Number.isFinite(price)) {
    throw new Error('Price must be a number.')
  }

  return {
    // Owner-scoped id: re-adding the same name updates rather than duplicating,
    // and one owner can never collide with another's product.
    id: productId(name, ownerId),
    // Orders group by store and skip rows without one, so the owner is the
    // store: without this their products are visible but never orderable.
    storeId: `own-${ownerId.slice(-8)}`,
    aisle,
    brand,
    name,
    hex,
    colorName: colorName(hex),
    image,
    ...(url ? { url } : {}),
    ...(aisle === 'clothes' ? { garmentCategory } : {}),
    ...(price !== undefined ? { price } : {}),
    ownerId,
  }
}

/**
 * Spreadsheet rows -> products.
 *
 * Takes the raw grid as read from .xlsx or .csv: row 0 is the header, and
 * columns are matched by name so owners can reorder them. Bad rows are
 * reported by line number instead of failing the whole file — a typo in row 40
 * should not cost the other 39.
 */
export function rowsToProducts(
  grid: unknown[][],
  ownerId: string,
): { products: OwnerProduct[]; errors: string[] } {
  const rows = grid.filter((r) => Array.isArray(r) && r.some((c) => str(c) !== ''))
  if (rows.length < 2) {
    return { products: [], errors: ['The sheet has a header but no product rows.'] }
  }

  const header = rows[0].map((c) => str(c).toLowerCase().replace(/\s+/g, ''))
  const at = (row: unknown[], key: string) => {
    const i = header.indexOf(key)
    return i === -1 ? '' : row[i]
  }
  const missing = ['name', 'hex', 'image'].filter((k) => !header.includes(k))
  if (missing.length) {
    return {
      products: [],
      errors: [
        `The sheet is missing a ${missing.join(' and ')} column. Expected: ${COLUMNS.join(', ')}.`,
      ],
    }
  }

  const products: OwnerProduct[] = []
  const errors: string[] = []
  for (const [i, row] of rows.slice(1).entries()) {
    try {
      products.push(
        normalizeProduct(
          Object.fromEntries(COLUMNS.map((c) => [c, at(row, c)])),
          ownerId,
        ),
      )
    } catch (err) {
      // +2: skip the header, and count from 1 like a spreadsheet does.
      errors.push(`Row ${i + 2}: ${(err as Error).message}`)
    }
  }
  return { products, errors }
}

/** Minimal CSV reader: quoted fields, doubled quotes, embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [[]]
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      rows.at(-1)!.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      rows.at(-1)!.push(field)
      field = ''
      rows.push([])
    } else field += c
  }
  rows.at(-1)!.push(field)
  return rows.filter((r) => r.length > 1 || r[0] !== '')
}

const str = (v: unknown): string => (v == null ? '' : String(v).trim())
const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/* -- Finance ------------------------------------------------------------- */

export interface ProductSales {
  id: string
  name: string
  units: number
  revenue: number
}

export interface Finance {
  revenue: number
  orders: number
  units: number
  /** Best seller first, so the owner reads the answer before the table. */
  byProduct: ProductSales[]
}

/**
 * Roll a store's orders up into its books.
 *
 * Revenue is summed from each line's recorded unitPrice, not from the
 * product's current price: re-pricing history every time the owner edits a
 * product would rewrite what was actually charged.
 */
export function summariseOrders(orders: Order[]): Finance {
  const byProduct = new Map<string, ProductSales>()
  let revenue = 0
  let units = 0

  for (const order of orders) {
    for (const line of order.lines) {
      const row = byProduct.get(line.product.id) ?? {
        id: line.product.id,
        name: line.product.name,
        units: 0,
        revenue: 0,
      }
      row.units += line.qty
      row.revenue += line.unitPrice * line.qty
      byProduct.set(row.id, row)
      units += line.qty
      revenue += line.unitPrice * line.qty
    }
  }

  return {
    // Money in cents would be better; these are catalogue prices with two
    // decimals, so round the sum rather than carry float dust into the UI.
    revenue: Math.round(revenue * 100) / 100,
    orders: orders.length,
    units,
    // Ties break on units then name, so the table cannot reshuffle between
    // requests for two products that earned the same.
    byProduct: [...byProduct.values()].sort(
      (a, b) => b.revenue - a.revenue || b.units - a.units || a.name.localeCompare(b.name),
    ),
  }
}

/* -- Catalogue statistics ------------------------------------------------ */

export interface CatalogueStats {
  count: number
  /** Photos we host vs. photos pointing at someone else's server. */
  uploaded: number
  linked: number
  /** Rows that would be ordered at zero, because orders re-price server-side. */
  unpriced: number
  averagePrice: number
  byAisle: Array<{ aisle: string; count: number }>
}

/**
 * What is actually on the shelves.
 *
 * `unpriced` is called out rather than averaged away: placing an order prices
 * each line from the product, so a row without a price sells for nothing.
 */
export function summariseCatalogue(
  products: Array<Pick<Product, 'aisle' | 'image' | 'price'>>,
): CatalogueStats {
  const priced = products.filter((p) => typeof p.price === 'number' && p.price > 0)
  const byAisle = new Map<string, number>()
  for (const p of products) byAisle.set(p.aisle, (byAisle.get(p.aisle) ?? 0) + 1)

  return {
    count: products.length,
    uploaded: products.filter((p) => p.image?.startsWith('/uploads/')).length,
    linked: products.filter((p) => !p.image?.startsWith('/uploads/')).length,
    unpriced: products.length - priced.length,
    averagePrice: priced.length
      ? Math.round((priced.reduce((sum, p) => sum + (p.price ?? 0), 0) / priced.length) * 100) / 100
      : 0,
    byAisle: [...byAisle.entries()]
      .map(([aisle, count]) => ({ aisle, count }))
      .sort((a, b) => b.count - a.count || a.aisle.localeCompare(b.aisle)),
  }
}

/* -- Trend --------------------------------------------------------------- */

export interface DayPoint {
  /** ISO date, so the chart's x-axis sorts as a string. */
  day: string
  revenue: number
  orders: number
}

/**
 * Revenue per day, including the days nothing sold.
 *
 * Gaps matter on a trend line: dropping empty days would draw a flat, healthy
 * looking chart out of two sales a fortnight apart. `now` is a parameter so
 * the series is testable rather than dependent on the clock.
 */
export function salesByDay(orders: Order[], days = 14, now = Date.now()): DayPoint[] {
  const key = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  const buckets = new Map<string, DayPoint>()

  const DAY = 24 * 60 * 60 * 1000
  for (let i = days - 1; i >= 0; i--) {
    const day = key(now - i * DAY)
    buckets.set(day, { day, revenue: 0, orders: 0 })
  }

  for (const o of orders) {
    const hit = buckets.get(key(o.at))
    if (!hit) continue // older than the window
    hit.revenue = Math.round((hit.revenue + o.total) * 100) / 100
    hit.orders += 1
  }
  return [...buckets.values()]
}
