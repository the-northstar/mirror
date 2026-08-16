/**
 * Pull a merchant's catalogue from a URL they host.
 *
 * Three shapes, because retailers already have one of them: a JSON array, a
 * CSV export, or a Shopify storefront. Everything converges on addProducts'
 * validation, so a feed row and a pushed row are held to the same standard —
 * a row without a resolvable colour is rejected rather than ranked as grey.
 */
import { loadShopify, type Product } from './catalogue'
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

/** Header-driven so column order does not matter, only the names. */
function csvToRows(text: string): FeedRow[] {
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
      tags: tags ? tags.split(/[;|]/).map((t) => t.trim()).filter(Boolean) : undefined,
    }
  })
}
