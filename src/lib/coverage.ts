import { deltaE, depthOf, hexToLab, labToRgb, rgbToHex, type Lab } from './color'
import type { Product } from './catalogue'
import { formulaFor, type ConcernRow, type Formula } from './prescription'
import { blushOn, readsChalky, type BlushOn } from './rank'

/**
 * Coverage: the catalogue measured against everyone.
 *
 * The rest of the app asks one question per shopper — what here suits this
 * face. A brand needs the inverse: across every face, who does this range
 * fail? Asked one shopper at a time it can never be answered, because the
 * shoppers a range fails are the ones who leave without buying, so they never
 * appear in its sales or its returns.
 *
 * The audit is the shopper-side logic run across a fixed panel, so it can only
 * report gaps a shopper would actually hit. It has two halves, matching the
 * idea the product is built on: colour picks the shade, condition picks the
 * formula. A range can cover every tone and still fail half of them on finish,
 * and no shade-count marketing ("40 shades") will ever show that.
 */

export type Finish = Formula['finish']
export const FINISHES: Finish[] = ['matte', 'natural', 'dewy']

/* -- The panel ------------------------------------------------------------ */

/**
 * The Monk Skin Tone Scale: ten tones, lightest to deepest.
 *
 * Developed by Dr. Ellis Monk (2019) and released openly by Google in 2022
 * under CC BY 4.0 for exactly this job — checking whether a system works
 * across skin tones. The hexes are the scale's published reference colours,
 * checked against skintone.google. Chosen
 * over Fitzpatrick because Fitzpatrick was built to predict sunburn and
 * compresses deep skin into two of its six types, which is where ranges fail.
 */
export const MONK: Array<{ tone: number; hex: string }> = [
  { tone: 1, hex: '#f6ede4' },
  { tone: 2, hex: '#f3e7db' },
  { tone: 3, hex: '#f7ead0' },
  { tone: 4, hex: '#eadaba' },
  { tone: 5, hex: '#d7bd96' },
  { tone: 6, hex: '#a07e56' },
  { tone: 7, hex: '#825c43' },
  { tone: 8, hex: '#604134' },
  { tone: 9, hex: '#3a312a' },
  { tone: 10, hex: '#292420' },
]

export type SkinType = 'oily' | 'balanced' | 'dry'
export const SKIN_TYPES: SkinType[] = ['oily', 'balanced', 'dry']

/**
 * Concern rows that make formulaFor prescribe each skin type's finish.
 *
 * One pronounced concern, or none. The panel runs the REAL prescription rather
 * than a parallel table saying "oily needs matte", or the audit could disagree
 * with what the same app tells a shopper with that skin.
 */
const CONDITION: Record<SkinType, ConcernRow[]> = {
  oily: [{ type: 'oiliness', ui_score: 30, raw_score: 30 }],
  balanced: [],
  dry: [{ type: 'moisture', ui_score: 30, raw_score: 30 }],
}

/** Under 5 ΔE is a match in most light — the line the shopper side draws too. */
export const MATCH_DE = 5

/**
 * The scale as a continuum, not ten swatches.
 *
 * Monk's tones are illustrations, unevenly spaced: tone 5 sits near L* 78 and
 * tone 6 near L* 55, and real measured skin lives in that gap — the demo scans
 * in the README read #b29077 and #937057, both between them. Scored at the ten
 * anchors only, a range dense in exactly that gap "missed" both tones. So
 * points are laid between neighbours, close enough that no colour on the line
 * is more than half a match from one.
 */
const STEP = MATCH_DE * 0.8

export interface Rung {
  /** Position on the Monk scale, 1-10, fractional between anchors. */
  at: number
  hex: string
  lab: Lab
}

export const LADDER: Rung[] = (() => {
  const out: Rung[] = []
  for (let i = 0; i < MONK.length - 1; i++) {
    const a = hexToLab(MONK[i].hex)
    const b = hexToLab(MONK[i + 1].hex)
    const steps = Math.max(1, Math.ceil(deltaE(a, b) / STEP))
    for (let k = 0; k < steps; k++) {
      const t = k / steps
      const lab = { L: a.L + (b.L - a.L) * t, a: a.a + (b.a - a.a) * t, b: a.b + (b.b - a.b) * t }
      // Anchors keep Monk's published hex rather than a round trip through Lab.
      out.push({ at: round2(MONK[i].tone + t), hex: k === 0 ? MONK[i].hex : rgbToHex(labToRgb(lab)), lab })
    }
  }
  const last = MONK.at(-1)!
  out.push({ at: last.tone, hex: last.hex, lab: hexToLab(last.hex) })
  return out
})()

