import { colorName } from './color'

/** One sellable thing, whatever aisle it came from. */
export type Aisle =
  | 'foundation'
  | 'lipstick'
  | 'blush'
  | 'skincare'
  | 'clothes'

/** Who a product is cut for. Unset means it suits anyone. */
export type Audience = 'women' | 'men' | 'unisex'

export interface Product {
  id: string
  aisle: Aisle
  brand: string
  name: string
  /** Defaults to unisex: hiding a product is worse than ranking it lower. */
  audience?: Audience
  /** Set when the row came from a merchant store rather than a public feed. */
  storeId?: string
  stock?: number
  /** Measured or published colour. Rows without one are dropped, not defaulted. */
  hex: string
  colorName: string
  shadeName?: string
  price?: number
  image?: string
  url?: string
  /** Free-text the ranker reads: ingredients, face-shape notes, metal. */
  tags?: string[]
  /** upper_body / full_body / shoes / outer. Try-on renders wrongly without it. */
  garmentCategory?: string
}

const MAKEUP_API = 'https://makeup-api.herokuapp.com/api/v1/products.json'

/**
 * Foundation and lip shades.
 *
 * This is the only free source publishing a hex per shade, which both the
 * foundation deltaE match and the palette ranking sort on. One product row
 * fans out into one Product per shade, because the shade is what gets matched.
 */
export async function loadMakeup(
  type: 'foundation' | 'lipstick' | 'blush',
  signal?: AbortSignal,
): Promise<Product[]> {
  const res = await fetch(`${MAKEUP_API}?product_type=${type}`, { signal })
  if (!res.ok) throw new Error(`makeup-api ${res.status}`)
  const rows = (await res.json()) as Array<{
    id: number
    brand?: string
    name?: string
    price?: string
    api_featured_image?: string
    product_link?: string
    description?: string
    product_colors?: Array<{ hex_value?: string; colour_name?: string }>
  }>

  const out: Product[] = []
  for (const row of rows) {
    for (const shade of row.product_colors ?? []) {
      const hex = shade.hex_value?.trim()
      // A row we cannot colour is noise pretending to be data in a colour
      // ranking, so it is dropped rather than given a placeholder.
      if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) continue
      out.push({
        id: `${type}-${row.id}-${slug(shade.colour_name ?? hex)}`,
        aisle: type,
        brand: row.brand ?? 'Unknown',
        name: row.name?.trim() ?? 'Unnamed',
        hex,
        colorName: colorName(hex),
        shadeName: shade.colour_name?.trim(),
        price: row.price ? Number(row.price) || undefined : undefined,
        image: row.api_featured_image?.startsWith('//')
          ? `https:${row.api_featured_image}`
          : row.api_featured_image,
        url: row.product_link,
        tags: row.description ? [row.description.slice(0, 400)] : [],
      })
    }
  }
  return out
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

/**
 * Clothes from any Shopify storefront's public products.json. No key needed.
 *
 * Colour comes from the shade/variant title where the merchant names one;
 * anything unnameable is dropped for the same reason as above.
 */
export async function loadShopify(
  store: string,
  signal?: AbortSignal,
): Promise<Product[]> {
  const res = await fetch(`https://${store}/products.json?limit=250`, { signal })
  if (!res.ok) throw new Error(`${store} ${res.status}`)
  const { products } = (await res.json()) as {
    products: Array<{
      id: number
      title: string
      vendor: string
      handle: string
      body_html?: string
      images?: Array<{ src: string }>
      variants?: Array<{ title: string; price: string }>
      options?: Array<{ name: string; values: string[] }>
    }>
  }

  const out: Product[] = []
  for (const p of products) {
    const colourOpt = p.options?.find((o) => /colou?r/i.test(o.name))
    const values = colourOpt?.values ?? []
    for (const value of values.slice(0, 4)) {
      const hex = namedColorHex(value)
      if (!hex) continue
      out.push({
        id: `shopify-${p.id}-${slug(value)}`,
        aisle: 'clothes',
        brand: p.vendor,
        name: p.title,
        hex,
        colorName: colorName(hex),
        shadeName: value,
        price: p.variants?.[0] ? Number(p.variants[0].price) || undefined : undefined,
        image: p.images?.[0]?.src,
        // The storefront does not say what the garment is, so let the engine
        // classify rather than asserting upper_body and rendering a dress wrong.
        garmentCategory: 'auto',
        url: `https://${store}/products/${p.handle}`,
      })
    }
  }
  return out
}

