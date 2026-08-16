/**
 * The bridge between Skin AI and Apparel VTO.
 *
 * YouCam's skin analysis returns per-concern scores. On their own they only
 * answer "what is my skin doing". This module turns them into wardrobe
 * decisions, so the two APIs form one experience instead of two features.
 *
 * The colour reasoning is simultaneous contrast (Chevreul): a garment sitting
 * next to skin pushes the skin's apparent hue toward the garment's complement.
 * So a red-adjacent garment worn against already-erythemic skin makes redness
 * read stronger, while its complement (blue-green) visually neutralises it.
 *
 * SCORE DIRECTION: YouCam scores run 1-100 where HIGHER = HEALTHIER skin, so
 * severity is 100 - score.
 *
 * CALIBRATION: measured against the live API, real scores cluster very high
 * (90-100 on a well-lit face). Absolute severity thresholds therefore almost
 * never fire, and everyone lands on the same advice. So undertone is decided
 * by comparing redness against the person's OWN average severity instead. That
 * makes the reading relative to you, which is also the honest claim: we can say
 * redness is your most pronounced trait, not that you have "high redness".
 */

/** Raw YouCam output: concern id -> raw_score (1-100, higher = healthier). */
export type ConcernScores = Record<string, number>

/** Convert a health score into 0-100 severity, where higher = more visible. */
const severity = (scores: ConcernScores, key: string): number | null => {
  const health = scores[key]
  return typeof health === 'number' ? 100 - health : null
}

export type Undertone = 'warm' | 'cool' | 'neutral'

export interface StyleProfile {
  undertone: Undertone
  /** 0-100 severity for redness. */
  redness: number
  /** 0-100 severity for pigment unevenness. */
  unevenness: number
  /** Concerns ranked most to least pronounced, for the report. */
  ranked: Array<{ key: string; severity: number }>
  recommendedColors: ColorRec[]
  avoidColors: ColorRec[]
  rationale: string[]
}

export interface ColorRec {
  name: string
  hex: string
  reason: string
}

const CALMING: ColorRec[] = [
  { name: 'Sage', hex: '#8a9a7b', reason: 'Sits opposite red on the wheel, so it visually calms flushed areas.' },
  { name: 'Petrol', hex: '#2f5d62', reason: 'Deep blue-green; neutralises redness without washing you out.' },
  { name: 'Slate blue', hex: '#4a5d7e', reason: 'Cool mid-tone that pulls focus away from surface redness.' },
]

const WARM_FLATTERING: ColorRec[] = [
  { name: 'Camel', hex: '#b08d57', reason: 'Echoes a golden undertone, reading harmonious rather than contrasting.' },
  { name: 'Cream', hex: '#efe6d2', reason: 'Warm neutral; softer against golden skin than optic white.' },
  { name: 'Olive', hex: '#6b6b3a', reason: 'Warm-leaning green that flatters golden undertones.' },
]

const COOL_FLATTERING: ColorRec[] = [
  { name: 'Navy', hex: '#26334d', reason: 'Cool depth that complements pink-blue undertones.' },
  { name: 'Charcoal', hex: '#36383d', reason: 'Neutral-cool; gives structure without a warm cast.' },
  { name: 'Soft white', hex: '#f2f3f5', reason: 'Clean cool white that flatters cool undertones.' },
]

const REDNESS_AMPLIFIERS: ColorRec[] = [
  { name: 'Scarlet', hex: '#c8322d', reason: 'Same hue family as facial redness, so it amplifies it.' },
  { name: 'Coral', hex: '#f2705f', reason: 'Warm red-orange; tends to echo flushed tones.' },
  { name: 'Hot pink', hex: '#e0407f', reason: 'Pulls pink into the face where redness already shows.' },
]

export const CONCERN_LABELS: Record<string, string> = {
  redness: 'Redness',
  age_spot: 'Age spots',
  texture: 'Texture',
  acne: 'Acne',
  oiliness: 'Oiliness',
  moisture: 'Moisture',
  radiance: 'Radiance',
  pore: 'Pores',
}

export function buildStyleProfile(
  scores: ConcernScores,
  keys: { redness: string; ageSpot: string; texture: string } = {
    redness: 'redness',
    ageSpot: 'age_spot',
    texture: 'texture',
  },
): StyleProfile {
  const ranked = Object.entries(scores)
    .map(([key, health]) => ({ key, severity: 100 - health }))
    .sort((a, b) => b.severity - a.severity)

  const redness = severity(scores, keys.redness)
  const hasRedness = redness !== null

  const spot = severity(scores, keys.ageSpot)
  const texture = severity(scores, keys.texture)
  const measured = [spot, texture].filter((v): v is number => v !== null)
  const unevenness = measured.length ? Math.max(...measured) : 0

  // Compare redness against this person's own average severity rather than a
  // fixed cutoff, so the reading stays meaningful on near-perfect skin.
  const mean = ranked.length
    ? ranked.reduce((sum, r) => sum + r.severity, 0) / ranked.length
    : 0
  const rednessLead = hasRedness ? redness - mean : 0

  const undertone: Undertone = !hasRedness
    ? 'neutral'
    : rednessLead > 2
      ? 'cool'
      : rednessLead < -2
        ? 'warm'
        : 'neutral'

  const rationale: string[] = []
  const recommended: ColorRec[] = []
  const avoid: ColorRec[] = []

  if (undertone === 'cool') {
    recommended.push(...CALMING, ...COOL_FLATTERING)
    avoid.push(...REDNESS_AMPLIFIERS)
    rationale.push(
      'Redness is the most pronounced signal in your reading. Cool blue-greens sit opposite red on the colour wheel, so they visually settle it, while warm reds and corals echo it.',
    )
  } else if (undertone === 'warm') {
    recommended.push(...WARM_FLATTERING)
    rationale.push(
      'Redness is low relative to your other readings, which lets a golden undertone lead. Warm neutrals like camel and cream harmonise with it rather than fight it.',
    )
  } else {
    recommended.push(COOL_FLATTERING[0], WARM_FLATTERING[0], CALMING[0])
    rationale.push(
      hasRedness
        ? 'Your readings sit evenly, which puts you in neutral territory. That is the flexible one: both warm and cool anchors work, so we lead with versatile mid-tones.'
        : 'No redness reading came back, so we default to versatile mid-tones rather than guessing an undertone.',
    )
  }

  const top = ranked[0]
  if (top && top.severity > 1) {
    rationale.push(
      `Your most pronounced reading is ${(CONCERN_LABELS[top.key] ?? top.key).toLowerCase()}. Everything else scored higher, so the palette is tuned around that first.`,
    )
  }

  if (unevenness >= 20) {
    rationale.push(
      'Pigment varies enough across your skin that very high-contrast outfits pull the eye up to the face. Mid-contrast pairings keep attention on the silhouette.',
    )
  }

  return {
    undertone,
    redness: redness ?? 0,
    unevenness,
    ranked,
    recommendedColors: dedupe(recommended),
    avoidColors: dedupe(avoid),
    rationale,
  }
}

const dedupe = (list: ColorRec[]): ColorRec[] => {
  const seen = new Set<string>()
  return list.filter((c) => !seen.has(c.name) && seen.add(c.name))
}