/**
 * Where a measured colour sits against the scale: its nearest rung, and how far
 * off the line it is.
 *
 * Real skin does not lie on Monk's line. Measured mid-depth skin sits near hue
 * 62–65° while the published tones 5–6 sit near 74–81°, so a real face can be
 * 8 ΔE from the scale at its own depth. The panel audits the reference; this
 * says how far a real face is from it, which is why real scans are placed on
 * their own rather than snapped to a rung.
 */
export function nearestRung(hex: string): { at: number; hex: string; dE: number } {
  const lab = hexToLab(hex)
  let best = LADDER[0]
  let dist = Infinity
  for (const r of LADDER) {
    const d = deltaE(lab, r.lab)
    if (d < dist) {
      dist = d
      best = r
    }
  }
  return { at: best.at, hex: best.hex, dE: Math.round(dist * 10) / 10 }
}

export interface Seat {
  at: number
  hex: string
  skin: SkinType
  need: Finish
}

/** Every rung of the scale, once per skin type. */
export const PANEL: Seat[] = LADDER.flatMap((r) =>
  SKIN_TYPES.map((skin) => ({ at: r.at, hex: r.hex, skin, need: formulaFor(CONDITION[skin]).finish })),
)

/* -- Reading a product's finish ------------------------------------------ */

/**
 * Finish words, strongest evidence first.
 *
 * "Semi-matte" and "satin" are checked, and removed, before "matte" is looked
 * for: otherwise every semi-matte base reads as matte, which is the finish a
 * dry-skin shopper is most often told to avoid.
 */
const NATURAL_TEST = /\b(semi[- ]?matte|demi[- ]?matte|satin|natural[- ]finish|second[- ]skin|skin[- ]like)\b/i
const NATURAL_STRIP = new RegExp(NATURAL_TEST.source, 'gi')
const MATTE_WORDS = /\b(matte|mattifying|mattify|matifying|velvet)\b/i
const DEWY_WORDS = /\b(dewy|luminous|luminizing|radiant|radiance|glow|glowy|glowing|illuminating|skin tint|serum)\b/i

/** Weaker: what the product does rather than what it looks like. */
const MATTE_HINTS = /\b(oil[- ]?free|oil[- ]control|shine[- ]control|poreless|blurring)\b/i
const DEWY_HINTS = /\b(hydrating|moisturi[sz]ing|hyaluronic|nourishing)\b/i

export type FinishSource = 'declared' | 'name' | 'description' | 'hint' | 'none'

export interface FinishRead {
  finish: Finish | null
  source: FinishSource
}

function finishWords(text: string): Finish | 'mixed' | null {
  const natural = NATURAL_TEST.test(text)
  const rest = text.replace(NATURAL_STRIP, ' ')
  const hits = [
    natural ? 'natural' : null,
    MATTE_WORDS.test(rest) ? 'matte' : null,
    DEWY_WORDS.test(rest) ? 'dewy' : null,
  ].filter((h): h is Finish => h !== null)
  if (hits.length === 1) return hits[0]
  return hits.length ? 'mixed' : null
}

/**
 * What finish a product is, and how we know.
 *
 * A merchant's own declaration wins outright. After that the NAME, because it
 * is what the brand chose to say about the product; a description often lists
 * every finish it can be "built up" to. A product that says nothing readable
 * stays unknown — guessing would let the audit report a range as covered on
 * evidence nobody published, which is the failure it exists to catch.
 */
export function finishOf(p: Pick<Product, 'name' | 'tags'> & { finish?: Finish }): FinishRead {
  if (p.finish && FINISHES.includes(p.finish)) return { finish: p.finish, source: 'declared' }

  const fromName = finishWords(p.name)
  if (fromName && fromName !== 'mixed') return { finish: fromName, source: 'name' }

  const desc = (p.tags ?? []).join(' ')
  const fromDesc = finishWords(desc)
  if (fromDesc && fromDesc !== 'mixed') return { finish: fromDesc, source: 'description' }

  const all = `${p.name} ${desc}`
  const matte = MATTE_HINTS.test(all)
  const dewy = DEWY_HINTS.test(all)
  if (matte !== dewy) return { finish: matte ? 'matte' : 'dewy', source: 'hint' }

  return { finish: null, source: 'none' }
}

/**
 * Bases, not everything filed under foundation.
 *
 * The public feed files setting powders, concealers and primers as
 * "foundation". None of them is the product a shopper matches to her face, and
 * a translucent powder would "cover" the lightest tones on paper.
 */
