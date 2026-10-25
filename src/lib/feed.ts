/**
 * Pull a merchant's catalogue from a URL they host.
 *
 * Three shapes, because retailers already have one of them: a JSON array, a
 * CSV export, or a Shopify storefront. Everything converges on addProducts'
 * validation, so a feed row and a pushed row are held to the same standard —
 * a row without a resolvable colour is rejected rather than ranked as grey.
 */
import { finishFrom, loadShopify, namedColorHex, type Product } from './catalogue'
import { colorName } from './color'
import { parseCsv } from './products'

export type FeedKind = 'json' | 'csv' | 'shopify'

/** Rows as they arrive, before addProducts validates and ids them. */
export type FeedRow = Partial<Product> & { name: string; colorWord?: string }

/** A feed is a network call to someone else's server: never wait forever. */
const TIMEOUT_MS = 15_000

export function detectKind(url: string): FeedKind {
  if (/\.csv(\?|$)/i.test(url)) return 'csv'
  if (/\.json(\?|$)/i.test(url)) return 'json'
  // A bare domain is assumed to be Shopify: that is the only kind we can read
  // without being told a path.
  return /^https?:\/\/[^/]+\/?$/i.test(url) ? 'shopify' : 'json'
}

export async function fetchFeed(url: string, kind: FeedKind = detectKind(url)): Promise<FeedRow[]> {
  if (kind === 'shopify') {
    const host = url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    return loadShopify(host, AbortSignal.timeout(TIMEOUT_MS)) as Promise<FeedRow[]>
  }

  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Feed returned ${res.status}.`)

  if (kind === 'csv') return csvToRows(await res.text())

  const body = (await res.json()) as unknown
  // Accept a bare array or the common { products: [...] } envelope.
  const rows = Array.isArray(body)
    ? body
    : Array.isArray((body as { products?: unknown }).products)
      ? (body as { products: unknown[] }).products
      : null
  if (!rows) throw new Error('Expected a JSON array of products, or { products: [...] }.')
  return rows as FeedRow[]
}

/**
 * Rows -> products for a one-off audit, stored nowhere.
 *
 * Held to the same standard as a pushed row: no resolvable colour, no product.
 * Only the aisles the audit reads are kept; the rest are counted, not lost
 * silently, so a sheet of shirts does not come back as "no foundation" with no
 * explanation.
 */
const AUDITED: Product['aisle'][] = ['foundation', 'blush', 'lipstick']

export function rowsToCatalogue(rows: FeedRow[]): {
  products: Product[]
  rejected: Array<{ name: string; why: string }>
  skipped: number
} {
  const products: Product[] = []
  const rejected: Array<{ name: string; why: string }> = []
  let skipped = 0
  for (const [i, row] of rows.entries()) {
    const name = String(row.name ?? '').trim()
    const aisle = String(row.aisle ?? '').trim().toLowerCase() as Product['aisle']
    if (!AUDITED.includes(aisle)) {
      skipped += 1
      continue
    }
    const hex = /^#[0-9a-f]{6}$/i.test(row.hex ?? '')
      ? row.hex!.toLowerCase()
      : row.colorWord
        ? namedColorHex(row.colorWord)
        : null
    if (!name || !hex) {
      rejected.push({ name: name || `Row ${i + 2}`, why: name ? 'No colour we could resolve.' : 'No name.' })
      continue
    }
    products.push({
      id: `audit-${i}`,
      aisle,
      brand: String(row.brand ?? '').trim() || 'Your range',
      name,
      hex,
      colorName: colorName(hex),
      shadeName: row.shadeName,
      tags: row.tags,
      ...(aisle === 'foundation' && finishFrom(row.finish) ? { finish: finishFrom(row.finish) } : {}),
    })
  }
  return { products, rejected, skipped }
}

/** Header-driven so column order does not matter, only the names. */
export function csvToRows(text: string): FeedRow[] {
  const grid = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''))
  if (grid.length < 2) throw new Error('The CSV has a header but no rows.')

  const header = grid[0]!.map((c) => c.trim().toLowerCase().replace(/\s+/g, ''))
  const at = (row: string[], key: string) => {
    const i = header.indexOf(key)
    return i === -1 ? undefined : row[i]?.trim() || undefined
  }

  return grid.slice(1).map((row) => {
    const price = at(row, 'price')
    const stock = at(row, 'stock')
    const tags = at(row, 'tags')
    return {
      name: at(row, 'name') ?? '',
      brand: at(row, 'brand'),
      aisle: at(row, 'aisle') as Product['aisle'] | undefined,
      hex: at(row, 'hex'),
      colorWord: at(row, 'color') ?? at(row, 'colour') ?? at(row, 'colorword'),
      shadeName: at(row, 'shade') ?? at(row, 'shadename'),
      price: price ? Number(price) || undefined : undefined,
      stock: stock ? Number(stock) || undefined : undefined,
      image: at(row, 'image'),
      url: at(row, 'url'),
      garmentCategory: at(row, 'garmentcategory'),
      finish: finishFrom(at(row, 'finish')),
      tags: tags ? tags.split(/[;|]/).map((t) => t.trim()).filter(Boolean) : undefined,
    }
  })
}
