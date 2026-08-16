import { depthOf, undertoneOf, type Undertone } from './color'

/**
 * The idea the product is built on: skin CONCERNS set the foundation FORMULA
 * while skin COLOUR sets the SHADE. The same matched colour comes out matte on
 * oily skin and dewy on dry. The diagnosis changes the product, not the caption.
 */

/** One concern row as returned by skin-analysis. */
export interface ConcernRow {
  type: string
  ui_score: number
  raw_score: number
  mask_urls?: string[]
}

/**
 * Severity 0-1, where 1 is the most pronounced.
 *
 * YouCam scores HEALTH: a low oiliness score means oily skin. The inversion
 * happens exactly once, here. Getting it backwards prescribes the precise
 * opposite formula and still reads plausible, so it must not be repeated
 * anywhere downstream.
 */
export function severityOf(rows: ConcernRow[], type: string): number | null {
  const row = rows.find((r) => r.type === type)
  if (!row) return null
  return Math.max(0, Math.min(1, (100 - row.raw_score) / 100))
}

export interface Formula {
  glowIntensity: number
  coverageIntensity: number
  colorUnderEyeIntensity: number
  finish: 'matte' | 'natural' | 'dewy'
  /** Every claim traces to a measurement. Empty when nothing was measured. */
  because: string[]
}

/** Concerns that drive the formula, in the SD set (HD cannot be mixed with SD). */
export const FORMULA_CONCERNS = [
  'oiliness',
  'moisture',
  'redness',
  'acne',
  'texture',
  'pore',
  'dark_circle_v2',
] as const

const LABEL: Record<string, string> = {
  oiliness: 'oiliness',
  moisture: 'dryness',
  redness: 'redness',
  acne: 'blemishes',
  texture: 'texture',
  pore: 'visible pores',
  dark_circle_v2: 'under-eye shadow',
}

/**
 * Turn concerns into a formula.
 *
 * A missing concern contributes nothing rather than a neutral default, so a
 * reading we never took cannot cancel out one we did. It must also never
 * produce a SENTENCE: "for the redness we found" when no redness was measured
 * is an invented finding, and the whole pitch is that every claim traces to
 * something read off her face.
 */
export function formulaFor(rows: ConcernRow[]): Formula {
  const measured = (type: string) => severityOf(rows, type)

  const oily = measured('oiliness')
  const dry = measured('moisture')
  const red = measured('redness')
  const acne = measured('acne')
  const texture = measured('texture')
  const pore = measured('pore')
  const dark = measured('dark_circle_v2')

  const because: string[] = []

  // Glow: oily skin wants less, dry skin wants more.
  //
  // Only MEASURED signals move this. Substituting a neutral 0.5 for an absent
  // concern lets a reading we never took cancel out one we did: with dryness
  // alone, a defaulted oiliness pulled a dewy face back to "natural".
  const glow = clamp(
    0.5 - (oily ?? 0) * 0.45 + (dry ?? 0) * 0.45,
  )
  if (oily !== null && oily > 0.35) {
    because.push(`Matte finish, because your skin reads oily (${pct(oily)}).`)
  } else if (dry !== null && dry > 0.35) {
    because.push(`Extra glow, because your skin reads dry (${pct(dry)}).`)
  }

  // Coverage: redness, blemishes and texture all ask for more.
  const coverSignals = [red, acne, texture, pore].filter(
    (v): v is number => v !== null,
  )
  const coverage = coverSignals.length
    ? clamp(0.25 + Math.max(...coverSignals) * 0.7)
    : 0.5
  const worst = pickWorst({ redness: red, acne, texture, pore })
  if (worst) {
    because.push(
      `${coverage > 0.6 ? 'Fuller' : 'Light'} coverage, because ${LABEL[worst.type]} is your most pronounced reading (${pct(worst.value)}).`,
    )
  }

  // Under-eye colour correction tracks dark circles only.
  const underEye = dark === null ? 0.35 : clamp(0.2 + dark * 0.75)
  if (dark !== null && dark > 0.4) {
    because.push(`Under-eye correction, because shadow reads ${pct(dark)}.`)
  }

  return {
    glowIntensity: round(glow),
    coverageIntensity: round(coverage),
    colorUnderEyeIntensity: round(underEye),
    finish: glow < 0.35 ? 'matte' : glow > 0.58 ? 'dewy' : 'natural',
    because,
  }
}

const clamp = (v: number) => Math.max(0, Math.min(1, v))
const round = (v: number) => Math.round(v * 100) / 100
const pct = (v: number) => `${Math.round(v * 100)}%`

function pickWorst(map: Record<string, number | null>) {
  let best: { type: string; value: number } | null = null
  for (const [type, value] of Object.entries(map)) {
    if (value === null) continue
    if (!best || value > best.value) best = { type, value }
  }
  return best && best.value > 0.15 ? best : null
}

/* -- Palette ------------------------------------------------------------ */

export interface Swatch {
  name: string
  hex: string
}

export interface Palette {
  season: string
  undertone: Undertone
  depth: number
  swatches: Swatch[]
  reason: string
}

const WARM_LIGHT: Swatch[] = [
  { name: 'Camel', hex: '#b08d57' },
  { name: 'Cream', hex: '#efe6d2' },
  { name: 'Coral', hex: '#e07a5f' },
  { name: 'Olive', hex: '#6b6b3a' },
]
const WARM_DEEP: Swatch[] = [
  { name: 'Rust', hex: '#8c3f23' },
  { name: 'Bronze', hex: '#7d5621' },
  { name: 'Forest', hex: '#2f4230' },
  { name: 'Gold', hex: '#c9a227' },
]
const COOL_LIGHT: Swatch[] = [
  { name: 'Soft white', hex: '#f2f3f5' },
  { name: 'Slate blue', hex: '#4a5d7e' },
  { name: 'Rose', hex: '#c98a95' },
  { name: 'Sage', hex: '#8a9a7b' },
]
const COOL_DEEP: Swatch[] = [
  { name: 'Navy', hex: '#26334d' },
  { name: 'Plum', hex: '#5b2c4e' },
  { name: 'Emerald', hex: '#1f4d38' },
  { name: 'Charcoal', hex: '#36383d' },
]
const NEUTRAL: Swatch[] = [
  { name: 'Stone', hex: '#a8a196' },
  { name: 'Petrol', hex: '#2f5d62' },
  { name: 'Soft white', hex: '#f2f3f5' },
  { name: 'Terracotta', hex: '#b5654a' },
]

export function paletteFor(skinHex: string): Palette {
  const undertone = undertoneOf(skinHex)
  const depth = depthOf(skinHex)
  const deep = depth <= 3

  const swatches =
    undertone === 'warm'
      ? deep
        ? WARM_DEEP
        : WARM_LIGHT
      : undertone === 'cool'
        ? deep
          ? COOL_DEEP
          : COOL_LIGHT
        : NEUTRAL

  const season =
    undertone === 'warm'
      ? deep
        ? 'Deep Autumn'
        : 'Warm Spring'
      : undertone === 'cool'
        ? deep
          ? 'Deep Winter'
          : 'Cool Summer'
        : 'True Neutral'

  const reason =
    undertone === 'neutral'
      ? `Your skin measured ${skinHex} with balanced warmth, so both warm and cool anchors work.`
      : `Your skin measured ${skinHex}, which reads ${undertone}. These sit with that rather than fighting it.`

  return { season, undertone, depth, swatches, reason }
}
