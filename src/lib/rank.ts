import { deltaE, hexToLab, hexToLch, hueGap, NEUTRAL_CHROMA, type Lch } from './color'
import type { Product } from './catalogue'
import type { ConcernRow, Palette } from './prescription'
import { severityOf } from './prescription'

/**
 * One ranker per aisle, deliberately not one generic scorer.
 *
 * Each aisle asks a different question. Foundation must MATCH her skin; clothes
 * must FLATTER it; lipstick and blush must READ AS COSMETICS ON it, which is a
 * third question again. A shared scorer gets at least one of them actively
 * wrong, and it did: every aisle but foundation used to be scored as distance
 * to the nearest of four wardrobe swatches, so an olive-green lipstick ranked
 * well for Warm Spring because "Olive" is in that palette.
 */

export interface Ranked extends Product {
  /** Lower is better within an aisle; only meaningful against its siblings. */
  score: number
  /** Shopper-facing cause, naming the measurement that produced the pick. */
  reason: string
}

/**
 * Everything the rankers are allowed to know about her.
 *
 * Passed as one object rather than a widening argument list, because the whole
 * point is that every aisle reads from the SAME scan: adding a signal must make
 * it available to each ranker, not to whichever call site was edited.
 */
export interface Shopper {
  /** Measured skin colour. The anchor for contrast and visibility. */
  skinHex: string
  /** Measured natural lip colour, when the scan returned one. */
  lipHex?: string
  palette: Palette
  concerns: ConcernRow[]
}

/**
 * How many rows travel to the browser per aisle.
 *
 * Applied at the RESPONSE boundary, not inside the rankers, so the counts the
 * chooser prints describe the catalogue rather than this number. Capping
 * during ranking meant two different aisles both reported exactly 500
 * available, which is a tell that the figure was the cap and not the shelf.
 */
export const SHORTLIST = 500

/** What the model is shown, so the prompt stays small enough to work. */
export const JUDGE_SLICE = 12

/** ΔE below this is the same colour to the eye. */
const DUPLICATE_DE = 1.5
const PER_BRAND_CAP = 4

/* -- Foundation ---------------------------------------------------------- */

/**
 * Foundation: nearest shade in CIELAB.
 *
 * Straight ΔE order collapses on deep skin, because the brands with the
 * densest ranges take every slot. Two filters fix it, and they are not equal:
 * the near-duplicate filter never bends, because padding a list with shades
 * the eye cannot tell apart makes the menu look longer while offering nothing.
 * The per-brand cap bends to fill the list.
 */
export function rankFoundation(products: Product[], skinHex: string): Ranked[] {
  const target = hexToLab(skinHex)
  const scored = products
    .map((p) => ({ ...p, score: deltaE(target, hexToLab(p.hex)) }))
    .sort((a, b) => a.score - b.score)

  const picked = pickDistinct(scored, PER_BRAND_CAP)
  // Relax the brand cap so every distinct shade still appears, further down.
  const filled = pickDistinct(scored, Infinity, picked)

  return filled.map((p) => ({
    ...p,
    reason: whyFoundation(p.score, skinHex),
  }))
}

/**
 * Graded, because one sentence for every distance is not a reading.
 *
 * "Nearest available shade to your measured skin colour" was printed identically
 * at 4.5 ΔE and at 22.1 ΔE — the first is a wearable match and the second is
 * visibly the wrong colour, and a shopper scrolling the shelf could not tell
 * them apart. Roughly: under 2 is invisible to the eye, under 5 is a match in
 * most light, and past about 10 it is a different colour on the face.
 */
function whyFoundation(dE: number, skinHex: string): string {
  const d = dE.toFixed(1)
  if (dE < 2) return `Within ${d} ΔE of your measured skin colour (${skinHex}) — closer than the eye separates.`
  if (dE < 5) return `${d} ΔE from your measured skin colour (${skinHex}), which is a match in most light.`
  if (dE < 10) return `${d} ΔE from your measured skin colour (${skinHex}) — wearable, but the shades above match you closer.`
  return `${d} ΔE from your measured skin colour (${skinHex}), which will read as a different colour on your face.`
}