/**
 * Clothes from dummyjson.
 *
 * Chosen over scraping a storefront for two reasons that matter here: the
 * photos are on a CDN that actually stays up, and each source declares the
 * garment category, so try-on knows whether a row is upper_body or full_body
 * instead of guessing. Guessing renders a dress as a shirt.
 */
const CLOTHES_SOURCES = [
  { path: 'mens-shirts', category: 'upper_body', audience: 'men' },
  { path: 'tops', category: 'upper_body', audience: 'women' },
  { path: 'womens-dresses', category: 'full_body', audience: 'women' },
  { path: 'mens-shoes', category: 'shoes', audience: 'men' },
  { path: 'womens-shoes', category: 'shoes', audience: 'women' },
] as const

export async function loadClothes(signal?: AbortSignal): Promise<Product[]> {
  const results = await Promise.allSettled(
    CLOTHES_SOURCES.map(async (src) => {
      const res = await fetch(
        `https://dummyjson.com/products/category/${src.path}?limit=0&select=id,title,price,thumbnail,brand`,
        { signal },
      )
      if (!res.ok) throw new Error(`${src.path} ${res.status}`)
      const { products } = (await res.json()) as {
        products: Array<{
          id: number
          title: string
          price: number
          thumbnail?: string
          brand?: string
        }>
      }
      return products
        .filter((p) => p.thumbnail)
        .map(
          (p): Product => ({
            id: `dj-${src.path}-${p.id}`,
            aisle: 'clothes',
            brand: p.brand ?? 'Studio',
            name: p.title,
            // The real colour is measured from the photo at request time; a
            // neutral placeholder here would rank as if it were grey.
            hex: '#9aa0ad',
            colorName: 'unmeasured',
            price: p.price,
            image: p.thumbnail,
            audience: src.audience,
            garmentCategory: src.category,
          }),
        )
    }),
  )
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
}

/**
 * Skincare from Open Beauty Facts.
 *
 * Open data with real product photos, which the hardcoded snapshot never had.
 * Concern targeting comes from the category we asked for, not from parsing
 * marketing copy: a category is a fact, a claim in a description is not.
 */
const SKINCARE_SOURCES = [
  { tag: 'face-creams', treats: ['moisture', 'texture'] },
  { tag: 'serums', treats: ['texture', 'redness'] },
  { tag: 'cleansers', treats: ['oiliness', 'pore', 'acne'] },
  { tag: 'sunscreen', treats: ['redness'] },
] as const

export async function loadSkincare(signal?: AbortSignal): Promise<Product[]> {
  const results = await Promise.allSettled(
    SKINCARE_SOURCES.map(async (src) => {
      const res = await fetch(
        `https://world.openbeautyfacts.org/api/v2/search?categories_tags=${src.tag}` +
          `&fields=code,product_name,brands,image_front_url&page_size=24`,
        { signal, headers: { 'User-Agent': 'Mirror/1.0 (hackathon)' } },
      )
      if (!res.ok) throw new Error(`${src.tag} ${res.status}`)
      const { products } = (await res.json()) as {
        products: Array<{
          code?: string
          product_name?: string
          brands?: string
          image_front_url?: string
        }>
      }
      return products
        .filter((p) => p.image_front_url && p.product_name?.trim())
        .map(
          (p): Product => ({
            id: `skin-${src.tag}-${p.code ?? slug(p.product_name!)}`,
            aisle: 'skincare',
            brand: (p.brands ?? '').split(',')[0].trim() || 'Unbranded',
            name: p.product_name!.trim(),
            // Skincare ranks on what it treats, never on colour.
            hex: '#e8e4dd',
            colorName: 'neutral',
            image: p.image_front_url,
            tags: [...src.treats],
          }),
        )
    }),
  )
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
}

