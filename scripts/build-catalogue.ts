/**
 * Turns the scraped CSVs in data/ into a committed catalogue module.
 *
 * Run with `bun run catalogue`. data/ is gitignored and only some of it is
 * usable, so the parsed result is committed instead of read at boot: the API
 * then works on a fresh checkout where data/ was never present.
 *
 * The rule inherited from the live feeds holds here too — a row whose colour
 * cannot be resolved is DROPPED, never defaulted. Ranking sorts on that hex,
 * so a guessed colour is worse than a missing product.
 */
import { writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { parseCsv } from '../src/lib/products'
import { colorName } from '../src/lib/color'
import type { Aisle, Audience, Product } from '../src/lib/catalogue'

const OUT = 'src/lib/localCatalogue.ts'

/**
 * Shade words to hex.
 *
 * Cosmetic shade names are their own vocabulary — a foundation is never
 * "navy" — so this is separate from the garment map in catalogue.ts. Kept
 * deliberately narrow for the same reason: every entry is a colour a person
 * would agree on, and anything else resolves to null.
 */
/**
 * Base tones, light to deep. These drive the foundation deltaE match, so they
 * follow a real complexion ramp rather than evenly spaced browns.
 */
const BASE: Record<string, string> = {
  porcelain: '#f0ddcf', fair: '#eed6c4', ivory: '#efe0cd', vanilla: '#f0e2ca',
  milk: '#f2e3d0', light: '#ecd9c2', bare: '#e2c7ae', nude: '#e0c0a4',
  beige: '#e6cbaa', natural: '#e3c6a8', neutral: '#e5cbb0', sand: '#ddc4a1',
  soy: '#c9a882', honey: '#d9ab74', latte: '#cfa87c', tan: '#c69368',
  almond: '#c39a72', caramel: '#c08a58', ginger: '#c07f52', mocha: '#7b5136',
  cocoa: '#6f4a34', brown: '#8b5e3c', choco: '#6b4429', chocolate: '#6b4429',
  espresso: '#4a2f22',
}

/** Lip and cheek colour. */
const COLOUR: Record<string, string> = {
  pink: '#d98a9c', rosy: '#e3b3a6', rose: '#c98a95', peach: '#f0a58a',
  apricot: '#f0a875', coral: '#e07a5f', salmon: '#e08a76', orange: '#d2703a',
  red: '#b03a34', cherry: '#a8202e', brick: '#a4503c', berry: '#8e3a5c',
  fig: '#7a4457', mauve: '#b07b8f', wine: '#6d2436', plum: '#5b2c4e',
  grape: '#6b3b6b', lavender: '#b4a3d1',
}

/** Neutrals, read the same way whichever aisle asked. */
const PLAIN: Record<string, string> = {
  white: '#f5f5f5', cream: '#efe6d2', grey: '#808080', gray: '#808080',
  black: '#1a1a1a',
}

const words = (m: Record<string, string>) =>
  Object.keys(m).sort((a, b) => b.length - a.length)

function look(v: string, map: Record<string, string>): string | null {
  // Longest first, so "choco brown" resolves as choco rather than brown.
  for (const w of words(map)) {
    if (new RegExp(`\\b${w}\\b`).test(v)) return map[w]
  }
  return null
}

/**
 * The same word means different things per aisle: "Honey Rose" on a lip tint
 * is a rose, while "Honey" on a cushion is a complexion depth. So the aisle's
 * own vocabulary is consulted first and the other only as a fallback.
 */
function shadeHex(value: string, aisle: Aisle): string | null {
  const v = value.toLowerCase()
  const first = aisle === 'foundation' ? BASE : COLOUR
  const second = aisle === 'foundation' ? COLOUR : BASE
  return look(v, first) ?? look(v, second) ?? look(v, PLAIN)
}

/**
 * Which aisle a scraped category belongs to, decided by the question that
 * aisle's ranker asks rather than by where a shop files it:
 *   foundation — matched to skin, so anything worn as a base
 *   lipstick / blush — flattered by the palette, so lip and cheek colour
 *   skincare — chosen by measured concern, so treatments and cleansers
 * Eyes, nails, palettes and setting products answer none of those and are
 * left out rather than filed somewhere they would rank meaninglessly.
 */
function aisleOf(path: string): Aisle | null {
  const c = path.toLowerCase()
  if (c.includes('skin care') || c.includes('makeup removers') || c.includes('sun care')) {
    return 'skincare'
  }
  if (c.includes('> lips')) return 'lipstick'
  if (c.includes('cheeks')) return 'blush'
  if (
    c.includes('face > foundation') ||
    c.includes('bb & cc') ||
    c.includes('cushions') ||
    c.includes('concealers')
  ) {
    return 'foundation'
  }
  return null
}

/** Concern keys the skincare ranker scores against, matched on wording. */
const CONCERN_CUES: Array<[string, RegExp]> = [
  ['oiliness', /\b(oil control|sebum|oily|mattif)/i],
  ['pore', /\bpore/i],
  ['moisture', /\b(moistur|hydrat|hyaluronic|dry skin)/i],
  ['redness', /\b(calm|sooth|centella|cica|redness|sensitiv)/i],
  ['acne', /\b(acne|blemish|salicylic|tea tree|breakout)/i],
  ['texture', /\b(exfoliat|texture|\baha\b|\bbha\b|peel|smooth)/i],
  ['radiance', /\b(bright|glow|radian|vitamin c|dull)/i],
  ['dark_circle_v2', /\b(dark circle|eye cream|under.?eye)/i],
  ['age_spot', /\b(spot|melasma|whitening|niacinamide|spf|sunscreen|uv)/i],
]

/**
 * The ranker SUMS the severity of every tag, so a product tagged with all
 * nine concerns beats a focused one on any scan. Marketing copy names every
 * benefit going, so cues are read from the name, category and keyword tags
 * only — never the description — and the result is capped.
 */
const MAX_TAGS = 3

const concernTags = (blob: string): string[] =>
  CONCERN_CUES.filter(([, re]) => re.test(blob))
    .map(([k]) => k)
    .slice(0, MAX_TAGS)

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

/** Rows keyed by header name, with the BOM the scraper left on column one. */
function readCsv(file: string): Array<Record<string, string>> {
  const rows = parseCsv(readFileSync(file, 'utf8'))
  const head = (rows[0] ?? []).map((h) => h.replace(/^﻿/, '').trim())
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {}
    head.forEach((h, i) => (o[h] = (r[i] ?? '').trim()))
    return o
  })
}

