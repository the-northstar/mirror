import { expect, test, describe } from 'bun:test'
import { deltaE, hexToLab, labToRgb, rgbToHex } from './color'
import {
  faceRuleFor,
  rankBlush,
  rankClothes,
  rankFoundation,
  rankHair,
  rankLipstick,
  rankSkincare,
  SHORTLIST,
  type Shopper,
} from './rank'
import { paletteFor, type ConcernRow } from './prescription'
import { SNAPSHOT, namedColorHex, type Aisle, type Product } from './catalogue'

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

  test('returns the whole distinct shelf for a deep reading', () => {
    // No longer capped at 12: the shopper browses everything and the UI
    // paginates. What matters is that nothing distinct is thrown away.
    const out = rankFoundation(shades(), deepSkin)
    expect(out.length).toBeGreaterThan(12)
    expect(out.length).toBeLessThanOrEqual(SHORTLIST)
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
    // The cap orders the shelf rather than truncating it, so the dense brand
    // must not take the opening slots.
    const dense = out.slice(0, 12).filter((p) => p.brand === 'DenseBrand').length
    expect(dense).toBeLessThanOrEqual(4)
    expect(new Set(out.map((p) => p.brand)).size).toBeGreaterThan(1)
  })

  test('the closest shade really is closest', () => {
    const out = rankFoundation(shades(), deepSkin)
    expect(out[0].score).toBeLessThanOrEqual(out[out.length - 1].score)
    expect(out[0].reason).toContain('ΔE')
  })

  test('the message grades the distance instead of repeating itself', () => {
    // One sentence for every distance is not a reading: the old wording was
    // printed identically at 4.5 ΔE and 22.1 ΔE, and only one of those is a
    // shade she can wear.
    const shelf: Product[] = [
      { id: 'exact', aisle: 'foundation', brand: 'A', name: 'Exact', hex: deepSkin, colorName: 'brown' },
      { id: 'far', aisle: 'foundation', brand: 'B', name: 'Far', hex: '#f0e8e0', colorName: 'pale' },
    ]
    const out = rankFoundation(shelf, deepSkin)
    expect(out.find((p) => p.id === 'exact')!.reason).toContain('closer than the eye separates')
    expect(out.find((p) => p.id === 'far')!.reason).toContain('different colour on your face')
    // And it names the colour it was matched against, not just the gap.
    expect(out[0].reason).toContain(deepSkin)
  })

  test('a short catalogue still fills what it can', () => {
    const few = shades().slice(0, 3)
    expect(rankFoundation(few, deepSkin).length).toBeLessThanOrEqual(3)
  })
})

/* -- Clothes, lipstick, blush -------------------------------------------- */

/** One product per hex, each its own brand so the spread pass cannot reorder. */
function swatchShelf(aisle: Aisle, hexes: Record<string, string>): Product[] {
  return Object.entries(hexes).map(([id, hex]) => ({
    id, aisle, brand: id, name: id, hex, colorName: id,
  }))
}

const shopperFor = (skinHex: string, over: Partial<Shopper> = {}): Shopper => ({
  skinHex,
  palette: paletteFor(skinHex),
  concerns: [],
  ...over,
})

describe('clothes ranking', () => {
  const skin = '#bd987d' // mid, warm

  test('a neutral is never scored as a clash', () => {
    // The bug this replaces: white and grey carry no undertone, but were
    // scored as distance to the nearest of four coloured wardrobe swatches,
    // so a white shirt lost to anything vaguely seasonal.
    const out = rankClothes(
      swatchShelf('clothes', { white: '#f2f3f5', clash: '#1f4d38' }),
      shopperFor('#3a2a20'), // Deep Autumn: no neutral in its four swatches
    )
    expect(out[0].id).toBe('white')
    expect(out.find((p) => p.id === 'white')!.reason).toContain('neutral')
  })

  test('a garment at her own lightness is marked down', () => {
    // Same hue family, same undertone: only the wash-out separates them, and
    // a straight ΔE against a swatch cannot express it.
    const out = rankClothes(
      swatchShelf('clothes', { washedOut: '#bd987d', separated: '#6b4a2f' }),
      shopperFor(skin),
    )
    expect(out[0].id).toBe('separated')
    expect(out.find((p) => p.id === 'washedOut')!.reason).toContain('washed-out')
  })

  test('measured redness demotes red and promotes its complement', () => {
    const flushed = shopperFor(skin, {
      concerns: [{ type: 'redness', ui_score: 30, raw_score: 25 }],
    })
    const shelf = swatchShelf('clothes', { scarlet: '#c8322d', petrol: '#2f5d62' })
    const out = rankClothes(shelf, flushed)
    expect(out[0].id).toBe('petrol')
    expect(out.find((p) => p.id === 'scarlet')!.reason).toContain('redness')

    // And with no redness measured, the shelf is not silently restricted:
    // the app must never act on a reading it did not take.
    const calm = rankClothes(shelf, shopperFor(skin))
    expect(calm.find((p) => p.id === 'scarlet')!.reason).not.toContain('redness')
  })
})

