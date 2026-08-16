/**
 * The one place that talks to Gemini.
 *
 * Two callers now — the shelf judge and the written analysis — and they must
 * fail the same way: quietly, with the caller falling back to something the
 * app measured itself. Model config, the thinking budget and the outage path
 * living in one place is what keeps that promise from drifting between them.
 */

/** Flash: both callers run while the shopper waits, so latency beats depth. */
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'

export const geminiConfigured = () => Boolean(process.env.GEMINI_API_KEY)

/**
 * Ask for JSON and get it parsed, or throw.
 *
 * Throwing rather than returning null is deliberate: every caller already
 * needs a catch for the outage case, and a null would let one of them forget.
 */
export async function askGemini<T>(prompt: string, signal?: AbortSignal): Promise<T> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('no api key')

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.4,
          // 2.5 models think before answering unless told not to, which cost
          // ~20s on a request the shopper waits through. Neither caller is
          // doing anything worth reasoning about at that price: one picks from
          // a list code already ranked, the other writes from numbers it is
          // handed.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      signal,
    },
  )
  if (!res.ok) throw new Error(`gemini ${res.status}`)

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('empty completion')
  return JSON.parse(text) as T
}
