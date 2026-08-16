/**
 * Colour science. Pure functions, no I/O, so the logic that drives every
 * recommendation is directly testable against documented API payloads.
 */

export interface Lab {
  L: number
  a: number
  b: number
}

export interface Rgb {
  r: number
  g: number
  b: number
}

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '').trim()
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** sRGB (D65) to CIELAB. */
export function rgbToLab({ r, g, b }: Rgb): Lab {
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const R = lin(r)
  const G = lin(g)
  const B = lin(b)

  const X = R * 0.4124 + G * 0.3576 + B * 0.1805
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722
  const Z = R * 0.0193 + G * 0.1192 + B * 0.9505

  // D65 white point.
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f(X / 0.95047)
  const fy = f(Y / 1.0)
  const fz = f(Z / 1.08883)

  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) }
}

export const hexToLab = (hex: string): Lab => rgbToLab(hexToRgb(hex))

export function labToRgb({ L, a, b }: Lab): Rgb {
  const fy = (L + 16) / 116
  const fx = fy + a / 500
  const fz = fy - b / 200
  const inv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787)

  const X = inv(fx) * 0.95047
  const Y = inv(fy) * 1.0
  const Z = inv(fz) * 1.08883

  const R = X * 3.2406 + Y * -1.5372 + Z * -0.4986
  const G = X * -0.9689 + Y * 1.8758 + Z * 0.0415
  const B = X * 0.0557 + Y * -0.204 + Z * 1.057

  const gam = (v: number) => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
    return c * 255
  }
  return { r: gam(R), g: gam(G), b: gam(B) }
}

/**
 * CIE76 colour difference.
 *
 * Foundation matching must run in Lab, not RGB: RGB treats a green shift as
 * equal to a red one, so deep and olive skin gets matched to something
 * numerically close and obviously wrong on the face.
 */
export function deltaE(x: Lab, y: Lab): number {
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b)
}

/**
 * Lab in polar form: lightness, colourfulness, hue angle.
 *
 * Straight ΔE is right for foundation, where the answer is "the same colour as
 * her face". It is wrong for everything she WEARS, because it folds lightness,
 * chroma and hue into one number: a good navy that is two shades lighter than
 * the reference loses to a muddy one at the exact right L*. Wardrobe and
 * cosmetic decisions weigh those three separately, so they need them separate.
 */
export interface Lch {
  L: number
  /** 0 for a pure grey; roughly 20+ before a colour reads as coloured. */
  C: number
  /** Degrees, 0-360. Meaningless when C is near zero. */
  h: number
}

export function labToLch({ L, a, b }: Lab): Lch {
  const deg = (Math.atan2(b, a) * 180) / Math.PI
  return { L, C: Math.hypot(a, b), h: deg < 0 ? deg + 360 : deg }
}

export const hexToLch = (hex: string): Lch => labToLch(hexToLab(hex))

/** Shortest way round the hue circle, 0-180. */
export function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/**
 * Below this a colour is a neutral: grey, white, charcoal, ecru.
 *
 * Neutrals carry no undertone, so they can neither harmonise nor clash and
 * must not be judged as though they could. Scoring a white shirt against a
 * "Deep Autumn" palette of rust and forest was the bug this constant fixes.
 */
export const NEUTRAL_CHROMA = 12

export type Undertone = 'warm' | 'neutral' | 'cool'

/**
 * Undertone from measured skin colour.
 *
 * NOT hue. Hue is correct for product colours across the whole circle, but
 * measured on real skin it saturates near 0.94-0.99 for everything, so every
 * shopper comes out orange. The ratio of yellowness to redness in Lab
 * separates cleanly on the same samples, so that is what decides it.
 */
export function undertoneOf(skinHex: string): Undertone {
  const { a, b } = hexToLab(skinHex)
  // a* near zero would blow the ratio up; treat that as neutral rather than
  // dividing by something meaningless.
  if (Math.abs(a) < 0.5) return 'neutral'
  const ratio = b / a
  if (ratio >= 2.4) return 'warm'
  if (ratio <= 1.5) return 'cool'
  return 'neutral'
}

/** Depth 1 (deepest) to 6 (lightest), bucketed on L*. */
export function depthOf(skinHex: string): number {
  const { L } = hexToLab(skinHex)
  if (L < 30) return 1
  if (L < 42) return 2
  if (L < 54) return 3
  if (L < 66) return 4
  if (L < 76) return 5
  return 6
}

/**
 * Average colour of an image, weighting each pixel by how colourful it is.
 *
 * Product shots sit on white sweeps with grey shadows. Weighting by chroma
 * lets the background fall away without needing a cutout, which no free
 * catalogue provides.
 */
export function dominantColor(
  pixels: Uint8Array | Uint8ClampedArray,
): string | null {
  let wr = 0
  let wg = 0
  let wb = 0
  let total = 0

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]
    const g = pixels[i + 1]
    const b = pixels[i + 2]
    const alpha = pixels[i + 3]
    if (alpha < 128) continue

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    // Saturation stands in for "how colourful"; near-white and near-grey
    // pixels contribute almost nothing.
    const chroma = max === 0 ? 0 : (max - min) / max
    // Very dark pixels are usually shadow, not product.
    const weight = chroma * chroma * (max > 24 ? 1 : 0.15) + 0.02

    wr += r * weight
    wg += g * weight
    wb += b * weight
    total += weight
  }

  if (total === 0) return null
  return rgbToHex({ r: wr / total, g: wg / total, b: wb / total })
}

/**
 * A human-readable colour name.
 *
 * A hex is useless to a reader, and a model given only `#ae7b43` can say
 * nothing useful about three products all called "T-Shirt".
 */
export function colorName(hex: string): string {
  const { L, a, b } = hexToLab(hex)
  const chroma = Math.hypot(a, b)

  const light = L > 78 ? 'pale ' : L > 58 ? 'light ' : L > 38 ? '' : 'deep '

  if (chroma < 8) {
    if (L > 85) return 'white'
    if (L > 68) return 'light grey'
    if (L > 42) return 'grey'
    if (L > 20) return 'charcoal'
    return 'black'
  }

  const hue = (Math.atan2(b, a) * 180) / Math.PI
  const h = hue < 0 ? hue + 360 : hue

  let base: string
  if (h < 15) base = 'red'
  else if (h < 45) base = chroma < 22 && L < 60 ? 'brown' : 'orange'
  else if (h < 70) base = L < 55 ? 'olive' : 'gold'
  else if (h < 105) base = 'yellow'
  else if (h < 165) base = 'green'
  else if (h < 200) base = 'teal'
  // Navy and similar blues measure near 290 in Lab, not 240; a band ending
  // at 260 misnames them purple.
  else if (h < 300) base = 'blue'
  else if (h < 335) base = 'purple'
  else base = 'pink'

  return (light + base).trim()
}
