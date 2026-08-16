import { askGemini, geminiConfigured } from './gemini'
import type { Profile } from './profile'

/**
 * The written read-back, in the model's words rather than the app's.
 *
 * `buildProfile` already produces this from code, and that stays the floor:
 * it is what a shopper gets with no key configured, on an outage, and on the
 * first paint before this returns. The model is only ever REPHRASING numbers
 * the app measured and reasons the app derived — it is handed the profile, not
 * the raw scan, so the worst it can do is word an existing finding badly. It
 * cannot introduce one.
 *
 * Which is why `source` ships with the text. A measured paragraph and a
 * written one read alike, and the shopper is entitled to know which she got.
 */
export interface Analysis {
  paragraphs: string[]
  source: 'model' | 'measured'
}

/**
 * The floor: what the app derived, in its own words. Never empty.
 *
 * The summary ALONE, deliberately. Padding it with the tips restated them
 * word-for-word directly above the tip cards that already carry them, and a
 * page that says the same thing twice reads as filler rather than as depth.
 * The summary is the one line that appears nowhere else.
 */
export function measuredAnalysis(profile: Profile): Analysis {
  return { paragraphs: [profile.summary], source: 'measured' }
}

export async function analyse(profile: Profile, signal?: AbortSignal): Promise<Analysis> {
  const floor = measuredAnalysis(profile)
  if (!geminiConfigured()) return floor

  try {
    const out = await askGemini<{ paragraphs?: string[] }>(prompt(profile), signal)
    const paragraphs = (out.paragraphs ?? [])
      .map((p) => String(p).trim())
      .filter(Boolean)
      .slice(0, 3)
    // A short or empty answer falls back whole rather than being padded out of
    // the measured version — mixing the two would leave the label lying.
    return paragraphs.length >= 2 ? { paragraphs, source: 'model' } : floor
  } catch (err) {
    console.warn('[analysis] falling back to the measured profile:', (err as Error).message)
    return floor
  }
}

function prompt(profile: Profile): string {
  const facts = profile.facts.map((f) => `- ${f.label}: ${f.value} — ${f.note}`).join('\n')
  const tips = profile.tips.map((t) => `- ${t.title}: ${t.body} (measured: ${t.because})`).join('\n')
  const colours = profile.works.map((c) => `- ${c.name}: ${c.reason}`).join('\n')

  return `A skin scan measured one customer. Below is everything it measured and
everything the app derived from it. Write her a short read-back of her own
analysis.

WHAT THE SCAN MEASURED:
${facts}

WHAT THE APP DERIVED:
${profile.summary}

${tips}

COLOURS IT PUT FORWARD:
${colours}

Write 3 short paragraphs, 2 to 3 sentences each, addressed to her as "you".

Rules, in order of importance:

1. Use ONLY what is above. Every number you print must appear above, unchanged.
   You are rephrasing a finished analysis, not producing one — if something is
   not stated above, it was not measured, and you must not mention it.
2. No diagnosis and no treatment. You may describe what her skin measured and
   what a product should FEEL like. You may not name a medical condition, an
   active ingredient, or a course of treatment.
3. No selling. Do not name or imply a product to buy. This is what she gets
   for scanning, whether or not she buys anything.
4. Do not flatter. "Stunning" and "gorgeous" are not measurements. If a
   reading is unremarkable, saying so plainly is more useful and more
   credible than dressing it up.

Lead with what is most specific to her — the reading that is unusual or that
drove the most decisions — not with the undertone, which every customer has.

Reply as JSON: {"paragraphs":["…","…","…"]}`
}