const BASE_WORDS = /\b(foundation|skin tint|tint|bb|cc)\b/i
const NOT_BASE = /\b(powder|concealer|corrector|correcting|primer|palette|blotting|setting|contour|highlight\w*|bronzer|blush)\b/i

export const isBase = (p: Pick<Product, 'aisle' | 'name'>): boolean =>
  p.aisle === 'foundation' && (BASE_WORDS.test(p.name) || !NOT_BASE.test(p.name))

/* -- Placing one face ------------------------------------------------------ */

export type Verdict = 'served' | 'wrong-finish' | 'finish-unstated' | 'no-shade'

export interface ShadeRef {
  id: string
  brand: string
  name: string
  shadeName?: string
  hex: string
  finish: Finish | null
  image?: string
  url?: string
}

export interface Placement {
  verdict: Verdict
  /** Nearest base at any finish. Null only when the range has no bases. */
  closest: (ShadeRef & { dE: number }) | null
  /** Nearest base in the finish this skin needs, however far away. */
  closestInFinish: (ShadeRef & { dE: number }) | null
  /** Bases within MATCH_DE, counted by finish. */
  matches: Record<Finish | 'unstated', number>
}

interface Shade {
  ref: ShadeRef
  lab: Lab
}

function toShades(products: Product[]): Shade[] {
  return products.filter(isBase).map((p) => ({
    lab: hexToLab(p.hex),
    ref: {
      id: p.id,
      brand: p.brand,
      name: p.name,
      shadeName: p.shadeName,
      hex: p.hex,
      finish: finishOf(p).finish,
      image: p.image,
      url: p.url,
    },
  }))
}

/**
 * Where one face lands in a range: is there a shade, and is it the formula.
 *
 * A match whose finish is unstated is NOT counted as a miss. It may well suit
 * her; nobody said. That gets its own verdict, because "wrong finish" is a
 * claim about the product and "unstated" is a claim about the listing.
 */
function place(shades: Shade[], skinHex: string, need: Finish): Placement {
  const target = hexToLab(skinHex)
  let closest: Placement['closest'] = null
  let closestInFinish: Placement['closestInFinish'] = null
  const matches: Placement['matches'] = { matte: 0, natural: 0, dewy: 0, unstated: 0 }

  for (const s of shades) {
    const dE = deltaE(target, s.lab)
    if (!closest || dE < closest.dE) closest = { ...s.ref, dE }
    if (s.ref.finish === need && (!closestInFinish || dE < closestInFinish.dE)) {
      closestInFinish = { ...s.ref, dE }
    }
    if (dE < MATCH_DE) matches[s.ref.finish ?? 'unstated'] += 1
  }

  const verdict: Verdict =
    !closest || closest.dE >= MATCH_DE
      ? 'no-shade'
      : matches[need] > 0
        ? 'served'
        : matches.unstated > 0
          ? 'finish-unstated'
          : 'wrong-finish'

  return { verdict, closest, closestInFinish, matches }
}

/** One real face, placed exactly as a panel seat would be. */
export function placeFace(products: Product[], skinHex: string, concerns: ConcernRow[]): Placement & { need: Finish } {
  const need = formulaFor(concerns).finish
  return { ...place(toShades(products), skinHex, need), need }
}

/* -- The audit -------------------------------------------------------------- */

export interface Cell extends Seat, Placement {}

export interface ToneRow {
  tone: number
  hex: string
  /** Bases whose nearest Monk anchor is this tone. */
  shades: number
  closest: Placement['closest']
  blush: Record<BlushOn, number>
  /** Pale low-pigment lipsticks that read grey here. Zero above depth 3. */
  chalkyLips: number
}

export interface Finding {
  kind: 'gap' | 'warn' | 'good'
  title: string
  body: string
  /** What to stock or change. Every gap carries one. */
  action?: string
  /** Swatches for the action: where on the scale it is needed. */
  hexes?: string[]
}

export interface Audit {
  catalogue: {
    base: number
    /** Filed as foundation but not a base: powders, concealers, primers. */
    setAside: number
    blush: number
    lipstick: number
    brands: number
  }
  finishes: Record<Finish | 'unstated', number> & { declared: number; inferred: number }
  /** Share of the scale with a shade within MATCH_DE, at any finish. */
  shadeCoverage: number
  /** Share of the scale served in the finish each skin type is prescribed. */
  formulaCoverage: Record<SkinType, number>
  served: number
  seats: number
  cells: Cell[]
  tones: ToneRow[]
  /** Where the range's bases actually sit: per rung, how many, by finish. */
  range: RangeRung[]
  findings: Finding[]
}

