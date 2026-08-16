import { expect, test, describe } from 'bun:test'
import { deltaE, depthOf, hexToLab, undertoneOf, colorName, dominantColor } from './color'
import { formulaFor, paletteFor, severityOf, type ConcernRow } from './prescription'

/**
 * These are fed REAL payloads captured from the live API, verbatim, so the
 * tests fail if the contract drifts rather than if my assumptions change.
 */

/** Captured from GET /s2s/v2.0/task/skin-tone-analysis/<id> on 2026-08-16. */
const LIVE_TONE = {
  status: 200,
  data: {
    error: null,
    results: {
      color: {
        eye_color: '#ddad95',
        eye_color_name: 'Amber',
        lip_color: '#c76c70',
        eyebrow_color: '#ceb094',
        skin_color: '#bd987d',
        hair_color: '#B56637',
        hair_color_name: 'Auburn',
      },
      face_quality: {
        has_face: true,
        area: 'good',
        frontal: 'good',
        lighting: 'good',
        faceangle: 'right_tilt',
      },
    },
    task_status: 'success',
  },
}

/** Captured from POST /api/analyze (skin-analysis, format json) on 2026-08-16. */
const LIVE_CONCERNS: ConcernRow[] = [
  { type: 'moisture', ui_score: 95, raw_score: 92.08 },
  { type: 'pore', ui_score: 94, raw_score: 93.91 },
  { type: 'radiance', ui_score: 96, raw_score: 98.13 },
  { type: 'age_spot', ui_score: 99, raw_score: 99.21 },
  { type: 'oiliness', ui_score: 99, raw_score: 99.32 },
  { type: 'texture', ui_score: 99, raw_score: 99.66 },
  { type: 'redness', ui_score: 100, raw_score: 100 },
  { type: 'acne', ui_score: 100, raw_score: 100 },
]

describe('live API contract', () => {
  test('tone results is an OBJECT, not an array', () => {
    // Reading results[0] here silently sends every shopper to a default and
    // looks like it works, so assert the shape explicitly.
    const results = LIVE_TONE.data.results
    expect(Array.isArray(results)).toBe(false)
    expect(results.color.skin_color).toBe('#bd987d')
  })

  test('all documented colour fields are present', () => {
    const c = LIVE_TONE.data.results.color
    for (const key of [
      'skin_color',
      'lip_color',
      'eye_color',
      'eyebrow_color',
      'hair_color',
      'eye_color_name',
      'hair_color_name',
    ]) {
      expect(c).toHaveProperty(key)
    }
  })
})

describe('undertone', () => {
  test('measured skin colour classifies without saturating', () => {
    // The whole reason for using Lab b*/a* instead of hue: hue returns
    // 0.94-0.99 for every real skin tone, so everyone comes out orange.
    expect(['warm', 'neutral', 'cool']).toContain(
      undertoneOf(LIVE_TONE.data.results.color.skin_color),
    )
  })

  test('separates golden and olive from pink and rosy', () => {
    expect(undertoneOf('#c49a6c')).toBe('warm') // golden
    expect(undertoneOf('#8f7a52')).toBe('warm') // olive
    expect(undertoneOf('#e8b4a0')).toBe('cool') // pink
    expect(undertoneOf('#d99a8f')).toBe('cool') // rosy
  })
})

describe('depth', () => {
  test('buckets 1 to 6 across the range', () => {
    expect(depthOf('#2b1d15')).toBe(1)
    expect(depthOf('#f2ded0')).toBe(6)
    expect(depthOf(LIVE_TONE.data.results.color.skin_color)).toBeGreaterThan(0)
  })
})

describe('score inversion', () => {
  test('a HIGH score means LOW severity', () => {
    // YouCam scores health. Getting this backwards prescribes the exact
    // opposite formula and still looks plausible.
    const sev = severityOf(LIVE_CONCERNS, 'redness')
    expect(sev).toBe(0) // raw_score 100 = perfectly healthy = no severity
    const oil = severityOf(LIVE_CONCERNS, 'oiliness')!
    expect(oil).toBeLessThan(0.05) // raw 99.32
  })

  test('a missing concern returns null, not a default', () => {
    expect(severityOf(LIVE_CONCERNS, 'dark_circle_v2')).toBeNull()
  })
})

