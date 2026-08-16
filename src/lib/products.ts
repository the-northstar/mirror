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
import type { Product } from './catalogue.ts'

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
export const COLUMNS = ['name', 'brand', 'aisle', 'hex', 'image', 'price', 'url'] as const

export interface ProductInput {
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
export function normalizeProduct(input: unknown, ownerId: string): OwnerProduct {
  const p = (input ?? {}) as ProductInput
  const name = str(p.name)
  const brand = str(p.brand) || 'Your store'
  const hex = str(p.hex).toLowerCase()
  const image = str(p.image)
  const url = str(p.url)
  const aisle = (str(p.aisle) || 'clothes') as Product['aisle']

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
  // Try-on fetches this URL from YouCam's own servers, so it has to be public.
  if (!/^https:\/\/[^\s"']+$/i.test(image)) {
    throw new Error('Image must be a public https:// URL.')
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
    id: `own-${ownerId.slice(-8)}-${slug(name)}`,
    aisle,
    brand,
    name,
    hex,
    colorName: colorName(hex),
    image,
    ...(url ? { url } : {}),
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