/* -- Coverage ----------------------------------------------------------- */

/**
 * Why rows were left behind, counted as we go.
 *
 * A converter that silently keeps 6% of its input reads as though the other
 * 94% never existed. These counts are printed at the end so the shape of the
 * waste is visible and the next scrape can be aimed at it.
 */
const dropped = new Map<string, number>()
const drop = (reason: string) => dropped.set(reason, (dropped.get(reason) ?? 0) + 1)

/* -- Cosmetics ---------------------------------------------------------- */

/** "US$ 11.90" — the scraper left a non-breaking space after the symbol. */
function money(v: string): number | undefined {
  const m = /([\d]+(?:\.[\d]+)?)/.exec(v ?? '')
  return m ? Number(m[1]) || undefined : undefined
}

/**
 * Names on the listing pages are written "Brand - Product - 8 Colors", which
 * is the only place a brand survives on an unscraped row.
 */
const brandOf = (name: string): string | null => {
  const i = name.indexOf(' - ')
  return i > 0 ? name.slice(0, i).trim() || null : null
}
const titleOf = (name: string): string => {
  const i = name.indexOf(' - ')
  return (i > 0 ? name.slice(i + 3) : name).replace(/\s*-\s*\d+\s*(colors?|types?|shades?)\s*$/i, '').trim()
}

/** A listing sold in several shades is makeup, whatever else the words say. */
const MULTI_SHADE = /\d+\s*(colors?|types?|shades?)/i
/** Words that place a product on the face as colour rather than as care. */
const IS_MAKEUP =
  /\b(lip|cheek|blush|cushion|foundation|concealer|shadow|liner|mascara|brow|lash|nail|gloss|tint|palette|contour|highlight|pact|b\.?b|cc)\b/i