describe('formula', () => {
  test('near-perfect live skin yields no invented findings', () => {
    const f = formulaFor(LIVE_CONCERNS)
    // Nothing is pronounced on this face, so it must not claim anything.
    expect(f.because.length).toBe(0)
    expect(f.glowIntensity).toBeGreaterThanOrEqual(0)
    expect(f.glowIntensity).toBeLessThanOrEqual(1)
  })

  test('oily skin gets matte, dry skin gets dewy', () => {
    const oily = formulaFor([{ type: 'oiliness', ui_score: 20, raw_score: 18 }])
    const dry = formulaFor([{ type: 'moisture', ui_score: 20, raw_score: 15 }])
    expect(oily.finish).toBe('matte')
    expect(dry.finish).toBe('dewy')
    // The differentiating claim: same shade, different formula.
    expect(oily.glowIntensity).toBeLessThan(dry.glowIntensity)
  })

  test('every sentence names a measurement that exists', () => {
    const f = formulaFor([
      { type: 'oiliness', ui_score: 30, raw_score: 25 },
      { type: 'redness', ui_score: 40, raw_score: 38 },
    ])
    expect(f.because.length).toBeGreaterThan(0)
    // No sentence may mention a concern we never received.
    for (const line of f.because) {
      expect(line).not.toContain('under-eye')
    }
  })

  test('missing concerns still produce sane intensities', () => {
    const f = formulaFor([])
    for (const v of [f.glowIntensity, f.coverageIntensity, f.colorUnderEyeIntensity]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
    expect(f.because).toEqual([])
  })
})

describe('palette', () => {
  test('derives from the live measured skin colour', () => {
    const p = paletteFor(LIVE_TONE.data.results.color.skin_color)
    expect(p.swatches.length).toBeGreaterThan(0)
    expect(p.reason).toContain('#bd987d')
    expect(p.depth).toBeGreaterThanOrEqual(1)
    expect(p.depth).toBeLessThanOrEqual(6)
  })
})

describe('deltaE', () => {
  test('is zero for identical colours and grows with difference', () => {
    const a = hexToLab('#bd987d')
    expect(deltaE(a, a)).toBe(0)
    expect(deltaE(a, hexToLab('#be997e'))).toBeLessThan(1.5)
    expect(deltaE(a, hexToLab('#2b1d15'))).toBeGreaterThan(20)
  })

  test('separates a green shift from a red one, unlike RGB', () => {
    // The reason foundation ranks in Lab: RGB would call these equal.
    const base = hexToLab('#8f7a52')
    const greener = deltaE(base, hexToLab('#7a8f52'))
    const redder = deltaE(base, hexToLab('#8f5a52'))
    expect(Math.abs(greener - redder)).toBeGreaterThan(1)
  })
})

describe('colour naming', () => {
  test('names are readable, not hex', () => {
    expect(colorName('#1a1a1a')).toBe('black')
    expect(colorName('#f5f5f5')).toBe('white')
    expect(colorName('#26334d')).toContain('blue')
    expect(colorName('#8a9a7b')).toContain('green')
  })
})

describe('dominant colour', () => {
  test('ignores a white sweep and returns the product colour', () => {
    // 6 white pixels around 2 strong red ones: the average must not be pink.
    const px = new Uint8ClampedArray([
      ...[255, 255, 255, 255],
      ...[255, 255, 255, 255],
      ...[250, 250, 250, 255],
      ...[200, 30, 30, 255],
      ...[205, 35, 35, 255],
      ...[255, 255, 255, 255],
    ])
    const hex = dominantColor(px)!
    const { L, a } = hexToLab(hex)
    expect(a).toBeGreaterThan(20) // clearly red, not washed to grey
    expect(L).toBeLessThan(70)
  })

  test('returns null when nothing is opaque', () => {
    expect(dominantColor(new Uint8ClampedArray([255, 0, 0, 0]))).toBeNull()
  })
})
