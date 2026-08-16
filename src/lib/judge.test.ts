import { expect, test, describe, afterEach } from 'bun:test'
import { judge, PICKS_PER_AISLE } from './judge'
import type { Ranked } from './rank'

/** A ranked aisle of n rows, ids shade-0..n-1. */
const aisle = (prefix: string, n: number): Ranked[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i}`,
    aisle: 'lipstick',
    brand: 'B',
    name: `Shade ${i}`,
    hex: '#a33b2a',
    colorName: 'red',
    score: i,
    reason: `colour match ${i}`,
  }))

const CONTEXT = { undertone: 'warm', season: 'Warm Spring', finish: 'dewy', because: [] }

const realFetch = globalThis.fetch
const realKey = process.env.GEMINI_API_KEY

afterEach(() => {
  globalThis.fetch = realFetch
  if (realKey === undefined) delete process.env.GEMINI_API_KEY
  else process.env.GEMINI_API_KEY = realKey
})

/** Answer as Gemini would, with whatever picks the test wants to try. */
function stubModel(picks: unknown[], together = 'A single look.') {
  process.env.GEMINI_API_KEY = 'test-key'
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ picks, together }) }] } }],
      }),
      { status: 200 },
    )) as typeof fetch
}

describe('without a model', () => {
  test('the shopper still gets a full set, labelled as matches', () => {
    delete process.env.GEMINI_API_KEY
    return judge({ lipstick: aisle('lip', 20) }, CONTEXT).then((v) => {
      expect(v.picks.lipstick).toHaveLength(PICKS_PER_AISLE)
      // Never dressed up as advice: an outage changes where the picks came
      // from, not how many there are.
      for (const p of v.picks.lipstick) expect(p.source).toBe('match')
      expect(v.picks.lipstick.map((p) => p.rank)).toEqual([1, 2, 3, 4, 5, 6])
      // And the one claim we do not measure stays unsaid rather than templated.
      expect(v.together).toBe('')
    })
  })

  test('a short aisle is not padded to reach the count', () => {
    delete process.env.GEMINI_API_KEY
    return judge({ lipstick: aisle('lip', 2) }, CONTEXT).then((v) => {
      expect(v.picks.lipstick).toHaveLength(2)
    })
  })
})

describe('with a model', () => {
  test('its picks are used, in the order it gave them', async () => {
    stubModel([
      { aisle: 'lipstick', productId: 'lip-3', reason: 'Warm brick.' },
      { aisle: 'lipstick', productId: 'lip-1', reason: 'Softer daytime option.' },
    ])
    const v = await judge({ lipstick: aisle('lip', 20) }, CONTEXT)
    expect(v.picks.lipstick.map((p) => p.productId)).toEqual(['lip-3', 'lip-1'])
    expect(v.picks.lipstick.map((p) => p.rank)).toEqual([1, 2])
    expect(v.picks.lipstick[0].source).toBe('model')
    expect(v.together).toBe('A single look.')
  })

  test('a product it was never shown is refused', async () => {
    // Verified against the shortlist it was OFFERED, not merely the catalogue.
    stubModel([
      { aisle: 'lipstick', productId: 'lip-2', reason: 'Real.' },
      { aisle: 'lipstick', productId: 'invented-99', reason: 'Not on the list.' },
    ])
    const v = await judge({ lipstick: aisle('lip', 20) }, CONTEXT)
    expect(v.picks.lipstick.map((p) => p.productId)).toEqual(['lip-2'])
  })

  test('the same product twice does not take two slots', async () => {
    // Asked for six, a model will repeat an id to reach the count. That would
    // show one product twice and cost the aisle a real recommendation.
    stubModel([
      { aisle: 'lipstick', productId: 'lip-0', reason: 'Best.' },
      { aisle: 'lipstick', productId: 'lip-0', reason: 'Best again.' },
      { aisle: 'lipstick', productId: 'lip-1', reason: 'Second.' },
    ])
    const v = await judge({ lipstick: aisle('lip', 20) }, CONTEXT)
    expect(v.picks.lipstick.map((p) => p.productId)).toEqual(['lip-0', 'lip-1'])
  })

  test('it cannot return more than the aisle allows', async () => {
    stubModel(
      Array.from({ length: 10 }, (_, i) => ({
        aisle: 'lipstick', productId: `lip-${i}`, reason: `Pick ${i}.`,
      })),
    )
    const v = await judge({ lipstick: aisle('lip', 20) }, CONTEXT)
    expect(v.picks.lipstick).toHaveLength(PICKS_PER_AISLE)
  })

  test('an aisle it skipped keeps its colour matches', async () => {
    // Per aisle, not per response: answering for one aisle must not cost the
    // other its recommendations.
    stubModel([{ aisle: 'lipstick', productId: 'lip-0', reason: 'Only this one.' }])
    const v = await judge(
      { lipstick: aisle('lip', 20), blush: aisle('blush', 20) },
      CONTEXT,
    )
    expect(v.picks.lipstick[0].source).toBe('model')
    expect(v.picks.blush).toHaveLength(PICKS_PER_AISLE)
    for (const p of v.picks.blush) expect(p.source).toBe('match')
  })

  test('an outage still returns a full, honestly labelled set', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    globalThis.fetch = (async () => new Response('nope', { status: 500 })) as typeof fetch
    const v = await judge({ lipstick: aisle('lip', 20) }, CONTEXT)
    expect(v.picks.lipstick).toHaveLength(PICKS_PER_AISLE)
    for (const p of v.picks.lipstick) expect(p.source).toBe('match')
    expect(v.together).toBe('')
  })
})
