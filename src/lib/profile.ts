import { hexToLab, hexToLch, NEUTRAL_CHROMA } from './color'
import { faceRuleFor } from './rank'
import { buildStyleProfile, type ColorRec, type ConcernScores } from './styleProfile'
import type { ConcernRow, Formula, Palette } from './prescription'

/**
 * The reading, read back to her.
 *
 * The scan already measures far more than the shelves consume: eye, brow and
 * hair colour came back on every request and nothing read them, and the same
 * was true of the photo-quality report. This turns what was measured into
 * something she can act on without buying anything — which is also the honest
 * order to do it in, since the advice is derived from her face rather than
 * from what happens to be in stock.
 *
 * EVERY line here must trace to a measurement. A profile is the easiest place
 * in the app to start inventing flattering sentences, and the moment one claim
 * is decorative the measured ones stop being believable too. So a reading that
 * did not come back produces silence, never a hedge.
 */

/** One measured attribute, with what it means. */
export interface Fact {
  label: string
  /** Short enough for a stat line: "Neutral", "4 of 6", "High". */
  value: string
  /** The measurement it came from, in her words. */
  note: string
  /** Rendered as a dot when the fact is a colour. */
  hex?: string
}

export interface Tip {
  title: string
  body: string
  /** The reading that produced it. Never empty. */
  because: string
}

export interface Profile {
  /** Two or three sentences. Every clause carries a number. */
  summary: string
  facts: Fact[]
  works: ColorRec[]
  watch: ColorRec[]
  tips: Tip[]
  /** Set only when the photo itself limited the reading. */
  caveat: string | null
}

/* -- Contrast ------------------------------------------------------------ */

export type Contrast = 'high' | 'medium' | 'low'

/**
 * How far apart her hair and skin sit in lightness.
 *
 * This is the one classic colour-analysis axis the app was measuring and never
 * computing: `hair_color` came back on every scan and nothing read it. It is
 * separate from depth — dark hair on light skin is HIGH contrast at a LIGHT
 * depth — and it decides different things. Depth picks how deep a colour
 * should be; contrast picks how far apart two colours in an outfit can sit
 * before they stop looking like they were chosen together.
 */
