/** Browser-side calls to our own /api proxy. The YouCam key never lands here. */

export type GarmentCategory =
  | 'full_body'
  | 'upper_body'
  | 'lower_body'
  | 'shoes'
  | 'outer'
  | 'auto'

export interface SkinRow {
  type: string
  region?: string
  ui_score: number
  raw_score: number
  mask_urls?: string[]
}

export interface AnalyzeResponse {
  scores: Record<string, number>
  results: SkinRow[]
  modelFileId: string
}

async function unwrap<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error ?? 'Something went wrong. Please try again.')
  return body as T
}

export async function analyzeSkin(image: File, signal?: AbortSignal) {
  const form = new FormData()
  form.append('image', image)
  return unwrap<AnalyzeResponse>(
    await fetch('/api/analyze', { method: 'POST', body: form, signal }),
  )
}

export async function tryOn(
  modelFileId: string,
  garmentUrl: string,
  category: GarmentCategory,
  signal?: AbortSignal,
) {
  return unwrap<{ url: string }>(
    await fetch('/api/tryon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelFileId,
        // YouCam fetches ref_file_url from its own servers, so a relative
        // catalog path has to become an absolute, publicly reachable URL.
        garmentUrl: new URL(garmentUrl, location.origin).href,
        category,
      }),
      signal,
    }),
  )
}