export type RangeRung = { at: number; hex: string } & Record<Finish | 'unstated', number>

/** Each base, counted at the rung it sits nearest. */
function rangeOf(shades: Shade[]): RangeRung[] {
  const rows: RangeRung[] = LADDER.map((r) => ({ at: r.at, hex: r.hex, matte: 0, natural: 0, dewy: 0, unstated: 0 }))
  for (const s of shades) {
    let best = 0
    for (let i = 1; i < LADDER.length; i++) {
      if (deltaE(s.lab, LADDER[i].lab) < deltaE(s.lab, LADDER[best].lab)) best = i
    }
    rows[best][s.ref.finish ?? 'unstated'] += 1
  }
  return rows
}

/**
 * Audit a range.
 *
 * Deterministic and model-free on purpose: a merchant acts on this by buying
 * stock, so every sentence is computed from the same colour maths the shopper
 * side ranks with, and names the number behind it.
 */
export function audit(products: Product[]): Audit {
  const shades = toShades(products)
  const foundationRows = products.filter((p) => p.aisle === 'foundation')
  const blushes = products.filter((p) => p.aisle === 'blush')
  const lipsticks = products.filter((p) => p.aisle === 'lipstick')

  const cells: Cell[] = PANEL.map((seat) => ({ ...seat, ...place(shades, seat.hex, seat.need) }))
  // Shade facts do not depend on skin type, so one row of the panel carries them.
  const rungs = cells.filter((c) => c.skin === 'balanced')

  // Which anchor each shade sits nearest, so a range reads as a distribution
  // rather than a shade count.
  const perTone = new Map<number, number>()
  const anchors = MONK.map((m) => ({ ...m, lab: hexToLab(m.hex) }))
  for (const s of shades) {
    let best = anchors[0]
    for (const m of anchors) if (deltaE(s.lab, m.lab) < deltaE(s.lab, best.lab)) best = m
    perTone.set(best.tone, (perTone.get(best.tone) ?? 0) + 1)
  }

  const tones: ToneRow[] = MONK.map((m) => {
    const blush: Record<BlushOn, number> = { flush: 0, vanishes: 0, 'sits-on-top': 0, 'not-a-blush': 0 }
    for (const b of blushes) blush[blushOn(b.hex, m.hex)] += 1
    const depth = depthOf(m.hex)
    return {
      tone: m.tone,
      hex: m.hex,
      shades: perTone.get(m.tone) ?? 0,
      closest: rungs.find((c) => c.at === m.tone)?.closest ?? null,
      blush,
      chalkyLips: lipsticks.filter((l) => readsChalky(l.hex, depth)).length,
    }
  })

  const finishes = { matte: 0, natural: 0, dewy: 0, unstated: 0, declared: 0, inferred: 0 }
  for (const p of foundationRows.filter(isBase)) {
    const read = finishOf(p)
    finishes[read.finish ?? 'unstated'] += 1
    if (read.source === 'declared') finishes.declared += 1
    else if (read.finish) finishes.inferred += 1
  }

  const shadeCoverage = rungs.filter((c) => c.verdict !== 'no-shade').length / rungs.length
  const formulaCoverage = Object.fromEntries(
    SKIN_TYPES.map((skin) => {
      const row = cells.filter((c) => c.skin === skin)
      return [skin, row.filter((c) => c.verdict === 'served').length / row.length]
    }),
  ) as Record<SkinType, number>

  return {
    catalogue: {
      base: shades.length,
      setAside: foundationRows.length - shades.length,
      blush: blushes.length,
      lipstick: lipsticks.length,
      brands: new Set(products.map((p) => p.brand.toLowerCase())).size,
    },
    finishes,
    shadeCoverage: round2(shadeCoverage),
    formulaCoverage: Object.fromEntries(
      Object.entries(formulaCoverage).map(([k, v]) => [k, round2(v)]),
    ) as Record<SkinType, number>,
    served: cells.filter((c) => c.verdict === 'served').length,
    seats: cells.length,
    cells,
    tones,
    range: rangeOf(shades),
    findings: findingsFor(cells, rungs, tones, finishes, shades.length, blushes.length, lipsticks.length, shadeCoverage),
  }
}

/* -- What to stock next ------------------------------------------------------ */

