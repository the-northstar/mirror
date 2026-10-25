import { describe, expect, test } from 'bun:test'
import { deltaE, hexToLab } from './color'
import type { Product } from './catalogue'
import {
  audit,
  finishOf,
  isBase,
  LADDER,
  MATCH_DE,
  MONK,
  PANEL,
  placeDemand,
  placeFace,
  type Finish,
} from './coverage'

let n = 0
function mk(hex: string, opts: Partial<Product> & { finish?: Finish } = {}): Product {
  n += 1
  return {
    id: `p-${n}`,
    aisle: 'foundation',
    brand: 'Halcyon',
    name: 'Skin Foundation',
    hex,
    colorName: 'test',
    ...opts,
  } as Product
}

/** One base on every rung of the scale, in each finish given. */
const fullRange = (finishes: Array<Finish | undefined>) =>
  LADDER.flatMap((r) => finishes.map((f) => mk(r.hex, f ? { finish: f } : {})))

describe('reading a finish', () => {
  test("a merchant's declaration beats anything the name says", () => {
    expect(finishOf({ name: 'Radiant Glow Foundation', finish: 'matte' })).toEqual({ finish: 'matte', source: 'declared' })
  })

  test('the name is read before the description', () => {
    expect(finishOf({ name: 'Soft Matte Longwear Foundation', tags: ['a luminous glow'] }).finish).toBe('matte')
  })

  test('semi-matte is natural, not matte', () => {
    expect(finishOf({ name: 'Semi-Matte Foundation' }).finish).toBe('natural')
    expect(finishOf({ name: 'Satin Finish Base' }).finish).toBe('natural')
  })

  test('a name naming two finishes defers to the description', () => {
    expect(finishOf({ name: 'Satin Matte Foundation', tags: ['for a dewy, luminous look'] })).toEqual({
      finish: 'dewy',
      source: 'description',
    })
  })

  test('benefit words count only when they agree', () => {
    expect(finishOf({ name: 'Foundation', tags: ['An oil-free formula'] })).toEqual({ finish: 'matte', source: 'hint' })
    expect(finishOf({ name: 'Foundation', tags: ['Oil-free and hydrating'] }).finish).toBeNull()
  })

  test('saying nothing stays unknown rather than guessed', () => {
    expect(finishOf({ name: 'Foundation', tags: ['Buildable coverage in 40 shades'] })).toEqual({ finish: null, source: 'none' })
  })
})

describe('what counts as a base', () => {
  test('powder foundations do, setting powders and concealers do not', () => {
    expect(isBase({ aisle: 'foundation', name: 'Pressed Powder Foundation' })).toBe(true)
    expect(isBase({ aisle: 'foundation', name: 'Invisible Setting Powder' })).toBe(false)
    expect(isBase({ aisle: 'foundation', name: 'Stretch Concealer' })).toBe(false)
    expect(isBase({ aisle: 'lipstick', name: 'Foundation Lip' })).toBe(false)
  })
})

describe('the panel', () => {
  test('each skin type gets the finish the shopper side would prescribe', () => {
    const needs = Object.fromEntries(PANEL.filter((s) => s.at === 1).map((s) => [s.skin, s.need]))
    expect(needs).toEqual({ oily: 'matte', balanced: 'natural', dry: 'dewy' })
  })

  test("the ladder keeps every one of Monk's published tones", () => {
    for (const m of MONK) expect(LADDER.find((r) => r.at === m.tone)?.hex).toBe(m.hex)
  })

  test('no colour on the scale is more than half a match from a rung', () => {
    for (let i = 1; i < LADDER.length; i++) {
      expect(deltaE(LADDER[i - 1].lab, LADDER[i].lab)).toBeLessThanOrEqual(MATCH_DE)
    }
  })
})

