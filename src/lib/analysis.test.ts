import { expect, test, describe, afterEach } from 'bun:test'
import { analyse, measuredAnalysis } from './analysis'
import { buildProfile } from './profile'
import { formulaFor, paletteFor } from './prescription'

const concerns = [
  { type: 'oiliness', ui_score: 38, raw_score: 38 },
  { type: 'redness', ui_score: 74, raw_score: 74 },
  { type: 'texture', ui_score: 96, raw_score: 96 },
]
const profile = buildProfile({
  skinHex: '#bd987d',
  lipHex: '#a9585a',
  hairHex: '#2a1c15',
  faceShape: 'square',
  concerns,
  palette: paletteFor('#bd987d'),
  formula: formulaFor(concerns),
})

const realFetch = globalThis.fetch
const realKey = process.env.GEMINI_API_KEY

afterEach(() => {
  globalThis.fetch = realFetch
  if (realKey === undefined) delete process.env.GEMINI_API_KEY
  else process.env.GEMINI_API_KEY = realKey
})

function stub(body: unknown, status = 200) {
  process.env.GEMINI_API_KEY = 'test-key'
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] }),
      { status },
    )) as typeof fetch
}

describe('the measured floor', () => {
  test('with no model she still gets her analysis, labelled', async () => {
    delete process.env.GEMINI_API_KEY
    const a = await analyse(profile)
    expect(a.source).toBe('measured')
    expect(a.paragraphs[0]).toBe(profile.summary)
  })

  test('the floor does not restate the cards already on the page', async () => {
    // It sat directly above tip cards carrying the same sentences word for
    // word, which reads as filler rather than as depth.
    delete process.env.GEMINI_API_KEY
    const a = await analyse(profile)
    for (const tip of profile.tips) {
      expect(a.paragraphs.join(' ')).not.toContain(tip.body)
    }
  })

  test('the floor is never empty', () => {
    expect(measuredAnalysis(profile).paragraphs.every((p) => p.length > 0)).toBe(true)
  })

  test('an outage falls back rather than showing nothing', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    globalThis.fetch = (async () => new Response('no', { status: 500 })) as typeof fetch
    const a = await analyse(profile)
    expect(a.source).toBe('measured')
    expect(a.paragraphs[0]).toBe(profile.summary)
  })
})

describe('when a model answers', () => {
  test('its words are used and labelled as written', async () => {
    stub({ paragraphs: ['First para.', 'Second para.', 'Third para.'] })
    const a = await analyse(profile)
    expect(a.source).toBe('model')
    expect(a.paragraphs).toEqual(['First para.', 'Second para.', 'Third para.'])
  })

  test('a thin answer falls back WHOLE rather than being padded', async () => {
    // Mixing one written paragraph into the measured ones would leave the
    // label lying about where the text came from.
    stub({ paragraphs: ['Only one.'] })
    const a = await analyse(profile)
    expect(a.source).toBe('measured')
    expect(a.paragraphs[0]).toBe(profile.summary)
  })

  test('an empty or malformed answer falls back', async () => {
    stub({ paragraphs: [] })
    expect((await analyse(profile)).source).toBe('measured')
    stub({ nothing: true })
    expect((await analyse(profile)).source).toBe('measured')
  })

  test('it cannot flood the page', async () => {
    stub({ paragraphs: ['a', 'b', 'c', 'd', 'e', 'f'] })
    expect((await analyse(profile)).paragraphs).toHaveLength(3)
  })
})

describe('what the model is allowed to see', () => {
  test('it is handed the profile, never the raw scan', async () => {
    // The containment that makes this safe: it can only rephrase findings the
    // app already made, so it has nothing to invent a NEW finding from.
    let sent = ''
    process.env.GEMINI_API_KEY = 'test-key'
    globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
      sent = JSON.parse(init.body).contents[0].parts[0].text
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ paragraphs: ['a', 'b'] }) }] } }],
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    await analyse(profile)
    expect(sent).toContain(profile.summary)
    expect(sent).toContain('Use ONLY what is above')
    expect(sent).toContain('No diagnosis and no treatment')
    expect(sent).toContain('No selling')
  })
})