/** Words that place it in the skincare aisle. */
const IS_SKIN =
  /\b(cleans|wash|foam|toner|serum|ampoule|essence|moistur|lotion|sunscreen|spf|peel|exfoli|emulsion|mist|patch|soap)\b/i

/**
 * The 5,073 rows the scraper never opened.
 *
 * They carry only a name, a picture and a price — no category, no brand
 * column, no shade. That is fatal for the colour aisles, which rank on a hex
 * nothing here can supply. Skincare is the exception: it ranks on measured
 * concern, so a name is enough, and the brand is recoverable from the
 * listing's own "Brand - Product" convention.
 */
function unscrapedSkincare(rows: Array<Record<string, string>>): Product[] {
  const out: Product[] = []
  const seen = new Set<string>()

  for (const r of rows) {
    const raw = r['Product name']
    if (!raw) {
      drop('unscraped: no name')
      continue
    }
    if (MULTI_SHADE.test(raw) || IS_MAKEUP.test(raw)) {
      drop('unscraped: makeup, and no shade to rank it by')
      continue
    }
    if (!IS_SKIN.test(raw)) {
      drop('unscraped: name names no product type')
      continue
    }
    const brand = brandOf(raw)
    if (!brand) {
      drop('unscraped: no brand in the name')
      continue
    }

    const name = titleOf(raw)
    const id = `csv-skincare-un-${slug(name)}`
    if (seen.has(id)) {
      drop('unscraped: duplicate')
      continue
    }
    seen.add(id)
    out.push({
      id,
      aisle: 'skincare',
      brand,
      name,
      hex: '#e8e4dd',
      colorName: 'neutral',
      price: money(r['price after reduction'] || r['main price']),
      image: r['product picture'] || undefined,
      url: r['product link'] || undefined,
      tags: concernTags(name),
    })
  }
  return out
}

function cosmetics(): Product[] {
  const out: Product[] = []
  const seen = new Set<string>()

  const rows = readCsv('data/cosmetics.csv')

  // Most rows never got past the listing page. Skincare is recoverable from
  // the name alone; the rest is not, and unscrapedSkincare() says why.
  const unscraped = rows.filter((r) => (r['category_path'] || 'not_scraped') === 'not_scraped')
  out.push(...unscrapedSkincare(unscraped))

  for (const r of rows) {
    const path = r['category_path']
    if (!path || path === 'not_scraped') continue

    const aisle = aisleOf(path)
    if (!aisle) {
      drop('category has no aisle whose ranker fits (eyes, nails, palettes)')
      continue
    }

    const name = r['product_full_name'] || r['Product name']
    const brand = r['brand']
    if (!name || !brand) {
      drop('scraped: no name or brand')
      continue
    }

    const price = Number(r['price_ld']) || undefined
    const image = r['main_image'] || r['product picture'] || undefined
    const url = r['product link'] || undefined
    const option = r['option'] ?? ''

    if (aisle === 'skincare') {
      // Never colour-ranked: the ranker reads concern tags, so these carry
      // the same neutral placeholder the committed snapshot rows use.
      const tags = concernTags([name, path, r['tags']].join(' '))
      const id = `csv-skincare-${slug(r['sku'] || name)}`
      if (seen.has(id)) continue
      seen.add(id)
      out.push({
        id, aisle, brand, name,
        hex: '#e8e4dd', colorName: 'neutral',
        price, image, url, tags,
      })
      continue
    }

    // Colour aisles: the shade lives in `option` ("#13 Neutral Ivory"), which
    // also holds sizes ("100ml") for products sold without one. No shade
    // word means no hex, and no hex means the row is dropped.
    // The name is NOT consulted as a fallback here. A colour word in a title
    // is usually the product line ("Mask Fit Red Cushion", bought in #13N),
    // not the shade in the box, and ranking on that is worse than absence.
    const hex = shadeHex(option, aisle)
    if (!hex) {
      drop('colour aisle: no shade word in the option')
      continue
    }

    const id = `csv-${aisle}-${slug(r['sku'] || name)}-${slug(option)}`
    if (seen.has(id)) {
      drop('scraped: duplicate')
      continue
    }
    seen.add(id)
    out.push({
      id, aisle, brand, name,
      hex, colorName: colorName(hex),
      shadeName: option.replace(/\s*-\s*[\d.]+\s*(ml|g)\b.*$/i, '').trim() || undefined,
      price, image, url,
    })
  }
  return out
}

