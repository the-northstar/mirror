import { tryOnGarment, type GarmentCategory } from './_youcam.js'

const CATEGORIES: GarmentCategory[] = [
  'full_body',
  'upper_body',
  'lower_body',
  'shoes',
  'outer',
  'auto',
]

export const config = { runtime: 'nodejs', maxDuration: 300 }

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  try {
    const { modelFileId, garmentUrl, category } = await req.json()

    if (!modelFileId || typeof modelFileId !== 'string') {
      return Response.json({ error: 'Missing model photo.' }, { status: 400 })
    }
    if (!garmentUrl || typeof garmentUrl !== 'string') {
      return Response.json({ error: 'Missing garment.' }, { status: 400 })
    }
    if (!CATEGORIES.includes(category)) {
      return Response.json({ error: 'Unknown garment category.' }, { status: 400 })
    }

    const url = await tryOnGarment(
      { fileId: modelFileId },
      { url: garmentUrl },
      category,
      req.signal,
    )
    return Response.json({ url })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Try-on failed'
    console.error('[tryon]', message)
    return Response.json({ error: friendly(message) }, { status: 502 })
  }
}

function friendly(message: string): string {
  if (message.includes('error_pose')) return 'Stand facing the camera, full body in frame, and try again.'
  if (message.includes('error_invalid_src')) return 'That photo will not work for try-on. Use a clear, full-length shot.'
  if (message.includes('error_invalid_ref')) return 'This garment image could not be processed.'
  if (message.includes('min_image_size')) return 'That photo is too small — try-on needs at least 512×384.'
  if (message.includes('nsfw')) return 'That image was rejected by content safety checks.'
  return 'Virtual try-on failed. Please try a different photo.'
}