describe('lipstick ranking', () => {
  const shopper = shopperFor('#e0b68f', { lipHex: '#a9585a' })

  test('a colour no face wears as lipstick loses to one it does', () => {
    // The headline bug: Olive is a swatch in the Warm Spring palette, so an
    // olive lipstick used to rank above a brick red for a warm shopper.
    const out = rankLipstick(
      swatchShelf('lipstick', { olive: '#6b6b3a', brick: '#a33b2a' }),
      shopper,
    )
    expect(out[0].id).toBe('brick')
    expect(out.find((p) => p.id === 'olive')!.reason).toContain('read as lipstick')
  })

  test('a shade the colour of her own lips is marked down', () => {
    const out = rankLipstick(
      swatchShelf('lipstick', { invisible: '#a9585a', shifts: '#8c2f3f' }),
      shopper,
    )
    expect(out[0].id).toBe('shifts')
    expect(out.find((p) => p.id === 'invisible')!.reason).toContain('barely show')
  })

  test('neutral colouring is never told a shade leans wrong', () => {
    // It takes both sides of the arc by definition, so the lean is scored
    // finely enough to order the shelf and never reported as a finding.
    const neutral = shopperFor('#bd987d', { lipHex: '#a9585a' })
    expect(neutral.palette.undertone).toBe('neutral')
    const out = rankLipstick(
      swatchShelf('lipstick', { coral: '#e0705f', berry: '#7d2b45', brick: '#a33b2a' }),
      neutral,
    )
    for (const p of out) expect(p.reason).not.toContain('leans away')
    // Still ordered, though: a faint gradient is what stops the tie.
    expect(new Set(out.map((p) => p.score.toFixed(3))).size).toBe(3)
  })

  test('an unmeasured lip colour is not invented', () => {
    // No lipHex means the payoff term is skipped, not defaulted — the reason
    // must not claim a shift from a reading that was never taken.
    const out = rankLipstick(
      swatchShelf('lipstick', { brick: '#a33b2a' }),
      shopperFor('#e0b68f'),
    )
    expect(out[0].reason).not.toContain('ΔE')
  })
})

describe('a shelf is ordered, not merely filtered', () => {
  // The failure a penalty-only ranker walks into: everything acceptable scores
  // zero, so the top of the shelf is whichever feed answered first. Measured
  // live, 485 of 500 lipsticks tied — barely better than no ranking at all.
  const spreadOf = (list: Array<{ score: number }>) =>
    new Set(list.map((p) => p.score.toFixed(2))).size

  test('acceptable lipsticks are still ranked against each other', () => {
    const shelf = swatchShelf('lipstick', {
      coral: '#e0705f', brick: '#a33b2a', berry: '#7d2b45',
      rose: '#c96a72', nude: '#b98a7a', plum: '#5b2c4e',
    })
    const out = rankLipstick(shelf, shopperFor('#e0b68f', { lipHex: '#a9585a' }))
    expect(spreadOf(out)).toBe(shelf.length)
  })

  test('acceptable blushes are still ranked against each other', () => {
    const shelf = swatchShelf('blush', {
      peach: '#e8a58c', rose: '#c9697a', coral: '#e0705f',
      berry: '#a34a63', pink: '#dda0ad',
    })
    const out = rankBlush(shelf, shopperFor('#bd987d'))
    expect(spreadOf(out)).toBe(shelf.length)
  })

  test('one colour cannot open a shelf three times', () => {
    // Live feeds carry the same measured blue as a suit, a sport coat and a
    // dinner plate. Three rows of one colour is one recommendation printed
    // three times, so the extras are pushed down rather than shown up top.
    const same = Array.from({ length: 5 }, (_, i) => ({
      id: `same-${i}`, aisle: 'clothes' as Aisle, brand: `Brand${i}`,
      name: 'Blue thing', hex: '#2f5d8f', colorName: 'blue',
    }))
    const out = rankClothes(
      [...same, { id: 'other', aisle: 'clothes', brand: 'Z', name: 'Teal', hex: '#2f5d62', colorName: 'teal' }],
      shopperFor('#bd987d'),
    )
    // Everything still appears — it is reordered, never truncated.
    expect(out.length).toBe(6)
    expect(out.slice(0, 3).filter((p) => p.hex === '#2f5d8f').length).toBeLessThanOrEqual(2)
  })
})