function pickDistinct(
  scored: Ranked[] | Array<Product & { score: number }>,
  brandCap: number,
  seed: Array<Product & { score: number }> = [],
): Array<Product & { score: number }> {
  const out = [...seed]
  const perBrand = new Map<string, number>()
  for (const s of seed) perBrand.set(s.brand, (perBrand.get(s.brand) ?? 0) + 1)

  for (const cand of scored) {
    if (out.some((o) => o.id === cand.id)) continue
    if ((perBrand.get(cand.brand) ?? 0) >= brandCap) continue
    // Never show two shades the eye reads as one.
    const candLab = hexToLab(cand.hex)
    if (out.some((o) => deltaE(candLab, hexToLab(o.hex)) < DUPLICATE_DE)) continue
    out.push(cand)
    perBrand.set(cand.brand, (perBrand.get(cand.brand) ?? 0) + 1)
  }
  return out
}

/* -- Shared colour reasoning --------------------------------------------- */

/**
 * Where each undertone's harmonious colours sit on the hue circle.
 *
 * Warm centres on gold, which is also where camel, olive and rust live; cool
 * centres between blue and violet, covering navy, petrol and plum. These are
 * anchors for a gradient, not buckets: a colour halfway between is penalised
 * halfway, so nothing is excluded outright for being off-season.
 */
const WARM_ANCHOR = 65
const COOL_ANCHOR = 250

/**
 * How strongly a colour asserts an undertone at all.
 *
 * A dusty sage and a fluorescent green sit at the same hue but do not make the
 * same claim about her colouring, and a grey makes none. Weighting every hue
 * judgement by this is what stops neutrals being scored as clashes.
 */
function assertiveness({ C }: Lch): number {
  return Math.max(0, Math.min(1, (C - NEUTRAL_CHROMA) / 40))
}

/** 0 when the colour suits her undertone, 1 when it opposes it. */
function undertoneMiss(lch: Lch, palette: Palette): number {
  // Neutral colouring takes both anchors, so nothing opposes it.
  if (palette.undertone === 'neutral') return 0
  const anchor = palette.undertone === 'warm' ? WARM_ANCHOR : COOL_ANCHOR
  return (hueGap(lch.h, anchor) / 180) * assertiveness(lch)
}

/** Severity 0-1 of the redness reading, or 0 when it was never measured. */
function rednessOf(concerns: ConcernRow[]): number {
  return severityOf(concerns, 'redness') ?? 0
}

/** Hues that sit in the same family as facial redness. */
const isRedFamily = (h: number) => h < 45 || h > 335

/**
 * Order a shelf and stop one brand owning the top of it.
 *
 * Straight score order collapses onto whichever feed sells the most of one
 * thing: a single shop's twelve near-identical white tees beat every coloured
 * garment. Capping orders the shelf rather than truncating it — everything
 * still appears, further down.
 */
function spread(scored: Ranked[], perBrand = 3, perShade = 2): Ranked[] {
  const sorted = [...scored].sort((a, b) => a.score - b.score)
  const picked: Ranked[] = []
  const taken = new Set<string>()
  const seenBrand = new Map<string, number>()
  const seenShade = new Map<string, number>()

  for (const row of sorted) {
    const brand = seenBrand.get(row.brand) ?? 0
    if (brand >= perBrand) continue
    // Colour is the whole proposition here, so three rows of one colour read
    // as one recommendation printed three times — which is what the live feeds
    // produce, a suit and a sport coat measuring the identical blue. Quantised
    // rather than compared pairwise: this runs over every row of every aisle.
    const shade = seenShade.get(shadeKey(row.hex)) ?? 0
    if (shade >= perShade) continue
    picked.push(row)
    taken.add(row.id)
    seenBrand.set(row.brand, brand + 1)
    seenShade.set(shadeKey(row.hex), shade + 1)
  }
  for (const row of sorted) {
    if (!taken.has(row.id)) picked.push(row)
  }
  return picked
}

/** A Lab cell roughly the size of a just-noticeable difference. */
function shadeKey(hex: string): string {
  const { L, a, b } = hexToLab(hex)
  return `${Math.round(L / 4)}:${Math.round(a / 4)}:${Math.round(b / 4)}`
}

/* -- Clothes -------------------------------------------------------------- */

/**
 * Clothes: harmony with her colouring, not proximity to four swatches.
 *
 * Four things decide it, and they are separable on purpose so the reason can
 * name the one that actually drove the pick:
 *
 *  1. UNDERTONE. Weighted by how assertive the colour is, so a white shirt is
 *     never "wrong for Deep Autumn" — neutrals carry no undertone to clash.
 *  2. CONTRAST. A garment at her own lightness washes her out however good the
 *     hue is, and lightness is exactly what a straight ΔE buries.
 *  3. REDNESS. Simultaneous contrast: worn next to already-flushed skin, a red
 *     garment pushes the skin's apparent hue further red, and its complement
 *     settles it. Only applied to the degree redness was actually measured.
 *  4. SEASON. The palette swatches survive as a bonus and as the wording of
 *     the reason, rather than as the whole score.
 */