/**
 * Merchant colour words to hex.
 *
 * Deliberately narrow: a name we cannot resolve returns null and the row is
 * dropped, which is honest, rather than guessing a colour and ranking on it.
 */
const NAMED: Record<string, string> = {
  black: '#1a1a1a', white: '#f5f5f5', ivory: '#efe6d2', cream: '#efe6d2',
  grey: '#808080', gray: '#808080', charcoal: '#36383d', navy: '#26334d',
  blue: '#2f5d8f', 'light blue': '#8fb4d9', teal: '#2f5d62', green: '#3f6b4a',
  olive: '#6b6b3a', sage: '#8a9a7b', forest: '#2f4230', red: '#a8322d',
  burgundy: '#6b2532', rust: '#8c3f23', orange: '#c96a2b', coral: '#e07a5f',
  pink: '#d98a9c', rose: '#c98a95', purple: '#5b3a6b', plum: '#5b2c4e',
  brown: '#6b4a35', tan: '#b08d57', camel: '#b08d57', beige: '#d9c9b0',
  khaki: '#8a7d5c', mustard: '#c9a227', yellow: '#d9c04a', gold: '#c9a227',
  silver: '#c0c0c0', stone: '#a8a196', sand: '#d9c9b0', natural: '#d9c9b0',
}

export function namedColorHex(value: string): string | null {
  const v = value.toLowerCase().trim()
  if (NAMED[v]) return NAMED[v]
  // Merchants write "Deep Forest" or "Washed Black"; match the colour word.
  for (const [name, hex] of Object.entries(NAMED)) {
    if (new RegExp(`\\b${name}\\b`).test(v)) return hex
  }
  return null
}

/**
 * A committed floor so no shelf can empty.
 *
 * Fallback is per shelf, not per catalogue: losing blush must not cost the
 * foundation match.
 */
export const SNAPSHOT: Record<string, Product[]> = {
  skincare: [
    s('niacinamide', 'The Ordinary', 'Niacinamide 10% + Zinc', ['oiliness', 'pore', 'acne']),
    s('haluronic', 'The Inkey List', 'Hyaluronic Acid Serum', ['moisture', 'texture']),
    s('azelaic', 'Paula\'s Choice', '10% Azelaic Acid Booster', ['redness', 'acne']),
    s('vitc', 'Naturium', 'Vitamin C Complex', ['radiance', 'age_spot']),
    s('retinal', 'Medik8', 'Crystal Retinal 6', ['texture', 'age_spot']),
    s('caffeine', 'The Ordinary', 'Caffeine Solution 5%', ['dark_circle_v2']),
  ],
}

function s(id: string, brand: string, name: string, tags: string[]): Product {
  return { id, aisle: 'skincare', brand, name, hex: '#e8e4dd', colorName: 'neutral', tags }
}


/* -- Merchant stores ---------------------------------------------------- */

/**
 * Products uploaded by a merchant, kept beside the public feeds rather than
 * replacing them: a new store with four items should not empty the shelves.
 *
 * Held in memory here. The persistence layer is a teammate's work in progress,
 * so this module only owns the shape and the merge.
 * TODO(store): swap for the shared datastore once that lands.
 */
export interface Store {
  id: string
  name: string
  contactEmail: string
}

const stores = new Map<string, Store>()
const storeProducts = new Map<string, Product[]>()

export function createStore(input: Omit<Store, 'id'>): Store {
  const store: Store = { ...input, id: `store-${slug(input.name)}-${stores.size + 1}` }
  stores.set(store.id, store)
  storeProducts.set(store.id, [])
  return store
}

export const getStore = (id: string) => stores.get(id)
export const listStores = () => [...stores.values()]

/**
 * Add products to a store.
 *
 * Rows without a resolvable colour are rejected rather than stored: every
 * ranker here sorts on colour, so an uncoloured row would be noise pretending
 * to be a recommendation.
 */
