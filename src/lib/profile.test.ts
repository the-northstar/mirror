import { expect, test, describe } from 'bun:test'
import { buildProfile, contrastOf, type ProfileInput } from './profile'
import { formulaFor, paletteFor, type ConcernRow } from './prescription'

const concern = (type: string, raw: number): ConcernRow => ({
  type, raw_score: raw, ui_score: raw,
})

/** A full reading, the shape /api/read assembles. */
function reading(over: Partial<ProfileInput> = {}): ProfileInput {
  const skinHex = over.skinHex ?? '#bd987d'
  const concerns = over.concerns ?? [
    concern('oiliness', 38), // severity 62 — the worst
    concern('redness', 74),
    concern('moisture', 88),
    concern('texture', 96), // severity 4 — the best
  ]
  return {
    skinHex,
    lipHex: '#a9585a',
    hairHex: '#2a1c15',
    eyeHex: '#4a3728',
    faceShape: 'square',
    concerns,
    palette: paletteFor(skinHex),
    formula: formulaFor(concerns),
    ...over,
  }
}

describe('contrast, the axis the scan measured and nothing read', () => {
  test('dark hair on light skin is high contrast', () => {
    // And separable from depth: this is a LIGHT face at HIGH contrast, which
    // is exactly the case a depth-only reading gets wrong.
    const c = contrastOf('#e8c9a8', '#1a1210')
    expect(c!.level).toBe('high')
  })

  test('hair close to skin is low contrast', () => {
    expect(contrastOf('#bd987d', '#a88c72')!.level).toBe('low')
  })

  test('no hair colour means no contrast reading at all', () => {
    // Not a default and not a hedge: a reading we never took produces silence.
    expect(contrastOf('#bd987d', undefined)).toBeNull()
    expect(contrastOf('#bd987d', 'not-a-hex')).toBeNull()
  })
})

describe('the profile only says what was measured', () => {
  test('every tip carries the reading that produced it', () => {
    const p = buildProfile(reading())
    expect(p.tips.length).toBeGreaterThan(2)
    for (const t of p.tips) {
      expect(t.because.length).toBeGreaterThan(0)
      expect(t.title.length).toBeGreaterThan(0)
    }
  })

  test('the summary quotes the actual numbers', () => {
    const p = buildProfile(reading())
    expect(p.summary).toContain('#bd987d')
    expect(p.summary).toContain('62%') // oiliness severity
    expect(p.summary).toContain('oiliness')
  })

  test('a missing hair colour drops the contrast fact and its tip', () => {
    const p = buildProfile(reading({ hairHex: undefined }))
    expect(p.facts.some((f) => f.label === 'Contrast')).toBe(false)
    for (const t of p.tips) expect(t.because).not.toContain('lightness')
  })

  test('a missing face shape claims no face shape', () => {
    const p = buildProfile(reading({ faceShape: undefined }))
    for (const t of p.tips) expect(t.because).not.toContain('face shape')
  })

  test('with no concerns at all it still profiles the colour, and no more', () => {
    // Colour is the one reading that always comes back. Everything the concern
    // scan would have said must simply be absent.
    const p = buildProfile(reading({ concerns: [], formula: formulaFor([]) }))
    expect(p.facts.some((f) => f.label === 'Undertone')).toBe(true)
    expect(p.works.length).toBeGreaterThan(0)
    expect(p.summary).not.toContain('%')
    for (const t of p.tips) expect(t.because).not.toContain('most pronounced')
  })
})

describe('the colour list does not argue with itself', () => {
  test('neutral colouring gets neutral reasons, not borrowed ones', () => {
    // Live: navy "complements pink-blue undertones" sat directly beside camel
    // "echoes a golden undertone", and sage claimed to calm flushed areas on a
    // shopper whose redness came back as the healthiest reading taken.
    // Neutral is decided by redness sitting level with her OWN average, so the
    // fixture has to be even rather than merely low — a low redness reading
    // lands in the warm branch, where "golden undertone" is earned.
    const p = buildProfile(reading({
      concerns: [
        concern('redness', 80), concern('oiliness', 80),
        concern('moisture', 80), concern('texture', 80),
      ],
    }))
    expect(p.works.length).toBeGreaterThan(1)
    for (const c of p.works) {
      expect(c.reason).not.toContain('flushed')
      expect(c.reason).not.toContain('pink-blue')
      expect(c.reason).not.toContain('golden undertone')
    }
  })

  test('a genuinely flushed reading still earns the redness wording', () => {
    // The wording is not banned — it has to be paid for by the measurement.
    const p = buildProfile(reading({
      concerns: [
        concern('redness', 40), concern('oiliness', 95),
        concern('moisture', 95), concern('texture', 95),
      ],
    }))
    expect(p.works.some((c) => /red|flush/i.test(c.reason))).toBe(true)
    expect(p.watch.length).toBeGreaterThan(0)
  })
})

describe('what it tells her to do', () => {
  test('the worst reading drives the routine tip', () => {
    const p = buildProfile(reading())
    const routine = p.tips.find((t) => t.because.includes('most pronounced'))
    expect(routine!.because).toContain('62%')
    expect(routine!.title).toBe('Reach for gel, not balm') // oiliness
  })

  test('a different worst reading gives different advice', () => {
    const dry = buildProfile(reading({
      concerns: [concern('moisture', 30), concern('oiliness', 95)],
    }))
    const routine = dry.tips.find((t) => t.because.includes('most pronounced'))
    expect(routine!.title).toBe('Layer damp, not dry')
  })

  test('it names something going right, not only faults', () => {
    // A report that lists only problems reads as a sales pitch. This is
    // measured on the same scale as everything else.
    const p = buildProfile(reading())
    const good = p.tips.find((t) => t.title.includes('strongest reading'))
    expect(good!.body).toContain('96 of 100')
  })

  test('muted lips and pigmented lips get opposite advice', () => {
    const muted = buildProfile(reading({ lipHex: '#a89088' }))
    const pigmented = buildProfile(reading({ lipHex: '#a02a3a' }))
    expect(muted.tips.some((t) => t.title === 'Your lips need the pigment')).toBe(true)
    expect(pigmented.tips.some((t) => t.title === 'Your lips already carry colour')).toBe(true)
  })
})

describe('the photo, as distinct from the face', () => {
  test('a poor shot is called out as the photo’s fault', () => {
    const p = buildProfile(reading({ faceQuality: { lighting: 'low', frontal: 'high', area: 'high' } }))
    expect(p.caveat).toContain('lighting was uneven')
    expect(p.caveat).toContain('rather than on you')
  })

  test('a good shot says nothing at all', () => {
    const p = buildProfile(reading({ faceQuality: { lighting: 'high', frontal: 'high', area: 'high' } }))
    expect(p.caveat).toBeNull()
  })

  test('no quality report means no claim about the photo', () => {
    expect(buildProfile(reading({ faceQuality: null })).caveat).toBeNull()
  })
})