export function rankClothes(products: Product[], shopper: Shopper): Ranked[] {
  const { palette } = shopper
  const skin = hexToLch(shopper.skinHex)
  const redness = rednessOf(shopper.concerns)
  const swatches = palette.swatches.map((s) => ({ ...s, lch: hexToLch(s.hex) }))

  const scored = products.map((p) => {
    const lch = hexToLch(p.hex)
    const weight = assertiveness(lch)

    const undertone = undertoneMiss(lch, palette) * 30

    // Separation from her own lightness. A wide band, because most of a
    // wardrobe is legitimately mid-contrast; only the wash-out zone is dear.
    const dL = Math.abs(lch.L - skin.L)
    const contrast = dL < 16 ? (16 - dL) * 1.1 : dL > 58 ? (dL - 58) * 0.12 : 0

    // Only fires to the extent redness was measured, so a shopper with none
    // sees an unmodified shelf rather than an invented restriction.
    const amplifies = isRedFamily(lch.h) ? redness * 26 * weight : 0
    // Teal and petrol, opposite the flush.
    const settles = lch.h > 165 && lch.h < 215 ? -redness * 9 * weight : 0

    let near = swatches[0]
    let nearGap = Infinity
    for (const s of swatches) {
      const gap = hueGap(lch.h, s.lch.h)
      if (gap < nearGap) {
        nearGap = gap
        near = s
      }
    }
    const season = -(1 - nearGap / 180) * 8 * weight

    const score = undertone + contrast + amplifies + settles + season

    return {
      ...p,
      score,
      reason: whyGarment({
        lch, weight, palette, near, undertone, contrast, amplifies, settles, redness, dL,
      }),
    }
  })

  return spread(scored)
}

function whyGarment(f: {
  lch: Lch
  weight: number
  palette: Palette
  near: { name: string }
  undertone: number
  contrast: number
  amplifies: number
  settles: number
  redness: number
  dL: number
}): string {
  // Name the term that actually moved the score, so the sentence is an
  // explanation rather than a caption. Penalties are checked before praise:
  // a shopper is better served by why something is a compromise.
  if (f.amplifies > 6) {
    return `Sits in the same hue family as facial redness, which your scan measured at ${pct(f.redness)}, so it tends to make it read stronger.`
  }
  if (f.contrast > 8) {
    return `Very close to your own skin lightness (${Math.round(f.dL)} L* apart), so it reads washed-out next to your face.`
  }
  if (f.undertone > 18) {
    return `Pulls against your ${f.palette.undertone} undertone, so it is wearable but not the shade that flatters you most.`
  }
  if (f.settles < -3) {
    return `A blue-green sitting opposite facial redness on the colour wheel, which visually settles the ${pct(f.redness)} redness your scan measured.`
  }
  if (f.weight < 0.15) {
    return `A neutral, so it carries no undertone to fight your ${f.palette.undertone} colouring — it works with everything you own.`
  }
  return `Harmonises with your ${f.palette.undertone} undertone and sits near ${f.near.name} in your ${f.palette.season} palette.`
}

/* -- Lipstick and blush --------------------------------------------------- */

/**
 * The arc of hues a face can wear as colour cosmetics.
 *
 * Everything people put on lips and cheeks — brick, coral, nude, rose, berry,
 * plum — falls in a band running through red, from about 315° round to 60°.
 * Nothing outside it is a cosmetic, which is the rule the old shared scorer
 * had no way to state: it happily recommended an olive lipstick because Olive
 * is a garment colour in the Warm Spring palette.
 */
const COSMETIC_CENTRE = 10
const LIP_SPAN = 55
const BLUSH_SPAN = 45

/** How far outside the wearable arc a colour falls, in degrees. */
const outsideArc = (h: number, span: number) =>
  Math.max(0, hueGap(h, COSMETIC_CENTRE) - span)

/**
 * Where inside the arc each undertone sits best: coral-brick for warm, blue-red
 * and berry for cool, the middle for neutral.
 */
const COSMETIC_IDEAL: Record<string, number> = { warm: 32, cool: 350, neutral: 10 }