/* -- Clothes ------------------------------------------------------------ */

/** Garment colour words, matched against the title. */
const GARMENT: Record<string, string> = {
  black: '#1a1a1a', white: '#f5f5f5', ivory: '#efe6d2', cream: '#efe6d2',
  grey: '#808080', gray: '#808080', charcoal: '#36383d', navy: '#26334d',
  blue: '#2f5d8f', teal: '#2f5d62', green: '#3f6b4a', olive: '#6b6b3a',
  sage: '#8a9a7b', forest: '#2f4230', red: '#a8322d', burgundy: '#6b2532',
  rust: '#8c3f23', orange: '#c96a2b', coral: '#e07a5f', pink: '#d98a9c',
  rose: '#c98a95', purple: '#5b3a6b', plum: '#5b2c4e', brown: '#6b4a35',
  tan: '#b08d57', camel: '#b08d57', beige: '#d9c9b0', khaki: '#8a7d5c',
  mustard: '#c9a227', yellow: '#d9c04a', gold: '#c9a227', silver: '#c0c0c0',
  stone: '#a8a196', sand: '#d9c9b0',
}
const GARMENT_WORDS = Object.keys(GARMENT).sort((a, b) => b.length - a.length)

function clothes(): Product[] {
  const out: Product[] = []
  const seen = new Set<string>()

  for (const r of readCsv('data/clothes.csv')) {
    const name = r['product_name']
    if (!name) {
      drop('clothes: no name')
      continue
    }

    // This feed's colors_available column is empty on every row, so the only
    // colour on offer is the one merchandising wrote into the title
    // ("Womens Nike Gray Detroit Lions..."). Titles without one are dropped.
    const word = GARMENT_WORDS.find((w) => new RegExp(`\\b${w}\\b`, 'i').test(name))
    if (!word) {
      drop('clothes: no colour word in the title (colors_available is empty on every row)')
      continue
    }
    const hex = GARMENT[word]

    const g = r['gender']?.toLowerCase()
    const audience: Audience | undefined =
      g === 'women' ? 'women' : g === 'men' ? 'men' : undefined

    const id = `csv-clothes-${slug(r['product_id'] || name)}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      aisle: 'clothes',
      // The scrape carries no brand column; the retailer is the only name
      // attributable to the row, so it stands in rather than an empty label.
      brand: 'Nordstrom',
      name,
      audience,
      hex,
      colorName: colorName(hex),
      shadeName: word[0].toUpperCase() + word.slice(1),
      image: r['main_image'] || undefined,
      url: r['product_url'] || undefined,
    })
  }
  return out
}

/* -- Emit --------------------------------------------------------------- */

const all = [...cosmetics(), ...clothes()]
const byAisle: Record<string, Product[]> = {}
for (const p of all) (byAisle[p.aisle] ??= []).push(p)

const counts = Object.entries(byAisle)
  .map(([a, rows]) => `${a} ${rows.length}`)
  .join(', ')

const body = `/**
 * GENERATED by scripts/build-catalogue.ts — do not edit by hand.
 *
 * A committed slice of the scraped CSVs in data/, which is gitignored: this
 * keeps the shelves stocked on a checkout that never had the raw files.
 * Regenerate with \`bun run catalogue\`.
 *
 * Rows: ${counts}.
 */
import type { Aisle, Product } from './catalogue'

export const LOCAL: Partial<Record<Aisle, Product[]>> = ${JSON.stringify(byAisle, null, 2)}

/** Committed rows for one aisle, or nothing if that aisle has none. */
export const localFor = (aisle: Aisle): Product[] => LOCAL[aisle] ?? []
`

await writeFile(OUT, body)

console.log(`${OUT}: ${all.length} products (${counts})\n`)
console.log('Left behind:')
const lost = [...dropped.entries()].sort((a, b) => b[1] - a[1])
for (const [reason, n] of lost) console.log(`  ${String(n).padStart(5)}  ${reason}`)
const total = all.length + lost.reduce((a, [, n]) => a + n, 0)
console.log(`\n  ${all.length} of ${total} rows kept.`)
