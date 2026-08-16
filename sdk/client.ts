/**
 * Mirror headless client.
 *
 * The whole engine with no UI attached: scan a face, get the reading, rank a
 * catalogue against it, render a try-on. Everything the widget does, it does
 * through this — so anything the widget can show, a retailer's own UI can too.
 *
 *   const mirror = createMirror({ storeId: 'store-acme-1' })
 *   const reading = await mirror.scan(file)
 *   const shop    = await mirror.shop(reading)
 */

export interface MirrorConfig {
  /** Which shelf to rank. Omit to rank the public feeds only. */
  storeId?: string
  /** Where the API lives. Override when self-hosting. */
  baseUrl?: string
}

export interface Reading {
  fileId: string
  color: Record<string, string>
  concerns: Array<{ type: string; ui_score: number; raw_score: number }>
  face: Record<string, unknown> | null
  palette: {
    season: string
    undertone: string
    depth: number
    swatches: Array<{ name: string; hex: string }>
    reason: string
  }
  formula: {
    finish: string
    glowIntensity: number
    coverageIntensity: number
    because: string[]
  }
}

export interface RankedProduct {
  id: string
  aisle: string
  brand: string
  name: string
  hex: string
  colorName: string
  shadeName?: string
  price?: number
  image?: string
  url?: string
  /** Why this product, in the shopper's words. */
  reason: string
}

export interface Shop {
  palette: Reading['palette']
  formula: Reading['formula']
  shortlists: Record<string, RankedProduct[]>
  picks: Record<string, { productId: string; reason: string }>
  together: string
  makeup: { effects: unknown[]; explain: string }
}

const DEFAULT_BASE = 'https://mirror.pykero.com'

/** Every failure arrives as this, so callers need one catch, not three. */
export class MirrorError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'MirrorError'
  }
}

export function createMirror(config: MirrorConfig = {}) {
  const base = (config.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '')

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${base}${path}`, init)
    // The server answers JSON on every path, including errors — but a proxy in
    // front of it may not, so a non-JSON body is reported as itself rather
    // than throwing an opaque parse error.
    const body = await res.json().catch(() => null)
    if (!res.ok) {
      throw new MirrorError(
        (body as { error?: string })?.error ?? `Request failed (${res.status}).`,
        res.status,
      )
    }
    return body as T
  }

  return {
    /**
     * Read a face. One selfie in, the full measurement out.
     *
     * Costs API units, so hold the result: shop() and tryOn() both take it
     * without re-scanning.
     */
    async scan(image: File | Blob): Promise<Reading> {
      const form = new FormData()
      form.append('image', image)
      return call<Reading>('/api/read', { method: 'POST', body: form })
    },

    /** Rank the catalogue against a reading. */
    async shop(reading: Reading): Promise<Shop> {
      return call<Shop>('/api/shop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skinHex: reading.color.skin_color,
          lipHex: reading.color.lip_color,
          concerns: reading.concerns,
          faceShape: (reading.face as { faceshape?: string } | null)?.faceshape,
          gender: (reading.face as { agegender?: { gender?: string } } | null)?.agegender?.gender,
          storeId: config.storeId,
        }),
      })
    },

    /** Render makeup onto the scanned face. Returns an image URL. */
    async tryOnMakeup(reading: Reading, effects: unknown[]): Promise<string> {
      const { url } = await call<{ url: string }>('/api/tryon/makeup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: reading.fileId, effects }),
      })
      return url
    },

    /** The store's own shelf, unranked — useful for a "shop all" view. */
    async catalogue(): Promise<RankedProduct[]> {
      if (!config.storeId) return []
      const { products } = await call<{ products: RankedProduct[] }>(
        `/api/sdk/catalogue?storeId=${encodeURIComponent(config.storeId)}`,
      )
      return products
    },
  }
}

export type Mirror = ReturnType<typeof createMirror>