export function addProducts(
  storeId: string,
  rows: Array<Partial<Product> & { name: string; hex?: string; colorWord?: string }>,
): { added: Product[]; rejected: Array<{ name: string; why: string }> } {
  const store = stores.get(storeId)
  if (!store) throw new Error('Unknown store')

  const added: Product[] = []
  const rejected: Array<{ name: string; why: string }> = []

  for (const row of rows) {
    const hex = row.hex?.match(/^#[0-9a-f]{6}$/i)
      ? row.hex
      : row.colorWord
        ? namedColorHex(row.colorWord)
        : null

    if (!hex) {
      rejected.push({ name: row.name, why: 'No colour we could resolve.' })
      continue
    }
    if (!row.aisle) {
      rejected.push({ name: row.name, why: 'No aisle given.' })
      continue
    }

    added.push({
      id: `${storeId}-${slug(row.name)}-${added.length}`,
      aisle: row.aisle,
      brand: row.brand ?? store.name,
      name: row.name,
      hex,
      colorName: colorName(hex),
      shadeName: row.shadeName ?? row.colorWord,
      price: row.price,
      image: row.image,
      url: row.url,
      audience: row.audience ?? 'unisex',
      storeId,
      stock: row.stock,
      tags: row.tags ?? [],
    })
  }

  storeProducts.set(storeId, [...(storeProducts.get(storeId) ?? []), ...added])
  return { added, rejected }
}

/**
 * Products from the signed-in store API, which persists them to disk — the
 * "shared datastore" the TODO above is waiting on. They land in the same
 * registry as in-memory merchant uploads so that every resolver (try-on,
 * orders, the shelves) reads one catalogue instead of three.
 */
const OWNER_SHELF = '__owner_products'

export function setOwnerProducts(rows: Product[]): void {
  storeProducts.set(OWNER_SHELF, rows)
}

export const productsForAisle = (aisle: Aisle): Product[] =>
  [...storeProducts.values()].flat().filter((p) => p.aisle === aisle)

export const findProduct = (id: string): Product | undefined =>
  [...storeProducts.values()].flat().find((p) => p.id === id)

/* -- Orders ------------------------------------------------------------- */

export interface OrderLine {
  productId: string
  qty: number
}

export interface Order {
  id: string
  at: number
  storeId: string
  lines: Array<{ product: Product; qty: number; unitPrice: number }>
  total: number
}

const orders = new Map<string, Order[]>()

/**
 * Place an order.
 *
 * Takes ids and quantities only and re-prices every line here, so a tampered
 * client cannot set its own price.
 */
export function placeOrder(lines: OrderLine[]): Order[] {
  const byStore = new Map<string, Order['lines']>()

  for (const line of lines) {
    const product = findProduct(line.productId)
    // Public-feed rows are not orderable: there is no merchant to fulfil them.
    if (!product?.storeId) continue
    const qty = Math.max(1, Math.floor(line.qty))
    const group = byStore.get(product.storeId) ?? []
    group.push({ product, qty, unitPrice: product.price ?? 0 })
    byStore.set(product.storeId, group)
  }

  const placed: Order[] = []
  for (const [storeId, group] of byStore) {
    const order: Order = {
      id: `ord-${storeId}-${(orders.get(storeId)?.length ?? 0) + 1}`,
      at: Date.now(),
      storeId,
      lines: group,
      total: group.reduce((sum, l) => sum + l.unitPrice * l.qty, 0),
    }
    orders.set(storeId, [...(orders.get(storeId) ?? []), order])
    placed.push(order)
  }
  return placed
}

export const ordersFor = (storeId: string) => orders.get(storeId) ?? []

/**
 * Restore persisted orders at boot. Without this the books reset on every
 * restart, which makes a revenue figure worse than no figure at all.
 */
export function restoreOrders(rows: Order[]): void {
  for (const o of rows) orders.set(o.storeId, [...(orders.get(o.storeId) ?? []), o])
}

/** Every order across every store, for persistence. */
export const allOrders = (): Order[] => [...orders.values()].flat()
