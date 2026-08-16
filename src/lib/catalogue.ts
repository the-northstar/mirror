import { colorName } from './color'

/** One sellable thing, whatever aisle it came from. */
export interface Product {
  id: string
  aisle: 'foundation' | 'lipstick' | 'blush' | 'skincare' | 'clothes' | 'glasses' | 'jewellery'
  brand: string
  name: string
  /** Measured or published colour. Rows without one are dropped, not defaulted. */
  hex: string
  colorName: string
  shadeName?: string
  price?: number
  image?: string
  url?: string
  /** Free-text the ranker reads: ingredients, face-shape notes, metal. */
  tags?: string[]
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
        id: `cloth-${p.id}-${slug(value)}`,
        aisle: 'clothes',
        brand: p.vendor,
        name: p.title,
        hex,
        colorName: colorName(hex),
        shadeName: value,
        price: p.variants?.[0] ? Number(p.variants[0].price) || undefined : undefined,
        image: p.images?.[0]?.src,
        url: `https://${store}/products/${p.handle}`,
      })
    }
  }
  return out
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
  glasses: [
    g('round-tort', 'Bailey Nelson', 'Cooper round', '#6b4a35', ['round', 'square face', 'heart face']),
    g('square-blk', 'Warby Parker', 'Percey square', '#1a1a1a', ['square', 'round face', 'oval face']),
    g('cateye-hny', 'Gentle Monster', 'Lilit cat-eye', '#b08d57', ['cat-eye', 'round face', 'oval face']),
    g('aviator-gld', 'Ray-Ban', 'Classic aviator', '#c9a227', ['aviator', 'square face', 'oval face']),
  ],
  jewellery: [
    j('gold-hoop', 'Missoma', 'Small gold hoops', '#c9a227', ['gold', 'warm']),
    j('silver-chain', 'Monica Vinader', 'Silver chain', '#c0c0c0', ['silver', 'cool']),
    j('rose-pend', 'Astley Clarke', 'Rose gold pendant', '#c98a95', ['rose gold', 'warm', 'neutral']),
    j('pearl-drop', 'Otiumberg', 'Pearl drops', '#efe6d2', ['pearl', 'cool', 'neutral']),
  ],
  skincare: [
    s('niacinamide', 'The Ordinary', 'Niacinamide 10% + Zinc', ['oiliness', 'pore', 'acne']),
    s('haluronic', 'The Inkey List', 'Hyaluronic Acid Serum', ['moisture', 'texture']),
    s('azelaic', 'Paula\'s Choice', '10% Azelaic Acid Booster', ['redness', 'acne']),
    s('vitc', 'Naturium', 'Vitamin C Complex', ['radiance', 'age_spot']),
    s('retinal', 'Medik8', 'Crystal Retinal 6', ['texture', 'age_spot']),
    s('caffeine', 'The Ordinary', 'Caffeine Solution 5%', ['dark_circle_v2']),
  ],
}

function g(id: string, brand: string, name: string, hex: string, tags: string[]): Product {
  return { id, aisle: 'glasses', brand, name, hex, colorName: colorName(hex), tags }
}
function j(id: string, brand: string, name: string, hex: string, tags: string[]): Product {
  return { id, aisle: 'jewellery', brand, name, hex, colorName: colorName(hex), tags }
}
function s(id: string, brand: string, name: string, tags: string[]): Product {
  return { id, aisle: 'skincare', brand, name, hex: '#e8e4dd', colorName: 'neutral', tags }
}