export interface Addition {
  rank: number
  /** The shade to add: a point on the scale. */
  hex: string
  at: number
  finish: Finish
  /** The range's own line in this finish to extend, or null for a new formula. */
  extend: string | null
  /** Panel points it gives their shade AND finish, after the additions above it. */
  seats: number
  /** Panel points that had no shade at all and now get one, in another finish. */
  shadeOnly: number
  /** Real scanned shoppers, unserved today, it would have given their match. */
  shoppers: number
  /** Where on the scale it helps, in words. */
  where: string
  /** Skin types it gives a full match. */
  skins: SkinType[]
  /** Formula coverage per skin type once this and those above it are stocked. */
  after: Record<SkinType, number>
  /** Shade coverage (any finish) once this and those above it are stocked. */
  afterShade: number
}

/**
 * The next products to make, ranked by how many faces each one serves.
 *
 * A list of gaps tells a buyer where the range fails; this answers the
 * question they actually have — "I can add three products; which?" Greedy, so
 * each pick is scored on what is still unserved after the ones above it: the
 * second recommendation never re-counts faces the first already fixed.
 *
 * Candidates are every point on the scale in every finish. A face that gets
 * its shade and its prescribed finish counts 1. A face that had NO shade within
 * MATCH_DE and now gets one, in another finish, counts 1/2: better than
 * nothing, not the answer. Without that half, every candidate serves about the
 * same handful of points and ties went to the lightest — recommending a second
 * light formula before any shade at all for skin the range ignores entirely.
 * Real scanned shoppers count the same way as panel points.
 */
/** Which skin type each finish is prescribed for, read off the panel itself. */
const SKIN_FOR = Object.fromEntries(PANEL.map((s) => [s.need, s.skin])) as Record<Finish, SkinType>

export function nextAdditions(products: Product[], demand: Demand[] = [], count = 3): Addition[] {
  const shades = toShades(products)
  const cells = PANEL.map((seat) => ({ ...seat, ...place(shades, seat.hex, seat.need) }))
  const cellLab = cells.map((c) => LADDER[INDEX.get(c.at)!].lab)
  const open = new Set(cells.flatMap((c, i) => (c.verdict === 'served' ? [] : [i])))
  const shadeless = new Set(cells.flatMap((c, i) => (c.verdict === 'no-shade' ? [i] : [])))

  const demandLab = demand.map((d) => hexToLab(d.skinHex))
  const placed = demand.map((d) => place(shades, d.skinHex, d.finish).verdict)
  const demandOpen = new Set(placed.flatMap((v, j) => (v === 'served' ? [] : [j])))
  const demandShadeless = new Set(placed.flatMap((v, j) => (v === 'no-shade' ? [j] : [])))

  const servedBy: Record<SkinType, number> = { oily: 0, balanced: 0, dry: 0 }
  for (const c of cells) if (c.verdict === 'served') servedBy[c.skin] += 1
  const perSkin = LADDER.length
  const rungShade = new Set(cells.flatMap((c) => (c.verdict === 'no-shade' ? [] : [c.at])))

  const out: Addition[] = []
  for (let rank = 1; rank <= count; rank++) {
    type Pick = { rung: Rung; finish: Finish; full: number[]; half: number[]; shoppers: number[]; shopHalf: number[]; score: number }
    let best: Pick | null = null
    for (const rung of LADDER) {
      for (const finish of FINISHES) {
        const near = (lab: Lab) => deltaE(rung.lab, lab) < MATCH_DE
        const full = [...open].filter((i) => cells[i].need === finish && near(cellLab[i]))
        const half = [...shadeless].filter((i) => cells[i].need !== finish && near(cellLab[i]))
        const shoppers = [...demandOpen].filter((j) => demand[j].finish === finish && near(demandLab[j]))
        const shopHalf = [...demandShadeless].filter((j) => demand[j].finish !== finish && near(demandLab[j]))
        const score = full.length + shoppers.length + (half.length + shopHalf.length) / 2
        // A tie goes to the finish whose skin type is worst served right now,
        // so equal picks spread across formulas instead of stacking one.
        const better =
          !best ||
          score > best.score ||
          (score === best.score && servedBy[SKIN_FOR[finish]] < servedBy[SKIN_FOR[best.finish]])
        if (score > 0 && better) best = { rung, finish, full, half, shoppers, shopHalf, score }
      }
    }
    if (!best) break

    for (const i of best.full) {
      open.delete(i)
      shadeless.delete(i)
      servedBy[cells[i].skin] += 1
      rungShade.add(cells[i].at)
    }
    for (const i of best.half) {
      shadeless.delete(i)
      rungShade.add(cells[i].at)
    }
    for (const j of best.shoppers) {
      demandOpen.delete(j)
      demandShadeless.delete(j)
    }
    for (const j of best.shopHalf) demandShadeless.delete(j)

    const helped = [...best.full, ...best.half].map((i) => cells[i]).sort((a, b) => a.at - b.at)
    out.push({
      rank,
      hex: best.rung.hex,
      at: best.rung.at,
      finish: best.finish,
      extend: lineToExtend(shades, best.rung.lab, best.finish),
      seats: best.full.length,
      shadeOnly: best.half.length,
      shoppers: best.shoppers.length,
      where: spanWord(helped.length ? helped : [best.rung]),
      skins: [...new Set(best.full.map((i) => cells[i].skin))],
      after: {
        oily: round2(servedBy.oily / perSkin),
        balanced: round2(servedBy.balanced / perSkin),
        dry: round2(servedBy.dry / perSkin),
      },
      afterShade: round2(rungShade.size / perSkin),
    })
  }
  return out
}

