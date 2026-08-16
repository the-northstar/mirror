import type { Ranked } from './rank'

/**
 * The LLM is a re-ranker, never a retriever.
 *
 * Code narrows each aisle to 12; the model picks six of them and writes a line
 * for each. The shortlist exists as much for the prompt as for accuracy: 1300
 * foundation shades do not fit in a request, and a model asked to choose from
 * a list it cannot see invents product ids.
 */

export interface Pick {
  productId: string
  reason: string
  /** Labelled so a fallback is never passed off as advice. */
  source: 'model' | 'match'
  /** 1-based position within the aisle's picks, best first. */
  rank: number
}

export interface Verdict {
  /** Best first, up to PICKS_PER_AISLE. */
  picks: Record<string, Pick[]>
  /** How the picks work together. Empty when no model answered. */
  together: string
}

/**
 * How many products the stylist stands behind per aisle.
 *
 * Half the shortlist it is shown, which is the point: asked for six of twelve
 * it is still choosing, and a model that returns everything it was given has
 * added nothing to the ranking that produced the list.
 */
export const PICKS_PER_AISLE = 6

/** Flash: the judge runs per track on demand, so latency matters more than depth. */
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'

/**
 * Choose up to PICKS_PER_AISLE products per aisle, best first.
 *
 * With no model configured, the top colour matches win and are labelled as such.
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
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.4,
        // 2.5 models think before answering unless told not to, which cost ~20s
        // on a request the shopper waits through. The task is choosing six of
        // twelve per aisle from a list already ranked by code, so there is
        // nothing here worth reasoning about at that price.
        thinkingConfig: { thinkingBudget: 0 },
      },
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

    const chosen: Record<string, Pick[]> = {}
    const seen: Record<string, Set<string>> = {}
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
      // Asked for six, a model will sometimes return the same id twice to
      // reach the count. That would show one product in two slots and cost
      // the aisle a real recommendation, so the repeat is dropped.
      const already = (seen[p.aisle] ??= new Set())
      if (already.has(found.id)) continue
      already.add(found.id)

      const list = (chosen[p.aisle] ??= [])
      if (list.length >= PICKS_PER_AISLE) continue
      list.push({
        productId: found.id,
        reason: p.reason?.trim() || found.reason,
        source: 'model',
        rank: list.length + 1,
      })
    }

    // Per aisle, not per response: a model that answered for four aisles and
    // skipped two must not cost those two their picks entirely. Any aisle it
    // did not speak for keeps the colour-match list, still labelled as such.
    const picks = { ...fallback }
    for (const [aisle, list] of Object.entries(chosen)) {
      if (list.length) picks[aisle] = list
    }
    return { picks, together: parsed.together?.trim() ?? '' }
  } catch (err) {
    // A model outage takes the same path, quietly; the shopper still gets a
    // full set of recommendations.
    console.warn('[judge] falling back to colour match:', (err as Error).message)
    return { picks: fallback, together: '' }
  }
}

/**
 * The shelf without a stylist: the best colour matches, labelled as matches.
 *
 * Takes the same six, so an outage changes where the recommendations came from
 * and never how many there are — the shopper gets a full set either way, and
 * the ribbon says which it is rather than passing one off as the other.
 */
export function topMatches(shortlists: Record<string, Ranked[]>): Record<string, Pick[]> {
  const out: Record<string, Pick[]> = {}
  for (const [aisle, list] of Object.entries(shortlists)) {
    if (!list.length) continue
    out[aisle] = list.slice(0, PICKS_PER_AISLE).map((p, i) => ({
      productId: p.id,
      reason: p.reason,
      source: 'match',
      rank: i + 1,
    }))
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

  return `You are a personal shopper advising one customer. A skin scan
measured her, and every claim you make must trace back to one of these
readings. Do not invent a measurement.

MEASURED:
- undertone: ${ctx.undertone}
- seasonal palette: ${ctx.season}
- prescribed foundation finish: ${ctx.finish}
${ctx.because.length ? ctx.because.map((b) => `- ${b}`).join('\n') : '- no concern was pronounced enough to change the formula'}

Choose UP TO ${PICKS_PER_AISLE} products per category from the lists below, best
first, and never the same product twice. You may only use ids that appear in
these lists. Do not invent ids or recommend anything absent from them.

Choosing fewer than ${PICKS_PER_AISLE} is a valid answer. If a category holds
only two shades worth her buying, name two: padding the list to reach a count
recommends things you do not think suit her.

${aisles}

Write like a stylist, not a brochure: specific, one sentence each, no
superlatives and no invented benefits.

Every reason must answer WHY THIS ONE RATHER THAN THE OTHERS IN THE SAME
CATEGORY. Six picks that all say some version of "suits your undertone" tell
her nothing about which to buy — the undertone is the same for all six, so it
cannot be what separates them. Name what does: the shade's depth or intensity,
the finish, the coverage, when she would wear it over the others.

Never fall back on "is a good
choice", "is suitable for", "works with", "is another option", "aligns with"
or "is an adequate match". If you cannot say what distinguishes a product from
the ones above it, leave it out and return a shorter list.

Reply as JSON:
{"picks":[{"aisle":"<category>","productId":"<id from the list>","reason":"<one sentence naming the measurement that justifies this pick>"}],
 "together":"<ONE sentence, naming at most three products, on how your top picks form a single look. Not a list of every category.>"}`
}
