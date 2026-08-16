import type { Ranked } from './rank'

/**
 * The LLM is a re-ranker, never a retriever.
 *
 * Code narrows each aisle to 12; the model picks one and writes a line. The
 * shortlist exists as much for the prompt as for accuracy: 1300 foundation
 * shades do not fit in a request, and a model asked to choose from a list it
 * cannot see invents product ids.
 */

export interface Pick {
  productId: string
  reason: string
  /** Labelled so a fallback is never passed off as advice. */
  source: 'model' | 'match'
}

export interface Verdict {
  picks: Record<string, Pick>
  /** How the picks work together. Empty when no model answered. */
  together: string
}

const MODEL = 'gemini-2.0-flash'

/**
 * Choose one product per aisle.
 *
 * With no model configured, the top colour match wins and is labelled as such.
 * The "how these work together" line stays EMPTY rather than templated: a
 * hand-written "these work beautifully together" is the app inventing the one
 * claim it does not measure.
 */
export async function judge(
  shortlists: Record<string, Ranked[]>,
  context: { undertone: string; season: string; finish: string; because: string[] },
  signal?: AbortSignal,
): Promise<Verdict> {
  const fallback = topMatches(shortlists)
  const key = process.env.GEMINI_API_KEY
  if (!key) return { picks: fallback, together: '' }

  try {
    const body = {
      contents: [{ parts: [{ text: prompt(shortlists, context) }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
    }
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      },
    )
    if (!res.ok) throw new Error(`gemini ${res.status}`)

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) throw new Error('empty completion')

    const parsed = JSON.parse(text) as {
      picks?: Array<{ aisle: string; productId: string; reason: string }>
      together?: string
    }

    const picks = { ...fallback }
    for (const p of parsed.picks ?? []) {
      const shortlist = shortlists[p.aisle]
      if (!shortlist) continue
      // Verify against the shortlist it was OFFERED, not merely against the
      // catalogue: a real product it was never shown is also wrong.
      const found = shortlist.find((s) => s.id === p.productId)
      if (!found) {
        console.warn(`[judge] hallucinated id for ${p.aisle}: ${p.productId}`)
        continue
      }
      picks[p.aisle] = {
        productId: found.id,
        reason: p.reason?.trim() || found.reason,
        source: 'model',
      }
    }
    return { picks, together: parsed.together?.trim() ?? '' }
  } catch (err) {
    // A model outage takes the same path, quietly; the shopper still gets a
    // full set of recommendations.
    console.warn('[judge] falling back to colour match:', (err as Error).message)
    return { picks: fallback, together: '' }
  }
}

function topMatches(shortlists: Record<string, Ranked[]>): Record<string, Pick> {
  const out: Record<string, Pick> = {}
  for (const [aisle, list] of Object.entries(shortlists)) {
    if (!list.length) continue
    out[aisle] = { productId: list[0].id, reason: list[0].reason, source: 'match' }
  }
  return out
}

function prompt(
  shortlists: Record<string, Ranked[]>,
  ctx: { undertone: string; season: string; finish: string; because: string[] },
): string {
  const aisles = Object.entries(shortlists)
    .map(([aisle, list]) => {
      const rows = list
        .slice(0, 12)
        .map((p) => `  ${p.id} | ${p.brand} ${p.name}${p.shadeName ? ` (${p.shadeName})` : ''} | ${p.colorName}`)
        .join('\n')
      return `${aisle}:\n${rows}`
    })
    .join('\n\n')

  return `You are a personal shopper. A skin scan measured this shopper:
- undertone: ${ctx.undertone}
- palette: ${ctx.season}
- prescribed finish: ${ctx.finish}
${ctx.because.map((b) => `- ${b}`).join('\n')}

Choose EXACTLY ONE product per category from the lists below. You may only use
ids that appear in these lists. Do not invent ids.

${aisles}

Reply as JSON:
{"picks":[{"aisle":"<category>","productId":"<id from the list>","reason":"<one sentence naming the measurement that justifies it>"}],
 "together":"<one sentence on how the picks work together>"}`
}