/**
 * How far a shade sits from the best part of the arc for her, 0-1.
 *
 * Continuous, not a side-of-the-line test. A ranker built only from penalties
 * scores every acceptable product zero, and a shelf where 485 of 500 rows tie
 * is ordered by whichever feed answered first — which is the failure the old
 * scorer had, arrived at from the other direction. Every product needs a
 * distinct place, so preference has to be graded, not just failure.
 */
function sideMiss(lch: Lch, palette: Palette): number {
  // A nude asserts no temperature, so it cannot sit on the wrong side of one.
  if (lch.C < NEUTRAL_CHROMA) return 0
  const ideal = COSMETIC_IDEAL[palette.undertone] ?? COSMETIC_IDEAL.neutral
  // Neutral colouring genuinely takes both sides of the arc, so it gets a
  // gradient faint enough to order a shelf and too faint to justify telling
  // her a shade leans the wrong way — which would be a finding we did not make.
  const strength = palette.undertone === 'neutral' ? 0.2 : 1
  return (hueGap(lch.h, ideal) / 180) * assertiveness(lch) * strength
}

/**
 * Above this the undertone lean is worth SAYING, not merely worth scoring.
 *
 * The two thresholds are deliberately different. Ordering a shelf wants every
 * difference, however small; telling a shopper her shade is off wants only
 * differences she would see.
 */
const WORTH_SAYING = 8

/**
 * Cost of a measured shift, graded either side of an ideal.
 *
 * The band edges are where a product stops working — invisible below, costume
 * above — but inside them one shift is still better than another, and this is
 * what separates them. Failing outside the band stays far dearer than being
 * merely off-ideal within it.
 */
function bandCost(
  shift: number,
  { ideal, low, high, slope }: { ideal: number; low: number; high: number; slope: number },
): number {
  const drift = Math.abs(shift - ideal) * slope
  if (shift < low) return drift + (low - shift) * 1.6
  if (shift > high) return drift + (shift - high) * 0.4
  return drift
}

/**
 * Lipstick: a wearable lip hue that actually changes her mouth.
 *
 * Scored against her MEASURED lip colour, which the scan already returns and
 * which nothing used to read — the shop route took `lipHex` only to paint the
 * try-on preview. A shade within a couple of ΔE of her own lips is not a
 * recommendation, it is a photograph of her mouth.
 */
export function rankLipstick(products: Product[], shopper: Shopper): Ranked[] {
  const { palette } = shopper
  const lip = shopper.lipHex ? hexToLab(shopper.lipHex) : null

  const scored = products.map((p) => {
    const lch = hexToLch(p.hex)
    const off = outsideArc(lch.h, LIP_SPAN)
    // Steep, because this is a gate: a green lipstick is not a near miss.
    const arc = off * 0.9
    const side = sideMiss(lch, palette) * 22

    // Payoff against her own lips. Only scored when the scan measured them:
    // a reading we never took must not order the shelf.
    const shift = lip ? deltaE(lip, hexToLab(p.hex)) : null
    const payoff =
      shift === null
        ? 0
        : bandCost(shift, { ideal: 28, low: 10, high: 55, slope: 0.22 })

    // Chalky pales read grey on deep skin; deep skin is depth 1-3.
    const chalky = palette.depth <= 3 && lch.L > 72 && lch.C < 25 ? 10 : 0

    const score = arc + side + payoff + chalky

    return { ...p, score,
      reason:
      off > 12
        ? `Outside the range of hues that read as lipstick on a face, so it is listed but not recommended.`
        : chalky
          ? `Pale and low in pigment against your measured depth (${palette.depth} of 6), so it risks reading chalky.`
          : shift !== null && shift < 10
            ? `Within ${shift.toFixed(1)} ΔE of your own measured lip colour, so it will barely show as a change.`
            : side > WORTH_SAYING
              ? `A wearable lip shade, though it leans away from your ${palette.undertone} undertone.`
              : shift !== null
                ? `${article(p.colorName)} that shifts your measured lip colour by ${shift.toFixed(1)} ΔE and follows your ${palette.undertone} undertone.`
                : `${article(p.colorName)} in the range that suits your ${palette.undertone} undertone.`,
    }
  })

  return spread(scored)
}

/**
 * Blush: a flush that is visible without being a stripe.
 *
 * Judged against her SKIN, not against a wardrobe palette. Two failures bound
 * it from either side — a blush at her own colour disappears, and one far from
 * it sits on the face rather than in it — and only the window between them is
 * a flush. The old scorer could only express one of those, and expressed it
 * against the wrong reference.
 */
