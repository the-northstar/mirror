import { hexToLab, labToRgb, rgbToHex } from './color'
import type { Formula, Palette } from './prescription'

/**
 * Turn the prescribed formula into makeup-vto effects.
 *
 * This is the differentiating step: most integrations render a preset lip
 * colour. Here the intensities come from measurements taken off her face, so
 * the same matched shade renders matte on oily skin and dewy on dry.
 */

export interface MakeupEffect {
  category: string
  palettes: Array<Record<string, unknown>>
  shape?: Record<string, unknown>
  style?: Record<string, unknown>
  pattern?: Record<string, unknown>
}

/** makeup-vto takes integer intensities 0-100; the formula is 0-1. */
const pct = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 100)

/**
 * Concealer is derived rather than stocked: no free catalogue carries one.
 * Convention is the chosen foundation lifted a step in L*, with a* and b*
 * untouched so the undertone survives.
 */
export function concealerFrom(foundationHex: string): string {
  const lab = hexToLab(foundationHex)
  return rgbToHex(labToRgb({ ...lab, L: Math.min(100, lab.L + 8) }))
}

/**
 * Build the effect list.
 *
 * Foundation is applied by skin segmentation, so it takes no shape or pattern
 * and requires all four palette fields. Lip colour additionally requires shape
 * and style; dropping either fails validation.
 */
export function effectsFor(
  formula: Formula,
  skinHex: string,
  lipHex?: string,
  blushHex?: string,
): MakeupEffect[] {
  const effects: MakeupEffect[] = [
    {
      category: 'foundation',
      palettes: [
        {
          color: skinHex,
          // Colour intensity is how strongly the shade sits; the prescribed
          // coverage drives it, so full-coverage readings render heavier.
          colorIntensity: pct(0.35 + formula.coverageIntensity * 0.45),
          glowIntensity: pct(formula.glowIntensity),
          coverageIntensity: pct(formula.coverageIntensity),
        },
      ],
    },
  ]

  if (lipHex) {
    effects.push({
      category: 'lip_color',
      shape: { name: 'original' },
      style: { type: 'full' },
      palettes: [
        {
          color: lipHex,
          // Finish follows the same reading as the foundation, so the face
          // reads as one prescription rather than two unrelated products.
          texture: formula.finish === 'matte' ? 'matte' : formula.finish === 'dewy' ? 'gloss' : 'satin',
          colorIntensity: 75,
        },
      ],
    })
  }

  if (blushHex) {
    effects.push({
      category: 'blush',
      // Unlike foundation, blush is placed rather than segmented, so it needs
      // a pattern from YouCam's own catalogue and a texture.
      pattern: { name: '1color1' },
      palettes: [
        {
          color: blushHex,
          texture: formula.finish === 'matte' ? 'matte' : 'shimmer',
          colorIntensity: 55,
        },
      ],
    })
  }

  return effects
}

/** A shopper-facing summary of what the render is showing and why. */
export function explainEffects(formula: Formula, palette: Palette): string {
  const finish =
    formula.finish === 'matte'
      ? 'a matte base'
      : formula.finish === 'dewy'
        ? 'a dewy base'
        : 'a natural base'
  return `${finish} matched to your measured skin colour, at ${pct(formula.coverageIntensity)}% coverage. Shade follows your ${palette.undertone} undertone.`
}