describe('auditing a range', () => {
  test('a range on every rung in every finish serves the whole panel', () => {
    const a = audit(fullRange(['matte', 'natural', 'dewy']))
    expect(a.served).toBe(a.seats)
    expect(a.shadeCoverage).toBe(1)
    expect(a.findings.filter((f) => f.kind === 'gap')).toHaveLength(0)
    expect(a.findings[0].title).toBe('Every point on the scale is served')
  })

  test('a light-only range is told exactly what to stock at the deep end', () => {
    const light = LADDER.filter((r) => r.at <= 5).map((r) => mk(r.hex, { finish: 'natural' }))
    const a = audit(light)
    const gap = a.findings.find((f) => f.title.startsWith('No shade'))!
    expect(gap.kind).toBe('gap')
    expect(gap.title).toContain('to 10')
    expect(gap.action).toContain('#292420')
    expect(a.cells.filter((c) => c.at === 10).every((c) => c.verdict === 'no-shade')).toBe(true)
    expect(a.shadeCoverage).toBeLessThan(0.5)
  })

  test('a matte-only range covers every colour and still fails dry skin', () => {
    const a = audit(fullRange(['matte']))
    expect(a.shadeCoverage).toBe(1)
    expect(a.formulaCoverage).toEqual({ oily: 1, balanced: 0, dry: 0 })
    const titles = a.findings.map((f) => f.title)
    expect(titles).toContain('Dry skin: no dewy match on 100% of the scale')
    expect(titles).toContain('Balanced skin: no natural match on 100% of the scale')
    expect(titles.some((t) => t.startsWith('No shade'))).toBe(false)
  })

  test('an unstated finish is reported as unstated, never as wrong', () => {
    const a = audit(fullRange([undefined]))
    expect(a.cells.every((c) => c.verdict === 'finish-unstated')).toBe(true)
    expect(a.findings.some((f) => f.title.includes('no dewy match'))).toBe(false)
    const warn = a.findings.find((f) => f.title.includes('name no finish'))!
    expect(warn.kind).toBe('warn')
    expect(warn.action).toContain('finish column')
  })

  test('setting powders are set aside, not audited as shades', () => {
    const a = audit([mk('#f6ede4', { name: 'Translucent Setting Powder' })])
    expect(a.catalogue).toMatchObject({ base: 0, setAside: 1 })
    expect(a.findings[0].title).toBe('No foundation to audit')
  })

  test('pale blushes are flagged where they stop reading as a flush', () => {
    const blushes = ['#f4b6c2', '#f2a7b5', '#efb0a8', '#f6c1c9'].map((hex) => mk(hex, { aisle: 'blush', name: 'Blush' }))
    const a = audit([...fullRange(['matte', 'natural', 'dewy']), ...blushes])
    const thin = a.findings.find((f) => f.title.startsWith('Blush barely reads'))!
    expect(thin.title).toContain('10')
    expect(a.tones.find((t) => t.tone === 1)!.blush.flush).toBeGreaterThan(0)
    expect(a.tones.find((t) => t.tone === 10)!.blush.flush).toBe(0)
  })

  test('pale nude lipsticks are counted as chalky on deep skin only', () => {
    const nudes = ['#e8c4b8', '#ecc9bd', '#e5c0b2', '#efcfc3'].map((hex) => mk(hex, { aisle: 'lipstick', name: 'Lip' }))
    const a = audit([...fullRange(['natural']), ...nudes])
    expect(a.tones.find((t) => t.tone === 1)!.chalkyLips).toBe(0)
    expect(a.tones.find((t) => t.tone === 10)!.chalkyLips).toBe(4)
    expect(a.findings.some((f) => f.title === '4 of 4 lipsticks read chalky on deep skin')).toBe(true)
  })

  test('the same catalogue always produces the same report', () => {
    const rows = [...fullRange(['matte']), mk('#3a312a', { finish: 'dewy' })]
    expect(audit(rows)).toEqual(audit(rows))
  })
})

describe('real faces', () => {
  const light = LADDER.filter((r) => r.at <= 5).map((r) => mk(r.hex, { finish: 'matte', shadeName: `Rung ${r.at}` }))
  const dry = [{ type: 'moisture', ui_score: 30, raw_score: 30 }]

  test('a face is placed with the finish its own concerns prescribe', () => {
    const p = placeFace(light, '#3a2a20', dry)
    expect(p.need).toBe('dewy')
    expect(p.verdict).toBe('no-shade')
    // The closest the range gets is its deepest shade.
    const deepest = light.reduce((a, b) => (hexToLab(b.hex).L < hexToLab(a.hex).L ? b : a))
    expect(p.closest?.id).toBe(deepest.id)
  })

  test('demand is counted by verdict, deepest misses first, with no identity kept', () => {
    const report = placeDemand(light, [
      { skinHex: '#f3e7db', finish: 'matte' },
      { skinHex: '#f3e7db', finish: 'dewy' },
      { skinHex: '#3a312a', finish: 'matte' },
      { skinHex: '#825c43', finish: 'matte' },
    ])
    expect(report.count).toBe(4)
    expect(report.byVerdict).toEqual({ served: 1, 'wrong-finish': 1, 'finish-unstated': 0, 'no-shade': 2 })
    expect(report.missed[0].skinHex).toBe('#3a312a')
    expect(Object.keys(report.missed[0]).sort()).toEqual(['dE', 'finish', 'skinHex', 'verdict'])
  })
})

describe('an uploaded range', () => {
  test('is held to the same standard as a pushed row, and stored nowhere', async () => {
    const { csvToRows, rowsToCatalogue } = await import('./feed')
    const rows = csvToRows(
      [
        'name,aisle,hex,colour,shade,finish',
        'Skin Foundation,foundation,#a07e56,,110,Dewy',
        'Skin Foundation,foundation,,camel,120,',
        'Mystery Base,foundation,,,130,',
        'Linen Shirt,clothes,#f2f3f5,,,',
        'Petal Blush,blush,#e8a0a8,,,',
      ].join('\n'),
    )
    const read = rowsToCatalogue(rows)
    expect(read.products.map((p) => [p.aisle, p.shadeName, p.finish])).toEqual([
      ['foundation', '110', 'dewy'],
      ['foundation', '120', undefined],
      ['blush', undefined, undefined],
    ])
    // A colour word is resolved; a row with no colour is refused, with a reason.
    expect(read.products[1].hex).toMatch(/^#[0-9a-f]{6}$/)
    expect(read.rejected).toEqual([{ name: 'Mystery Base', why: 'No colour we could resolve.' }])
    // The shirt is counted, not silently lost.
    expect(read.skipped).toBe(1)
  })
})