export function rankBlush(products: Product[], shopper: Shopper): Ranked[] {
  const { palette } = shopper
  const skin = hexToLab(shopper.skinHex)

  const scored = products.map((p) => {
    const lch = hexToLch(p.hex)
    const arc = outsideArc(lch.h, BLUSH_SPAN) * 0.9
    const side = sideMiss(lch, palette) * 18

    const shift = deltaE(skin, hexToLab(p.hex))
    const visibility = bandCost(shift, { ideal: 22, low: 10, high: 42, slope: 0.3 })

    const score = arc + side + visibility

    return { ...p, score,
      reason:
      arc > 10
        ? `Not in the range of hues that read as a flush, so it is listed but not recommended.`
        : shift < 10
          ? `Only ${shift.toFixed(1)} ΔE from your measured skin colour, so it would disappear rather than lift the cheek.`
          : shift > 42
            ? `Much stronger than your measured skin colour (${shift.toFixed(0)} ΔE), so it sits on the face rather than in it.`
            : side > WORTH_SAYING
              ? `Lifts your measured skin colour by ${shift.toFixed(1)} ΔE, which reads as a flush, though it leans away from your ${palette.undertone} undertone.`
              : `Lifts your measured skin colour by ${shift.toFixed(1)} ΔE, which reads as a flush, and follows your ${palette.undertone} undertone.`,
    }
  })

  return spread(scored)
}

/* -- Hair ----------------------------------------------------------------- */

/**
 * Traits readable from a style's title.
 *
 * YouCam's hair catalogue gives a title, a thumbnail and a category — no
 * structured attributes — so the title is the only thing there is to read. A
 * style whose title says nothing recognisable matches no trait and is ranked
 * neutrally, rather than being assigned one by guesswork.
 */
const HAIR_TRAITS: Record<string, RegExp> = {
  curl: /\b(curl|curls|curly|wave|waves|wavy|s-wave|perm|coil|afro|shag)\b/i,
  blunt: /\b(blunt|sleek|straight|slick|slicked)\b/i,
  fringe: /\b(fringe|bangs|comma)\b/i,
  sidePart: /\b(side|side-swept|combover|comma)\b/i,
  middlePart: /\b(middle|centre|center)\b/i,
  bob: /\b(bob|lob)\b/i,
  crop: /\b(crop|pixie|buzz|fade|taper|short)\b/i,
  length: /\b(long|braid|braids|bun|ponytail|updo)\b/i,
  volume: /\b(volume|voluminous|messy|textured|layered|layers)\b/i,
}

const traitsOf = (title: string): string[] =>
  Object.entries(HAIR_TRAITS).filter(([, re]) => re.test(title)).map(([t]) => t)

/**
 * What each measured face shape is looking for from a cut.
 *
 * This is styling convention rather than measurement — the same standing as the
 * simultaneous-contrast reasoning the clothes ranker uses. The MEASUREMENT is
 * the face shape YouCam returned; the convention is what to do about it. Both
 * halves go in the reason, so a shopper can see which is which rather than
 * being told a haircut was calculated.
 */
interface FaceRule {
  wants: string[]
  avoids: string[]
  /** Completes "…, which <needs>." */
  needs: string
}

const FACE_RULES: Record<string, FaceRule> = {
  round: {
    wants: ['length', 'volume', 'sidePart', 'middlePart'],
    avoids: ['bob', 'crop'],
    needs: 'suits length and height rather than width at the cheeks',
  },
  square: {
    wants: ['curl', 'volume', 'sidePart', 'length'],
    avoids: ['blunt'],
    needs: 'is softened by waves and side-swept shapes rather than hard straight lines',
  },
  oblong: {
    wants: ['fringe', 'bob', 'curl'],
    avoids: ['length', 'blunt'],
    needs: 'gains from width and a fringe rather than more length',
  },
  heart: {
    wants: ['bob', 'curl', 'sidePart'],
    avoids: ['volume'],
    needs: 'balances a narrower chin with fullness lower down',
  },
  diamond: {
    wants: ['fringe', 'bob', 'curl'],
    avoids: ['blunt'],
    needs: 'is softened across the cheekbones by a fringe or a chin-length shape',
  },
  triangle: {
    wants: ['volume', 'crop', 'fringe'],
    avoids: ['length'],
    needs: 'gains from fullness higher up',
  },
  // Oval carries every shape, so it gets no wants and no avoids — and the
  // reason says exactly that rather than inventing a preference to sound
  // more calculated than the reading was.
  oval: { wants: [], avoids: [], needs: 'carries most shapes without needing correction' },
}

