export type GarmentCategory =
  | 'full_body'
  | 'upper_body'
  | 'lower_body'
  | 'shoes'
  | 'outer'
  | 'auto'

export interface Garment {
  id: string
  name: string
  /** Dominant colour, matched against the derived palette. */
  colorName: string
  hex: string
  category: GarmentCategory
  /** Public image URL passed to the VTO API as ref_file_url. */
  url: string
}

/**
 * A small catalog standing in for a retailer's inventory. Each garment carries
 * a colour so the skin-derived palette can rank it — that ranking is the whole
 * point of the app, so colour is a first-class field rather than metadata.
 *
 * Garment images are served from /public so the catalog cannot break on a dead
 * third-party URL. They are flat-lays on white, the shape the VTO engine
 * expects for a reference garment.
 *
 * The VTO API needs a publicly reachable URL for ref_file_url, so these are
 * resolved to absolute URLs at call time (see src/lib/api.ts).
 */
export const GARMENTS: Garment[] = [
  {
    id: 'sage-knit',
    name: 'Sage ribbed knit',
    colorName: 'Sage',
    hex: '#8a9a7b',
    category: 'upper_body',
    url: '/garments/sage-knit.png',
  },
  {
    id: 'petrol-shirt',
    name: 'Petrol overshirt',
    colorName: 'Petrol',
    hex: '#2f5d62',
    category: 'upper_body',
    url: '/garments/petrol-shirt.png',
  },
  {
    id: 'navy-full',
    name: 'Navy tailored set',
    colorName: 'Navy',
    hex: '#26334d',
    category: 'full_body',
    url: '/garments/navy-set.png',
  },
  {
    id: 'camel-coat',
    name: 'Camel wool coat',
    colorName: 'Camel',
    hex: '#b08d57',
    category: 'outer',
    url: '/garments/camel-coat.png',
  },
]

/**
 * Rank garments against the derived palette.
 *
 * Recommended colours surface first with their reasoning attached; flagged
 * colours are kept but marked, because hiding them would make the advice feel
 * arbitrary. Everything else sits in between as neutral.
 */
export function rankGarments(
  garments: Garment[],
  recommended: { name: string; reason: string }[],
  avoid: { name: string; reason: string }[],
): Array<Garment & { verdict: 'recommended' | 'caution' | 'neutral'; reason?: string }> {
  const rec = new Map(recommended.map((c) => [c.name, c.reason]))
  const bad = new Map(avoid.map((c) => [c.name, c.reason]))

  return garments
    .map((g) => {
      if (rec.has(g.colorName)) {
        return { ...g, verdict: 'recommended' as const, reason: rec.get(g.colorName) }
      }
      if (bad.has(g.colorName)) {
        return { ...g, verdict: 'caution' as const, reason: bad.get(g.colorName) }
      }
      return { ...g, verdict: 'neutral' as const }
    })
    .sort((a, b) => rankOf(a.verdict) - rankOf(b.verdict))
}

const rankOf = (v: 'recommended' | 'caution' | 'neutral') =>
  v === 'recommended' ? 0 : v === 'neutral' ? 1 : 2
