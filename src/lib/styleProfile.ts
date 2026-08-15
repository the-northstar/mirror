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
 * SCORE DIRECTION: YouCam scores run 1-100 where HIGHER = HEALTHIER skin.
 * A low `redness` score therefore means *more* visible redness. We invert on
 * the way in so everything below reasons in terms of severity, which is the
 * direction the styling rules actually care about.
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
  /** 0-100 severity. How much visible redness we are trying not to amplify. */
  redness: number
  /** 0-100 severity. Uneven pigmentation — drives how much value contrast. */
  unevenness: number
  recommendedColors: ColorRec[]
  avoidColors: ColorRec[]
  /** Plain-language reasons, surfaced in the UI so advice is never a black box. */
  rationale: string[]
}

export interface ColorRec {
  name: string
  hex: string
  reason: string
}

/**
 * Redness-neutralising palette. Cool blue-greens sit opposite red on the wheel,
 * so they pull apparent skin tone away from flushed.
 */
const CALMING: ColorRec[] = [
  { name: 'Sage', hex: '#8a9a7b', reason: 'Green-family, sits opposite red, so it visually calms flushed areas.' },
  { name: 'Petrol', hex: '#2f5d62', reason: 'Deep blue-green; neutralises redness without washing you out.' },
  { name: 'Slate blue', hex: '#4a5d7e', reason: 'Cool mid-tone that pulls focus away from surface redness.' },
]

const WARM_FLATTERING: ColorRec[] = [
  { name: 'Camel', hex: '#b08d57', reason: 'Echoes golden undertone, reading harmonious rather than contrasting.' },
  { name: 'Cream', hex: '#efe6d2', reason: 'Warm neutral; softer against golden skin than optic white.' },
  { name: 'Olive', hex: '#6b6b3a', reason: 'Warm-leaning green that flatters golden undertones.' },
]

const COOL_FLATTERING: ColorRec[] = [
  { name: 'Navy', hex: '#26334d', reason: 'Cool depth that complements pink-blue undertones.' },
  { name: 'Charcoal', hex: '#36383d', reason: 'Neutral-cool; gives structure without warm cast.' },
  { name: 'Soft white', hex: '#f2f3f5', reason: 'Clean cool white flatters cool undertones.' },
]

const REDNESS_AMPLIFIERS: ColorRec[] = [
  { name: 'Scarlet', hex: '#c8322d', reason: 'Sits in the same hue family as facial redness, so it amplifies it.' },
  { name: 'Coral', hex: '#f2705f', reason: 'Warm red-orange; tends to echo flushed tones.' },
  { name: 'Hot pink', hex: '#e0407f', reason: 'Pulls pink into the face where redness is already high.' },
]

/**
 * Derive a wardrobe profile from skin scores.
 *
 * Concern ids are injected rather than hardcoded so the same logic serves both
 * the SD set (`redness`) and the HD set (`hd_redness`) — the two cannot be
 * requested together, so the caller picks one and tells us which it used.
 */
export function buildStyleProfile(
  scores: ConcernScores,
  keys: { redness: string; ageSpot: string; texture: string } = {
    redness: 'redness',
    ageSpot: 'age_spot',
    texture: 'texture',
  },
): StyleProfile {
  // Absent concerns must not read as "perfect skin" (severity 0), which would
  // silently produce confident advice from data we never received.
  const redness = severity(scores, keys.redness) ?? 0
  const hasRedness = severity(scores, keys.redness) !== null

  const spotSev = severity(scores, keys.ageSpot)
  const textureSev = severity(scores, keys.texture)
  const measured = [spotSev, textureSev].filter((v): v is number => v !== null)
  const unevenness = measured.length ? Math.max(...measured) : 0

  // Redness is the strongest signal we have for undertone from these metrics:
  // pronounced erythema reads pink/cool, its absence lets warmth dominate.
  // Without a redness reading we stay neutral rather than inventing a lean.
  const undertone: Undertone = !hasRedness
    ? 'neutral'
    : redness >= 55
      ? 'cool'
      : redness <= 25
        ? 'warm'
        : 'neutral'

  const rationale: string[] = []
  const recommended: ColorRec[] = []
  const avoid: ColorRec[] = []

  if (hasRedness && redness >= 45) {
    recommended.push(...CALMING)
    avoid.push(...REDNESS_AMPLIFIERS)
    rationale.push(
      `Your redness reading sits at ${Math.round(redness)}/100 severity. Cool blue-greens sit opposite red on the colour wheel, so they visually settle that down. Warm reds and corals do the opposite.`,
    )
  }

  if (undertone === 'warm') {
    recommended.push(...WARM_FLATTERING)
    rationale.push(
      'Low redness lets your golden undertone lead, so warm neutrals like camel and cream harmonise rather than fight it.',
    )
  } else if (undertone === 'cool') {
    recommended.push(...COOL_FLATTERING)
    rationale.push(
      'Cooler undertone reads best against navy and true cool neutrals; heavy warm yellows can look sallow.',
    )
  } else {
    recommended.push(COOL_FLATTERING[0], WARM_FLATTERING[0])
    rationale.push(
      hasRedness
        ? 'Your undertone sits neutral, which is the flexible one. Both warm and cool anchors work, so we default to versatile mid-tones.'
        : 'No redness reading was returned, so we default to versatile mid-tones rather than guessing an undertone.',
    )
  }

  if (unevenness >= 50) {
    rationale.push(
      `Pigment unevenness at ${Math.round(unevenness)}/100 means very high-contrast outfits draw the eye upward to the face. Mid-contrast pairings keep attention on the silhouette.`,
    )
  }

  return {
    undertone,
    redness,
    unevenness,
    recommendedColors: dedupe(recommended),
    avoidColors: dedupe(avoid),
    rationale,
  }
}

const dedupe = (list: ColorRec[]): ColorRec[] => {
  const seen = new Set<string>()
  return list.filter((c) => !seen.has(c.name) && seen.add(c.name))
}