/**
 * The range's own line in this finish whose shades come nearest — extending a
 * formula the brand already makes is a cheaper ask than launching one.
 */
function lineToExtend(shades: Shade[], target: Lab, finish: Finish): string | null {
  let best: { name: string; dE: number } | null = null
  for (const s of shades) {
    if (s.ref.finish !== finish) continue
    const dE = deltaE(target, s.lab)
    if (!best || dE < best.dE) best = { name: s.ref.name, dE }
  }
  return best?.name ?? null
}

/* -- Findings ----------------------------------------------------------------- */

const SKIN_WORD: Record<SkinType, string> = { oily: 'Oily', balanced: 'Balanced', dry: 'Dry' }

/**
 * The report, in sentences a merchandiser can act on.
 *
 * Gaps first: a report that opens with praise reads as a sales pitch, and this
 * one is meant to send someone to a supplier. Every finding names where on the
 * scale and the measurement behind it, and every gap names what to stock.
 */
function findingsFor(
  cells: Cell[],
  rungs: Cell[],
  tones: ToneRow[],
  finishes: Audit['finishes'],
  baseCount: number,
  blushCount: number,
  lipCount: number,
  shadeCoverage: number,
): Finding[] {
  const out: Finding[] = []

  if (baseCount === 0) {
    out.push({
      kind: 'gap',
      title: 'No foundation to audit',
      body: 'Nothing in this catalogue is a base product, so no shopper can be matched to a shade.',
      action: 'Add foundations with a hex per shade, and check the aisle column says foundation.',
    })
  }

  // 1. Shade gaps: stretches of the scale with no base within MATCH_DE.
  for (const run of stretches(rungs.filter((c) => c.verdict === 'no-shade' && c.closest))) {
    const worst = run.reduce((a, b) => (b.closest!.dE > a.closest!.dE ? b : a))
    const share = run.length / rungs.length
    out.push({
      kind: 'gap',
      title: `No shade ${spanWord(run)}`,
      body: `Nothing in the range comes within ${MATCH_DE} ΔE of this part of the scale — ${pct(share)} of it. At its worst point (${worst.hex}) the closest base is ${shadeWord(worst.closest!)}, ${worst.closest!.dE.toFixed(1)} ΔE away: ${worst.closest!.dE >= 10 ? 'a visibly different colour on the face' : 'wearable in some light, but not a match'}. Every skin type here leaves without a foundation.`,
      action: `Stock ${run.length > 1 ? 'shades' : 'a shade'} near ${sample(run).map((c) => c.hex).join(', ')}.`,
      hexes: sample(run).map((c) => c.hex),
    })
  }

  // 2. Formula gaps: the shade exists, the finish this skin needs does not.
  // One finding per skin type, however many stretches: the fix is one product
  // line in that finish, not one per stretch.
  for (const skin of SKIN_TYPES) {
    const missed = cells.filter((c) => c.skin === skin && c.verdict === 'wrong-finish')
    if (!missed.length) continue
    const parts = stretches(missed)
    const need = missed[0].need
    const others = FINISHES.filter((f) => f !== need && missed.some((c) => c.matches[f] > 0))
    const hexes = parts.flatMap((run) => sample(run).map((c) => c.hex)).slice(0, 5)
    out.push({
      kind: 'gap',
      title: `${SKIN_WORD[skin]} skin: no ${need} match on ${pct(missed.length / rungs.length)} of the scale`,
      body: `${cap(joinWords(parts.map(spanWord)))} there are shades, but every one within ${MATCH_DE} ΔE is ${orWord(others)}. ${SKIN_WORD[skin]} skin is prescribed a ${need} base, so the colour is right and the formula is not — the half of the match a shade finder never checks.`,
      action: `Add a ${need} formula in shades near ${hexes.join(', ')}.`,
      hexes,
    })
  }

  // 3. Matches nobody can judge, because the finish is stated nowhere.
  if (finishes.unstated > 0 && baseCount > 0) {
    const blind = cells.filter((c) => c.verdict === 'finish-unstated').length
    out.push({
      kind: finishes.unstated / baseCount > 0.25 || blind ? 'warn' : 'good',
      title: `${finishes.unstated} of ${baseCount} bases name no finish`,
      body: `Neither the name nor the description says matte, natural or dewy${blind ? `, and for ${pct(blind / cells.length)} of the panel the only matching shades are ones like this` : ''}. A shopper with oily or dry skin cannot tell whether they suit her, and neither can this audit.`,
      action: 'Declare it: add a finish column (matte, natural or dewy) to your sheet or feed.',
    })
  }

  // 4. Where the range actually sits.
  if (baseCount >= 5) {
    const deep = tones.filter((t) => t.tone >= 6).reduce((n, t) => n + t.shades, 0)
    if (deep / baseCount < 0.25) {
      out.push({
        kind: 'warn',
        title: `Monk tones 6–10 get ${pct(deep / baseCount)} of the range`,
        body: `${baseCount - deep} of ${baseCount} bases sit nearest the five lightest tones. The deeper half of the scale shares ${deep === 1 ? 'one shade' : `${deep} shades`}, so even where it is covered, its shoppers choose from a fraction of what lighter shoppers see.`,
      })
    }
  }

  // 5. Blush that only reads on part of the scale.
  if (blushCount >= 3) {
    const thin = tones.filter((t) => t.blush.flush <= Math.max(1, Math.floor(blushCount * 0.1)))
    for (const run of runs(thin.map((t) => t.tone))) {
      const rows = thin.filter((t) => run.includes(t.tone))
      const flush = Math.min(...rows.map((t) => t.blush.flush))
      const sits = Math.max(...rows.map((t) => t.blush['sits-on-top']))
      const vanish = Math.max(...rows.map((t) => t.blush.vanishes))
      out.push({
        kind: 'warn',
        title: `Blush barely reads on Monk ${tonesWord(run)}`,
        body: `${flush === 0 ? 'None' : `Only ${flush}`} of ${blushCount} blushes ${flush === 1 ? 'reads' : 'read'} as a flush there. ${sits >= vanish ? `${sits} sit on top of the skin rather than in it` : `${vanish} are too close to the skin to show`}, by the same visibility bands the shopper side ranks with.`,
        action: sits >= vanish ? 'Add deeper, more saturated blushes for these tones.' : 'Add more pigmented blushes for these tones.',
        hexes: rows.map((t) => t.hex),
      })
    }
  }

  // 6. Lip colour that greys out on deep skin.
  const deepTones = tones.filter((t) => depthOf(t.hex) <= 3)
  if (lipCount >= 3 && deepTones.length) {
    const chalky = deepTones[0].chalkyLips
    if (chalky / lipCount > 0.25) {
      out.push({
        kind: 'warn',
        title: `${chalky} of ${lipCount} lipsticks read chalky on deep skin`,
        body: `Pale, low-pigment shades look grey on Monk ${tonesWord(deepTones.map((t) => t.tone))}: ${pct(chalky / lipCount)} of the lip range those shoppers would be shown and should skip.`,
        action: 'Balance the nudes with deeper, more pigmented ones.',
      })
    }
  }

  // What is going right, measured on the same scale.
  const served = cells.filter((c) => c.verdict === 'served').length
  if (baseCount > 0 && served === cells.length) {
    out.push({
      kind: 'good',
      title: 'Every point on the scale is served',
      body: `From Monk 1 to 10 there is a shade within ${MATCH_DE} ΔE, in the finish oily, balanced and dry skin are each prescribed.`,
    })
  } else if (baseCount > 0 && shadeCoverage >= 0.9) {
    out.push({
      kind: 'good',
      title: `Shades cover ${pct(shadeCoverage)} of the scale`,
      body: `Almost every skin colour from Monk 1 to 10 has a base within ${MATCH_DE} ΔE. What is left to fix is ${served < cells.length ? 'mostly formula, not colour' : 'small'}.`,
    })
  }

  const order = { gap: 0, warn: 1, good: 2 }
  return out.sort((a, b) => order[a.kind] - order[b.kind])
}