/** YouCam's own wording varies; anything unrecognised ranks neutrally. */
export function faceRuleFor(faceShape?: string): { key: string; rule: FaceRule } | null {
  const s = faceShape?.trim().toLowerCase().replace(/[\s_-]+/g, '')
  if (!s) return null
  const alias: Record<string, string> = {
    long: 'oblong', rectangle: 'oblong', rectangular: 'oblong', oblong: 'oblong',
    round: 'round', circle: 'round',
    square: 'square',
    heart: 'heart', inverted: 'heart', invertedtriangle: 'heart',
    diamond: 'diamond',
    triangle: 'triangle', pear: 'triangle',
    oval: 'oval',
  }
  const key = alias[s]
  return key ? { key, rule: FACE_RULES[key] } : null
}

/**
 * Hair: ranked against the measured face shape.
 *
 * The aisle previously scored every style 0 and showed them in catalogue
 * order, while the scan measured a face shape, displayed it on the diagnosis
 * screen, sent it to this route and then dropped it. A haircut is the one
 * recommendation where face shape is the reading that matters, so this is
 * where it earns its place.
 */
export function rankHair<T extends Ranked>(styles: T[], faceShape?: string): T[] {
  const found = faceRuleFor(faceShape)
  if (!found) {
    // No reading, so no claim. The styles are still offered, and the wording
    // says why they are not ranked instead of implying they were.
    return styles.map((s) => ({
      ...s,
      score: 0,
      reason: `A ${s.brand.toLowerCase()} cut from YouCam's catalogue. Your scan did not return a face shape, so these are not ranked to one.`,
    }))
  }

  const { key, rule } = found
  const scored = styles.map((s) => {
    const traits = traitsOf(s.name)
    const wants = traits.filter((t) => rule.wants.includes(t))
    const avoids = traits.filter((t) => rule.avoids.includes(t))
    return {
      ...s,
      score: avoids.length * 6 - wants.length * 4,
      reason: wants.length
        ? `Your scan read a ${key} face, which ${rule.needs} — and this is a ${describe(wants)} shape.`
        : avoids.length
          ? `Your scan read a ${key} face, which ${rule.needs}. This ${describe(avoids)} shape works against that.`
          : `Your scan read a ${key} face, which ${rule.needs}. Nothing in this style pulls either way.`,
    }
  })
  return scored.sort((a, b) => a.score - b.score)
}

const TRAIT_WORD: Record<string, string> = {
  curl: 'waved or curled', blunt: 'blunt, straight', fringe: 'fringed',
  sidePart: 'side-parted', middlePart: 'centre-parted', bob: 'chin-length',
  crop: 'cropped', length: 'long', volume: 'full, layered',
}

const describe = (traits: string[]): string =>
  traits.map((t) => TRAIT_WORD[t] ?? t).join(' and ')

/* -- Skincare ------------------------------------------------------------- */

/** Skincare: aim at the worst measured problem. */
export function rankSkincare(products: Product[], concerns: ConcernRow[]): Ranked[] {
  return products
    .map((p) => {
      const treats = p.tags ?? []
      let total = 0
      const hit: Array<{ label: string; sev: number }> = []
      for (const t of treats) {
        const sev = severityOf(concerns, t)
        if (sev !== null && sev > 0.05) {
          total += sev
          hit.push({ label: t.replace(/_v2$/, '').replace(/_/g, ' '), sev })
        }
      }
      // Worst first, and the severity is printed: "targets redness" reads the
      // same whether her redness measured 8% or 61%, and only one of those is
      // a reason to buy anything.
      hit.sort((a, b) => b.sev - a.sev)
      return {
        ...p,
        // Negated so the shared "lower is better" convention holds.
        score: -total,
        reason: hit.length
          ? `Targets ${hit.map((h) => `${h.label} (your scan read ${pct(h.sev)})`).join(' and ')}.`
          : 'A general-purpose step, not aimed at anything your scan flagged.',
      }
    })
    .sort((a, b) => a.score - b.score)
}

const pct = (v: number) => `${Math.round(v * 100)}%`

/** "an orange", "a deep brown". Colour names are generated, so this is too. */
const article = (word: string) =>
  `${/^[aeiou]/i.test(word) ? 'An' : 'A'} ${word}`
