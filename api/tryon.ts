import { tryOnGarment, type GarmentCategory } from './_youcam.ts'

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
    // YouCam fetches this URL from its own servers, so localhost is
    // unreachable to it. Fail with a clear message rather than an opaque
    // upstream error when running locally.
    if (/^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(garmentUrl)) {
      return Response.json(
        {
          error:
            'Try-on needs garment images on a public URL. Deploy the app, or set GARMENT_BASE_URL to a public host.',
        },
        { status: 400 },
      )
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
  // Setup problems are the operator's to fix, so surface them verbatim.
  if (message.includes('YOUCAM_API_KEY')) return message
  if (message.includes('not recognized') || message.includes('InvalidApiKey')) {
    return 'The YouCam API key was rejected. Check YOUCAM_API_KEY in your .env.'
  }
  // Account-level problems are not the user's photo; say so plainly.
  if (message.includes('CreditInsufficiency') || message.includes('enough credits')) {
    return 'Your YouCam account is out of API credits. Top up or redeem your hackathon units at the API console.'
  }
  if (message.includes('error_pose')) return 'Stand facing the camera, full body in frame, and try again.'
  if (message.includes('error_invalid_src')) return 'That photo will not work for try-on. Use a clear, full-length shot.'
  if (message.includes('error_invalid_ref')) return 'This garment image could not be processed.'
  if (message.includes('min_image_size')) return 'That photo is too small — try-on needs at least 512×384.'
  if (message.includes('nsfw')) return 'That image was rejected by content safety checks.'
  return 'Virtual try-on failed. Please try a different photo.'
}