/* -- Real shoppers -------------------------------------------------------------- */

export interface Demand {
  skinHex: string
  finish: Finish
}

export interface DemandReport {
  count: number
  byVerdict: Record<Verdict, number>
  /** Skin colours of shoppers the range failed, deepest first. */
  missed: Array<{ skinHex: string; finish: Finish; verdict: Verdict; dE: number | null }>
}

/**
 * The panel says who a range COULD fail. Real scans say who it DID.
 *
 * Each entry is only a measured skin colour and the finish prescribed for it —
 * no photo and no identity — so this can be shown to a merchant without
 * showing them a person.
 */
export function placeDemand(products: Product[], demand: Demand[]): DemandReport {
  const shades = toShades(products)
  const byVerdict: Record<Verdict, number> = { served: 0, 'wrong-finish': 0, 'finish-unstated': 0, 'no-shade': 0 }
  const missed: DemandReport['missed'] = []
  for (const d of demand) {
    const p = place(shades, d.skinHex, d.finish)
    byVerdict[p.verdict] += 1
    if (p.verdict !== 'served') {
      missed.push({ skinHex: d.skinHex, finish: d.finish, verdict: p.verdict, dE: p.closest ? round1(p.closest.dE) : null })
    }
  }
  missed.sort((a, b) => hexToLab(a.skinHex).L - hexToLab(b.skinHex).L)
  return { count: demand.length, byVerdict, missed: missed.slice(0, 24) }
}