export function contrastOf(skinHex: string, hairHex?: string): {
  level: Contrast
  delta: number
} | null {
  if (!hairHex || !/^#[0-9a-f]{6}$/i.test(hairHex)) return null
  const skin = hexToLab(skinHex)
  const hair = hexToLab(hairHex)
  const delta = Math.abs(skin.L - hair.L)
  return { level: delta >= 42 ? 'high' : delta >= 22 ? 'medium' : 'low', delta }
}

const CONTRAST_ADVICE: Record<Contrast, string> = {
  high: 'Sharp pairings suit you — a dark piece against a light one reads deliberate rather than harsh, and you can carry true black and optic white next to your face.',
  medium: 'Moderate pairings suit you best: clear differences without extremes. Very stark black-and-white can overpower, and head-to-toe one shade can flatten.',
  low: 'Tonal dressing suits you — shades of one colour, or neighbours on the wheel. Very high-contrast pairings tend to be the first thing seen, ahead of your face.',
}

/* -- Skincare routine ---------------------------------------------------- */

/**
 * What to do about the worst reading, in texture-and-routine terms.
 *
 * Deliberately not ingredients or treatment: a shop that measured oiliness
 * from one selfie is in no position to prescribe an actives routine, and the
 * app would be making a claim its own reading cannot support. What a texture
 * reading CAN honestly say is what a product should feel like.
 */
const ROUTINE: Record<string, { title: string; body: string }> = {
  oiliness: {
    title: 'Reach for gel, not balm',
    body: 'Lightweight, water-based textures sit better on skin reading this oily, and a mattifying primer under makeup will hold a base longer than powder applied over it.',
  },
  moisture: {
    title: 'Layer damp, not dry',
    body: 'Applying moisturiser onto skin that is still slightly damp traps more of the water than applying it to dry skin. Richer, occlusive textures hold it there longer.',
  },
  redness: {
    title: 'Fewer steps, less friction',
    body: 'Skin reading this red usually settles with a shorter routine rather than a longer one: lukewarm water, no scrubs, and a green-toned corrector under foundation rather than more coverage over it.',
  },
  acne: {
    title: 'Spot-treat, do not strip',
    body: 'Treating the whole face for a localised reading tends to dry the rest and provoke more oil. Keep the cleanse gentle and target the areas the mask flagged.',
  },
  texture: {
    title: 'Smooth before you cover',
    body: 'Texture shows through coverage rather than under it, so a smoothing primer does more than a heavier foundation. Buff a base in with a dense brush rather than pressing it flat.',
  },
  pore: {
    title: 'Prime, then press',
    body: 'A silicone-based primer over the areas that read most porous fills them optically; pressing foundation in rather than dragging it keeps it from settling into them.',
  },
  dark_circle_v2: {
    title: 'Correct the colour before concealing',
    body: 'Under-eye shadow is a colour problem before it is a coverage one — a peach or orange-toned corrector cancels the blue, and concealer over it then needs to be far thinner.',
  },
}

const CONCERN_WORD: Record<string, string> = {
  oiliness: 'oiliness', moisture: 'dryness', redness: 'redness', acne: 'blemishes',
  texture: 'texture', pore: 'visible pores', dark_circle_v2: 'under-eye shadow',
  radiance: 'dullness', age_spot: 'age spots',
}

/* -- The profile --------------------------------------------------------- */

export interface ProfileInput {
  skinHex: string
  lipHex?: string
  hairHex?: string
  eyeHex?: string
  eyeColorName?: string
  hairColorName?: string
  faceShape?: string
  concerns: ConcernRow[]
  palette: Palette
  formula: Formula
  faceQuality?: { lighting?: string; frontal?: string; area?: string } | null
}

export function buildProfile(input: ProfileInput): Profile {
  const { skinHex, palette, formula, concerns } = input

  const severities = concerns
    .filter((c) => typeof c.raw_score === 'number')
    .map((c) => ({ type: c.type, sev: Math.round(100 - c.raw_score) }))
    .sort((a, b) => b.sev - a.sev)
  const worst = severities[0] ?? null
  const best = severities.at(-1) ?? null

  const contrast = contrastOf(skinHex, input.hairHex)

  /* Facts ---------------------------------------------------------------- */
  const facts: Fact[] = [
    {
      label: 'Undertone',
      value: cap(palette.undertone),
      note: `Measured from your skin colour ${skinHex}, which reads ${palette.undertone}.`,
      hex: skinHex,
    },
    {
      label: 'Depth',
      value: `${palette.depth} of 6`,
      note: 'How light or deep your skin measured, where 1 is deepest. It sets how deep a colour can go before it overwhelms you.',
    },
  ]
  if (contrast) {
    facts.push({
      label: 'Contrast',
      value: cap(contrast.level),
      note: `${input.hairColorName ? `${cap(input.hairColorName)} hair` : 'Your hair'} and your skin measured ${Math.round(contrast.delta)} points apart in lightness. Depth is how deep you are; contrast is how far apart two colours on you can sit.`,
      hex: input.hairHex,
    })
  }
  if (input.eyeHex && /^#[0-9a-f]{6}$/i.test(input.eyeHex)) {
    facts.push({
      label: 'Eyes',
      value: cap(input.eyeColorName ?? 'measured'),
      note: `Measured at ${input.eyeHex}. The one colour on your face you cannot change, so it is worth echoing in what you wear.`,
      hex: input.eyeHex,
    })
  }

  /* What works, what to watch -------------------------------------------- */
  // buildStyleProfile decides undertone by comparing redness against her OWN
  // average severity, which is why it is used here rather than the palette's
  // hue test: on near-perfect skin every absolute threshold reads the same for
  // everyone, and advice that is the same for everyone is not advice.
  const scores: ConcernScores = Object.fromEntries(
    concerns.map((c) => [c.type, c.raw_score]),
  )
  const style = concerns.length ? buildStyleProfile(scores) : null

  const works: ColorRec[] = style
    ? style.recommendedColors
    : palette.swatches.map((s) => ({
        name: s.name,
        hex: s.hex,
        reason: `Sits with your ${palette.undertone} undertone rather than fighting it.`,
      }))
  const watch = style?.avoidColors ?? []

  /* Tips ------------------------------------------------------------------ */
  const tips: Tip[] = []

  if (contrast) {
    tips.push({
      title: contrast.level === 'low' ? 'Dress tonally' : contrast.level === 'high' ? 'You can carry sharp pairings' : 'Aim between the extremes',
      body: CONTRAST_ADVICE[contrast.level],
      because: `Your hair and skin measured ${Math.round(contrast.delta)} points apart in lightness.`,
    })
  }

  tips.push({
    title: `Your base is ${formula.finish}`,
    body:
      formula.finish === 'matte'
        ? 'A matte base holds where a dewy one slides, and you can bring glow back deliberately with a highlighter rather than fighting it all day.'
        : formula.finish === 'dewy'
          ? 'A dewy base keeps skin looking hydrated rather than powdery. Set only the centre of the face, not all of it.'
          : 'A natural finish gives you the most room: it neither flattens the skin nor exaggerates its texture.',
    because:
      formula.because[0] ??
      `Prescribed from your measured concerns and your skin colour ${skinHex}.`,
  })

  if (worst && worst.sev > 5 && ROUTINE[worst.type]) {
    tips.push({
      ...ROUTINE[worst.type],
      because: `${cap(CONCERN_WORD[worst.type] ?? worst.type)} is your most pronounced reading, at ${worst.sev}%.`,
    })
  }

  const face = faceRuleFor(input.faceShape)
  if (face) {
    tips.push({
      title: face.key === 'oval' ? 'Most shapes suit you' : `Balance ${an(face.key)} face`,
      body: `${cap(an(face.key))} face ${face.rule.needs}. That applies to a haircut first, and to necklines and collars for the same reason.`,
      because: `Your scan read ${an(face.key)} face shape.`,
    })
  }

  if (input.lipHex && /^#[0-9a-f]{6}$/i.test(input.lipHex)) {
    const lip = hexToLch(input.lipHex)
    tips.push({
      title: lip.C < NEUTRAL_CHROMA + 8 ? 'Your lips need the pigment' : 'Your lips already carry colour',
      body:
        lip.C < NEUTRAL_CHROMA + 8
          ? `Your natural lip colour measured ${input.lipHex}, which is muted. Sheer washes will barely register on you — an opaque formula will show as an actual change.`
          : `Your natural lip colour measured ${input.lipHex}, which already has pigment in it. A sheer or tinted balm reads as a finished lip on you, where someone paler-lipped would need a full lipstick.`,
      because: `Measured natural lip colour ${input.lipHex}.`,
    })
  }

  // Something that is going RIGHT, named as specifically as the problems are.
  // A report that only lists faults reads as a sales pitch, and this one is
  // measured on exactly the same scale as the rest.
  if (best && severities.length > 2 && best.sev < 20) {
    tips.push({
      title: `Your strongest reading: ${CONCERN_WORD[best.type] ?? best.type}`,
      body: `It scored ${100 - best.sev} of 100, the healthiest of everything measured on you. Nothing here needs to address it, which is worth knowing before you buy something that claims to.`,
      because: `Measured at ${100 - best.sev} of 100, where higher is healthier.`,
    })
  }

  /* Summary --------------------------------------------------------------- */
  const summary = [
    `Your skin measured ${skinHex} — a ${palette.undertone} undertone at depth ${palette.depth} of 6, which puts you in ${palette.season}.`,
    contrast
      ? `Against your hair you read ${contrast.level} contrast, ${Math.round(contrast.delta)} points apart in lightness.`
      : null,
    worst && worst.sev > 5
      ? `Of the ${severities.length} skin readings taken, ${CONCERN_WORD[worst.type] ?? worst.type} is the most pronounced at ${worst.sev}%; weighed against the rest, your base comes out ${formula.finish}.`
      : severities.length
        ? `None of the ${severities.length} skin readings was pronounced enough to push the formula, so your base is balanced ${formula.finish}.`
        : null,
  ]
    .filter(Boolean)
    .join(' ')

  return { summary, facts, works, watch, tips, caveat: caveatFor(input.faceQuality) }
}

/**
 * Say when the PHOTO limited the reading, not the face.
 *
 * YouCam grades the shot on every scan and nothing read it. A shopper who gets
 * an odd result deserves to know it was the lighting, and it is the one note
 * here that is about the input rather than about her.
 */
function caveatFor(q: ProfileInput['faceQuality']): string | null {
  if (!q) return null
  const bad = (v?: string) => typeof v === 'string' && /low|poor|bad|dark|small|large|no/i.test(v)
  const notes: string[] = []
  if (bad(q.lighting)) notes.push('the lighting was uneven')
  if (bad(q.frontal)) notes.push('your face was turned away from the camera')
  if (bad(q.area)) notes.push('your face did not fill much of the frame')
  if (!notes.length) return null
  return `A note on the photo rather than on you: ${join(notes)}. The colour readings are the ones most affected — a rescan in flat, even light will tighten them.`
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** "an oval", "a square". Shape names come from the API, so this is derived. */
const an = (word: string) => `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`

const join = (xs: string[]) =>
  xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`
