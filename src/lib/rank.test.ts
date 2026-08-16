import { expect, test, describe } from 'bun:test'
import { deltaE, hexToLab, labToRgb, rgbToHex } from './color'
import { rankFoundation, rankByPalette, rankSkincare, rankGlasses, rankJewellery, SHORTLIST } from './rank'
import { paletteFor, type ConcernRow } from './prescription'
import { SNAPSHOT, namedColorHex, type Product } from './catalogue'

/** A stand-in catalogue shaped like makeup-api: many shades, uneven per brand. */
function shades(): Product[] {
  const out: Product[] = []
  // One brand with a very dense deep range, which is what collapses a naive
  // deltaE sort on deep skin.
  for (let i = 0; i < 40; i++) {
    const L = 18 + i * 0.6
    out.push(mk(`dense-${i}`, 'DenseBrand', L, 12, 14))
  }
  for (let i = 0; i < 12; i++) out.push(mk(`b-${i}`, 'BrandB', 20 + i * 3, 11, 16))
  for (let i = 0; i < 12; i++) out.push(mk(`c-${i}`, 'BrandC', 22 + i * 3.5, 14, 12))
  for (let i = 0; i < 12; i++) out.push(mk(`d-${i}`, 'BrandD', 25 + i * 4, 9, 18))
  return out
}

function mk(id: string, brand: string, L: number, a: number, b: number): Product {
  // Build a hex from Lab so the test data exercises the real conversion.
  const hex = rgbToHex(labToRgb({ L, a, b }))
  return { id, aisle: 'foundation', brand, name: 'Foundation', hex, colorName: 'brown' }
}

describe('foundation ranking', () => {
  const deepSkin = '#3a2a20'

  test('returns 12 shades for a deep reading', () => {
    const out = rankFoundation(shades(), deepSkin)
    expect(out.length).toBe(SHORTLIST)
  })

  test('every returned shade is visibly DISTINCT', () => {
    // The acceptance test: padding with shades the eye cannot separate makes
    // the menu look longer while offering nothing.
    const out = rankFoundation(shades(), deepSkin)
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        expect(deltaE(hexToLab(out[i].hex), hexToLab(out[j].hex))).toBeGreaterThanOrEqual(1.5)
      }
    }
  })

  test('one dense brand cannot take every slot', () => {
    const out = rankFoundation(shades(), deepSkin)
    const dense = out.filter((p) => p.brand === 'DenseBrand').length
    expect(dense).toBeLessThanOrEqual(4)
    expect(new Set(out.map((p) => p.brand)).size).toBeGreaterThan(1)
  })

  test('the closest shade really is closest', () => {
    const out = rankFoundation(shades(), deepSkin)
    expect(out[0].score).toBeLessThanOrEqual(out[out.length - 1].score)
    expect(out[0].reason).toContain('ΔE')
  })

  test('a short catalogue still fills what it can', () => {
    const few = shades().slice(0, 3)
    expect(rankFoundation(few, deepSkin).length).toBeLessThanOrEqual(3)
  })
})

describe('palette ranking', () => {
  test('ranks toward the palette, not toward her skin', () => {
    const palette = paletteFor('#bd987d')
    const items: Product[] = [
      { id: 'skin-ish', aisle: 'blush', brand: 'X', name: 'Skin tone', hex: '#bd987d', colorName: 'tan' },
      { id: 'palette-ish', aisle: 'blush', brand: 'X', name: 'Palette', hex: palette.swatches[0].hex, colorName: 'x' },
    ]
    const out = rankByPalette(items, palette)
    // A blush the colour of her face is no blush.
    expect(out[0].id).toBe('palette-ish')
  })
})

describe('skincare ranking', () => {
  const concerns: ConcernRow[] = [
    { type: 'oiliness', ui_score: 20, raw_score: 18 }, // severe
    { type: 'redness', ui_score: 95, raw_score: 96 }, // mild
  ]

  test('aims at the worst measured problem', () => {
    const out = rankSkincare(SNAPSHOT.skincare, concerns)
    expect(out[0].tags).toContain('oiliness')
    expect(out[0].reason).toContain('oiliness')
  })

  test('never claims to treat something unmeasured', () => {
    const out = rankSkincare(SNAPSHOT.skincare, [])
    for (const p of out) expect(p.reason).toContain('not aimed at anything')
  })
})

describe('glasses ranking', () => {
  test('uses the measured face shape when there is one', () => {
    const out = rankGlasses(SNAPSHOT.glasses, 'round')
    expect(out[0].reason).toContain('round')
    expect(out[0].tags?.some((t) => t.includes('round'))).toBe(true)
  })

  test('degrades honestly with no measurement', () => {
    const out = rankGlasses(SNAPSHOT.glasses, undefined)
    expect(out[0].reason).toContain('no face measurement')
  })
})

describe('jewellery ranking', () => {
  test('gold leads for warm, silver for cool', () => {
    const warm = rankJewellery(SNAPSHOT.jewellery, paletteFor('#c49a6c'))
    expect(warm[0].tags).toContain('gold')
    const cool = rankJewellery(SNAPSHOT.jewellery, paletteFor('#e8b4a0'))
    expect(cool[0].tags).toContain('silver')
  })
})

describe('colour naming from merchant words', () => {
  test('resolves plain and compound names', () => {
    expect(namedColorHex('Black')).toBe('#1a1a1a')
    expect(namedColorHex('Deep Forest')).toBe('#2f4230')
  })

  test('returns null rather than guessing', () => {
    // A row we cannot colour must be dropped, not defaulted.
    expect(namedColorHex('Limited Edition 3')).toBeNull()
  })
})
