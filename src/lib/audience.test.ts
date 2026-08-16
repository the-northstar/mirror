import { expect, test, describe } from 'bun:test'
import {
  audienceOfCategory,
  gatedAisles,
  groupByAudience,
  shoppingFor,
  suitsAudience,
} from './audience'

describe('who the shelf is for', () => {
  test('the declared answer outranks the detected one', () => {
    // The point of the control: a misread costs one tap, not a hidden aisle.
    expect(shoppingFor('men', 'female')).toBe('men')
    expect(shoppingFor('women', 'male')).toBe('women')
  })

  test('detection only fills a blank', () => {
    expect(shoppingFor(undefined, 'female')).toBe('women')
    expect(shoppingFor(undefined, 'male')).toBe('men')
  })

  test('nothing measured and nothing said splits nothing', () => {
    expect(shoppingFor()).toBe('everything')
    expect(shoppingFor(undefined, 'unknown')).toBe('everything')
  })

  test('declining to answer is an answer, not a blank', () => {
    // 'other' must not fall through to the detector: that would overrule the
    // shopper with the guess they just declined.
    expect(shoppingFor('other', 'female')).toBe('everything')
  })
})

describe('filtering the shelf', () => {
  test('an unlabelled row suits everyone', () => {
    // Nearly the whole catalogue is unlabelled; defaulting these to hidden
    // would empty the shop rather than tailor it.
    expect(suitsAudience({}, 'men')).toBe(true)
    expect(suitsAudience({ audience: 'unisex' }, 'women')).toBe(true)
  })

  test('an explicitly cut row is filtered', () => {
    expect(suitsAudience({ audience: 'women' }, 'men')).toBe(false)
    expect(suitsAudience({ audience: 'men' }, 'men')).toBe(true)
  })

  test('everything means everything', () => {
    expect(suitsAudience({ audience: 'women' }, 'everything')).toBe(true)
    expect(suitsAudience({ audience: 'men' }, 'everything')).toBe(true)
  })
})

describe('hair categories', () => {
  test('reads YouCam’s own label rather than inferring one', () => {
    // The live catalogue files all 116 styles under exactly these two.
    expect(audienceOfCategory('Male')).toBe('men')
    expect(audienceOfCategory('Female')).toBe('women')
  })

  test('an unrecognised category is unisex, not a guess', () => {
    expect(audienceOfCategory('Braids')).toBe('unisex')
    expect(audienceOfCategory(undefined)).toBe('unisex')
  })

  test('a declared shelf gets only its own styles', () => {
    const styles = [
      { id: 'a', audience: audienceOfCategory('Male') },
      { id: 'b', audience: audienceOfCategory('Female') },
    ]
    expect(styles.filter((s) => suitsAudience(s, 'men')).map((s) => s.id)).toEqual(['a'])
    expect(styles.filter((s) => suitsAudience(s, 'women')).map((s) => s.id)).toEqual(['b'])
  })
})

describe('grouping rather than interleaving', () => {
  const shelf = [
    { id: 'f1', audience: 'women' },
    { id: 'm1', audience: 'men' },
    { id: 'f2', audience: 'women' },
    { id: 'u1', audience: 'unisex' },
    { id: 'm2', audience: 'men' },
  ]

  test('the read side leads and neither set is interleaved', () => {
    expect(groupByAudience(shelf, 'male').map((r) => r.id)).toEqual(
      ['m1', 'm2', 'f1', 'f2', 'u1'],
    )
    expect(groupByAudience(shelf, 'female').map((r) => r.id)).toEqual(
      ['f1', 'f2', 'm1', 'm2', 'u1'],
    )
  })

  test('nothing is dropped — this only regroups', () => {
    expect(groupByAudience(shelf, 'male')).toHaveLength(shelf.length)
  })

  test('order within a block is the catalogue’s own', () => {
    // Stable, so regrouping cannot silently re-rank what it regroups.
    expect(groupByAudience(shelf, 'male').slice(0, 2).map((r) => r.id)).toEqual(['m1', 'm2'])
  })

  test('with nothing read, the shelf is left exactly as it came', () => {
    expect(groupByAudience(shelf)).toEqual(shelf)
    expect(groupByAudience(shelf, 'unknown')).toEqual(shelf)
  })
})

describe('folded aisles', () => {
  test('colour cosmetics are folded away for a men’s shelf', () => {
    expect(gatedAisles('men')).toContain('lipstick')
    expect(gatedAisles('men')).toContain('blush')
  })

  test('foundation and skincare are never folded', () => {
    // They are not gendered products, and a man who scanned for his skin
    // condition came for exactly these.
    expect(gatedAisles('men')).not.toContain('foundation')
    expect(gatedAisles('men')).not.toContain('skincare')
    expect(gatedAisles('men')).not.toContain('clothes')
  })

  test('nothing is folded for anyone else', () => {
    expect(gatedAisles('women')).toEqual([])
    expect(gatedAisles('everything')).toEqual([])
  })
})
