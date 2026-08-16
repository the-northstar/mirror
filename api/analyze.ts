import { uploadFile, analyzeSkin, type SkinResult } from './_youcam.ts'

/** SD set. Enough for the styling bridge without HD's larger image demands. */
const CONCERNS = ['redness', 'age_spot', 'texture', 'acne', 'oiliness', 'moisture', 'radiance', 'pore']

const MAX_BYTES = 10 * 1024 * 1024 // API hard limit
const ALLOWED = ['image/jpeg', 'image/png']

export const config = { runtime: 'nodejs', maxDuration: 300 }

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  try {
    const form = await req.formData()
    const image = form.get('image')

    if (!(image instanceof File)) {
      return Response.json({ error: 'No image supplied.' }, { status: 400 })
    }
    if (!ALLOWED.includes(image.type)) {
      return Response.json(
        { error: 'Please upload a JPEG or PNG photo.' },
        { status: 400 },
      )
    }
    if (image.size > MAX_BYTES) {
      return Response.json(
        { error: 'That photo is over the 10MB limit. Try a smaller one.' },
        { status: 400 },
      )
    }

    const fileId = await uploadFile(
      await image.arrayBuffer(),
      image.name || 'selfie.jpg',
      image.type,
    )
    const results = await analyzeSkin(fileId, CONCERNS, req.signal)

    // Flatten to concern -> raw_score for the styling logic, keeping the full
    // rows for the report UI (masks, per-region breakdown, display scores).
    const scores: Record<string, number> = {}
    for (const r of results as SkinResult[]) {
      // Region-subdivided concerns repeat the type; "whole" is the summary row.
      if (!r.region || r.region === 'whole' || !(r.type in scores)) {
        scores[r.type] = r.raw_score
      }
    }

    return Response.json({ scores, results, modelFileId: fileId })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Analysis failed'
    console.error('[analyze]', message)
    return Response.json({ error: friendly(message) }, { status: 502 })
  }
}

/** Map YouCam's error codes onto something a user can act on. */
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
  if (message.includes('error_no_face')) return 'We could not find a face in that photo. Try a clear, front-facing selfie.'
  if (message.includes('face_too_small')) return 'Move closer to the camera. Your face needs to fill more of the frame.'
  if (message.includes('lighting_dark')) return 'That photo is too dark. Try again in brighter, even light.'
  if (message.includes('face_out_of_bound')) return 'Your face is partly out of frame. Centre yourself and retake.'
  return 'Skin analysis failed. Please try another photo.'
}
