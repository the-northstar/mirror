import { deltaE, hexToLab } from './color'
import type { Product } from './catalogue'
import type { ConcernRow, Palette } from './prescription'
import { severityOf } from './prescription'

/**
 * One ranker per aisle, deliberately not one generic scorer.
 *
 * Each aisle asks a different question. Foundation must MATCH her skin; blush
 * and clothes must FLATTER it, and a blush the colour of her face is no blush.
 * A shared scorer gets at least one of them actively wrong.
 */

export interface Ranked extends Product {
  /** Lower is better within an aisle; only meaningful against its siblings. */
  score: number
  /** Shopper-facing cause, naming the measurement that produced the pick. */
  reason: string
}

export const SHORTLIST = 12

/** ΔE below this is the same colour to the eye. */
const DUPLICATE_DE = 1.5
const PER_BRAND_CAP = 4

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
  // Relax only the brand cap if the list came up short.
  const filled = picked.length < SHORTLIST ? pickDistinct(scored, Infinity, picked) : picked

  return filled.slice(0, SHORTLIST).map((p) => ({
    ...p,
    reason:
      p.score < 3
        ? `Within ${p.score.toFixed(1)} ΔE of your measured skin colour, which is a close match.`
        : `Nearest available shade to your measured skin colour (${p.score.toFixed(1)} ΔE).`,
  }))
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
    if (out.length >= SHORTLIST) break
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

/**
 * Blush, lipstick, clothes: fit to the palette, not to her face.
 *
 * Scored as distance to the nearest palette swatch, so a colour that IS her
 * skin ranks badly, which is correct: it would disappear.
 */
export function rankByPalette(products: Product[], palette: Palette): Ranked[] {
  const swatches = palette.swatches.map((s) => ({ ...s, lab: hexToLab(s.hex) }))

  const scored = products
    .map((p) => {
      const lab = hexToLab(p.hex)
      let best = swatches[0]
      let bestD = Infinity
      for (const s of swatches) {
        const d = deltaE(lab, s.lab)
        if (d < bestD) {
          bestD = d
          best = s
        }
      }
      return {
        ...p,
        score: bestD,
        reason: `Sits close to ${best.name} in your ${palette.season} palette, which follows your ${palette.undertone} undertone.`,
      }
    })
    .sort((a, b) => a.score - b.score)

  // Straight palette order collapses onto whichever feed sells the most
  // neutrals: one shop's twelve near-identical whites beat every coloured
  // garment. Cap each brand so the shelf shows a range, then top up.
  const PER_BRAND = 3
  const picked: Ranked[] = []
  const seen = new Map<string, number>()
  for (const row of scored) {
    if (picked.length >= SHORTLIST) break
    const n = seen.get(row.brand) ?? 0
    if (n >= PER_BRAND) continue
    picked.push(row)
    seen.set(row.brand, n + 1)
  }
  for (const row of scored) {
    if (picked.length >= SHORTLIST) break
    if (!picked.includes(row)) picked.push(row)
  }
  return picked
}

/** Skincare: aim at the worst measured problem. */
export function rankSkincare(products: Product[], concerns: ConcernRow[]): Ranked[] {
  return products
    .map((p) => {
      const treats = p.tags ?? []
      let total = 0
      const hit: string[] = []
      for (const t of treats) {
        const sev = severityOf(concerns, t)
        if (sev !== null && sev > 0.05) {
          total += sev
          hit.push(t.replace(/_v2$/, '').replace(/_/g, ' '))
        }
      }
      return {
        ...p,
        // Negated so the shared "lower is better" convention holds.
        score: -total,
        reason: hit.length
          ? `Targets ${hit.join(' and ')}, which your scan flagged.`
          : 'A general-purpose step, not aimed at anything your scan flagged.',
      }
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, SHORTLIST)
}


