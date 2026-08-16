import { expect, test, describe } from 'bun:test'
import { gatedAisles, shoppingFor, suitsAudience } from './audience'

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