/* -- Wording ---------------------------------------------------------------- */

/** [8, 9, 10] -> [[8, 9, 10]]; [2, 3, 6] -> [[2, 3], [6]]. */
function runs(nums: number[]): number[][] {
  const sorted = [...new Set(nums)].sort((a, b) => a - b)
  const out: number[][] = []
  for (const n of sorted) {
    const last = out.at(-1)
    if (last && n === last.at(-1)! + 1) last.push(n)
    else out.push([n])
  }
  return out
}

/** "tone 4", "tones 8–10", "tones 2–3 and 6". */
function tonesWord(nums: number[]): string {
  const parts = runs(nums).map((r) => (r.length > 1 ? `${r[0]}–${r.at(-1)}` : `${r[0]}`))
  const word = nums.length > 1 ? 'tones' : 'tone'
  return `${word} ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]}`
}

const INDEX = new Map(LADDER.map((r, i) => [r.at, i]))

/** Consecutive stretches of the ladder. */
function stretches<T extends { at: number }>(xs: T[]): T[][] {
  const sorted = [...xs].sort((a, b) => a.at - b.at)
  const out: T[][] = []
  for (const x of sorted) {
    const last = out.at(-1)
    if (last && INDEX.get(x.at) === INDEX.get(last.at(-1)!.at)! + 1) last.push(x)
    else out.push([x])
  }
  return out
}

const pos = (at: number) => (Number.isInteger(at) ? `${at}` : at.toFixed(1))

/** "at Monk 4", "between Monk 5 and 6", "from Monk 8.3 to 10". */
function spanWord(run: Array<{ at: number }>): string {
  const s = run[0].at
  const e = run.at(-1)!.at
  const lo = Math.floor(s)
  if (!Number.isInteger(s) && !Number.isInteger(e) && Math.floor(e) === lo) {
    return `between Monk ${lo} and ${lo + 1}`
  }
  return s === e ? `at Monk ${pos(s)}` : `from Monk ${pos(s)} to ${pos(e)}`
}

/** A few swatches for a stretch: both ends and the middle. */
const sample = <T,>(run: T[]): T[] =>
  run.length <= 3 ? run : [run[0], run[Math.floor(run.length / 2)], run.at(-1)!]

const orWord = (xs: string[]) =>
  xs.length < 2 ? (xs[0] ?? 'unstated') : `${xs.slice(0, -1).join(', ')} or ${xs.at(-1)}`

/** Feeds lower-case some brands ("clinique"); a report should not. */
const brandWord = (b: string) => (b === b.toLowerCase() ? b.replace(/\b\w/g, (c) => c.toUpperCase()) : b)

function shadeWord(s: ShadeRef): string {
  // Many feeds already put the brand in the name; saying it twice reads as a bug.
  const named = s.name.toLowerCase().startsWith(s.brand.toLowerCase())
  return `${named ? s.name : `${brandWord(s.brand)} ${s.name}`}${s.shadeName ? ` in ${s.shadeName}` : ''}`
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const joinWords = (xs: string[]) =>
  xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`

const pct = (v: number) => `${Math.round(v * 100)}%`
const round1 = (v: number) => Math.round(v * 10) / 10
/** A declaration, not an arrow: LADDER calls it while the module is still loading. */
function round2(v: number): number {
  return Math.round(v * 100) / 100
}