describe('blush ranking', () => {
  const skin = '#bd987d'

  test('a blush the colour of her face is no blush', () => {
    const out = rankBlush(
      swatchShelf('blush', { skinToned: skin, flush: '#c9697a' }),
      shopperFor(skin),
    )
    expect(out[0].id).toBe('flush')
    expect(out.find((p) => p.id === 'skinToned')!.reason).toContain('disappear')
  })

  test('bounded from the other side too', () => {
    // The old scorer could only express "too close". A blush far from her skin
    // sits ON the face rather than in it, and that is also a failure.
    const out = rankBlush(
      swatchShelf('blush', { stripe: '#ff1744', flush: '#c9697a' }),
      shopperFor(skin),
    )
    expect(out[0].id).toBe('flush')
    expect(out.find((p) => p.id === 'stripe')!.reason).toContain('sits on the face')
  })

  test('a wardrobe colour is not a flush', () => {
    const out = rankBlush(
      swatchShelf('blush', { forest: '#1f4d38', flush: '#c9697a' }),
      shopperFor(skin),
    )
    expect(out[0].id).toBe('flush')
    expect(out.find((p) => p.id === 'forest')!.reason).toContain('read as a flush')
  })
})

describe('hair ranking against the measured face shape', () => {
  const styles = (titles: string[]) =>
    titles.map((name) => ({
      id: name, aisle: 'hair' as Aisle, brand: 'Female', name,
      hex: '#e8e4dd', colorName: 'neutral', score: 0, reason: '',
    }))

  test('a round reading prefers length over a chin-length bob', () => {
    // Face shape was measured, displayed and sent, then dropped: this aisle
    // scored every style 0 and showed them in catalogue order.
    const out = rankHair(styles(['Blunt Bob', 'Long Layers']), 'round')
    expect(out[0].name).toBe('Long Layers')
    expect(out[0].reason).toContain('round face')
  })

  test('a square reading prefers waves over blunt straight', () => {
    const out = rankHair(styles(['Sleek Straight', 'S-Wave Brunette']), 'square')
    expect(out[0].name).toBe('S-Wave Brunette')
  })

  test('an oblong reading prefers a fringe over more length', () => {
    const out = rankHair(styles(['Long Braids', 'Textured Comma']), 'oblong')
    expect(out[0].name).toBe('Textured Comma')
  })

  test('YouCam’s wording is normalised', () => {
    // 'Long' and 'Rectangle' are the same shape under different names.
    expect(faceRuleFor('Long')?.key).toBe('oblong')
    expect(faceRuleFor('  HEART ')?.key).toBe('heart')
    expect(faceRuleFor('inverted_triangle')?.key).toBe('heart')
  })

  test('an oval reading claims no correction it did not make', () => {
    // Oval carries everything, so inventing a preference to sound calculated
    // would be the exact failure the reasons exist to avoid.
    const out = rankHair(styles(['Blunt Bob', 'Long Layers']), 'oval')
    expect(new Set(out.map((s) => s.score))).toEqual(new Set([0]))
    for (const s of out) expect(s.reason).toContain('without needing correction')
  })

  test('no face shape means no claim, and it says so', () => {
    const out = rankHair(styles(['Blunt Bob', 'Long Layers']), undefined)
    for (const s of out) expect(s.reason).toContain('did not return a face shape')
    expect(faceRuleFor('Trapezoid')).toBeNull()
  })

  test('an unrecognised shape is not guessed at', () => {
    const out = rankHair(styles(['Blunt Bob']), 'Trapezoid')
    expect(out[0].score).toBe(0)
    expect(out[0].reason).toContain('did not return a face shape')
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

  test('it says how pronounced, not just what', () => {
    // "Targets redness" reads the same whether hers measured 4% or 82%, and
    // only one of those is a reason to buy anything.
    const out = rankSkincare(SNAPSHOT.skincare, concerns)
    expect(out[0].reason).toContain('82%') // oiliness: raw 18 -> severity 82
    expect(out[0].reason).toContain('your scan read')
  })

  test('never claims to treat something unmeasured', () => {
    const out = rankSkincare(SNAPSHOT.skincare, [])
    for (const p of out) expect(p.reason).toContain('not aimed at anything')
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
