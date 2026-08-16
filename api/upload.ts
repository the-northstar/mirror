import { uploadFile } from './_youcam.ts'

/**
 * Uploads the full-length photo used for try-on and returns its file_id.
 *
 * Separate from /api/analyze because try-on needs a standing full-body shot
 * while skin analysis needs a close-up face; one photo cannot satisfy both.
 */

const MAX_BYTES = 10 * 1024 * 1024
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
      image.name || 'body.jpg',
      image.type,
    )
    return Response.json({ fileId })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed'
    console.error('[upload]', message)
    if (message.includes('YOUCAM_API_KEY')) {
      return Response.json({ error: message }, { status: 502 })
    }
    return Response.json(
      { error: 'Could not upload that photo. Please try another.' },
      { status: 502 },
    )
  }
}
