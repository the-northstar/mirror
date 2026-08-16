/**
 * API proxy. The YouCam key lives here and never reaches the browser.
 *
 * Also serves the built frontend and the renders directory, so one process runs
 * the whole app on any host.
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  analyzeConcerns,
  analyzeFace,
  analyzeTone,
  faultOf,
  hairTemplates,
  tryOnCloth,
  tryOnHair,
  tryOnMakeup,
  uploadFile,
  YouCamError,
  type ConcernOut,
  type GarmentCategory,
} from './src/lib/youcam'
import { formulaFor, paletteFor } from './src/lib/prescription'
import { GARMENTS } from './src/lib/garments'

const PORT = Number(process.env.PORT) || 8787
const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED = ['image/jpeg', 'image/png']

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/** Turn any thrown error into a fault-classified response. */
function fail(err: unknown, where: string): Response {
  const e =
    err instanceof YouCamError
      ? err
      : new YouCamError(String((err as Error)?.message ?? err), 'Unknown')
  const { owner, message } = faultOf(e.code)
  console.error(`[${where}] ${e.code}: ${e.message}`)
  return json({ error: message, code: e.code, owner }, owner === 'shopper' ? 400 : 502)
}

async function readImage(req: Request): Promise<File> {
  const form = await req.formData()
  const image = form.get('image')
  if (!(image instanceof File)) throw new YouCamError('No image supplied.', 'error_no_image', 400)
  if (!ALLOWED.includes(image.type)) {
    throw new YouCamError('Please upload a JPEG or PNG.', 'error_bad_format', 400)
  }
  if (image.size > MAX_BYTES) {
    throw new YouCamError('Photo is over 10MB.', 'exceed_max_filesize', 400)
  }
  return image
}

const routes: Record<string, (req: Request) => Promise<Response>> = {
  /**
   * The reading: one upload, three tasks.
   *
   * The concern half may fail alone. A colour reading still recommends a shade,
   * so each half is settled independently rather than failing wholesale.
   */
  'POST /api/read': async (req) => {
    const image = await readImage(req)
    const fileId = await uploadFile(
      await image.arrayBuffer(),
      image.name || 'face.jpg',
      image.type,
    )

    const [tone, concerns, face] = await Promise.allSettled([
      analyzeTone(fileId, req.signal),
      analyzeConcerns(fileId, req.signal),
      analyzeFace(fileId, req.signal),
    ])

    // Colour is the one hard requirement: without it there is no shade and no
    // palette, so that failure is the shopper's to fix.
    if (tone.status === 'rejected') throw tone.reason

    const rows: ConcernOut[] = concerns.status === 'fulfilled' ? concerns.value : []
    const skinHex = tone.value.color.skin_color

    return json({
      fileId,
      color: tone.value.color,
      faceQuality: tone.value.face_quality ?? null,
      concerns: rows,
      face: face.status === 'fulfilled' ? face.value : null,
      palette: paletteFor(skinHex),
      formula: formulaFor(rows),
      // Say plainly which halves answered, rather than passing a partial
      // reading off as complete.
      partial: {
        concerns: concerns.status === 'fulfilled',
        face: face.status === 'fulfilled',
      },
    })
  },

  'POST /api/upload': async (req) => {
    const image = await readImage(req)
    const fileId = await uploadFile(
      await image.arrayBuffer(),
      image.name || 'body.jpg',
      image.type,
    )
    return json({ fileId })
  },

  /**
   * Clothes try-on.
   *
   * The garment URL is resolved from the catalogue by id, never taken from the
   * request body, or the browser could point this server at an arbitrary host.
   */
  'POST /api/tryon/cloth': async (req) => {
    const { modelFileId, garmentId } = (await req.json()) as {
      modelFileId?: string
      garmentId?: string
    }
    if (!modelFileId) return json({ error: 'Missing model photo.' }, 400)

    const garment = GARMENTS.find((g) => g.id === garmentId)
    if (!garment) return json({ error: 'Unknown garment.' }, 400)

    const url = await tryOnCloth(
      { fileId: modelFileId },
      { url: absolute(garment.url, req) },
      garment.category as GarmentCategory,
      req.signal,
    )
    return json({ url })
  },

  /** Makeup try-on, rendering the intensities formulaFor() computed. */
  'POST /api/tryon/makeup': async (req) => {
    const { fileId, effects } = (await req.json()) as {
      fileId?: string
      effects?: unknown
    }
    if (!fileId) return json({ error: 'Missing photo.' }, 400)
    if (!Array.isArray(effects) || effects.length === 0) {
      return json({ error: 'No makeup effects supplied.' }, 400)
    }
    const url = await tryOnMakeup(fileId, effects as never, req.signal)
    return json({ url })
  },

  'GET /api/hair/templates': async () => json(await hairTemplates(20)),

  'POST /api/tryon/hair': async (req) => {
    const { fileId, templateId } = (await req.json()) as {
      fileId?: string
      templateId?: string
    }
    if (!fileId || !templateId) return json({ error: 'Missing photo or style.' }, 400)
    const url = await tryOnHair(fileId, templateId, req.signal)
    return json({ url })
  },

  'GET /api/catalogue': async () => json({ garments: GARMENTS }),
}

/** YouCam fetches ref_file_url from its own servers, so it must be public. */
function absolute(path: string, req: Request): string {
  if (/^https?:\/\//i.test(path)) return path
  const base = process.env.PUBLIC_BASE_URL ?? new URL(req.url).origin
  return new URL(path, base).href
}

const DIST = 'dist'
const MIME: Record<string, string> = {
  html: 'text/html',
  js: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  webmanifest: 'application/manifest+json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
}

Bun.serve({
  port: PORT,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url)
    const route = routes[`${req.method} ${url.pathname}`]

    if (route) {
      try {
        return await route(req)
      } catch (err) {
        return fail(err, url.pathname)
      }
    }

    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404)

    // Renders are served from here, not from Vite's public dir: Vite's static
    // middleware does not notice a just-written file and answers index.html,
    // which makes every first try-on look broken.
    if (url.pathname.startsWith('/generated/')) {
      const f = Bun.file(join('renders', url.pathname.slice('/generated/'.length)))
      return (await f.exists()) ? new Response(f) : new Response('Not found', { status: 404 })
    }

    const path = url.pathname === '/' ? '/index.html' : url.pathname
    const file = Bun.file(join(DIST, path.replace(/^\/+/, '')))
    if (await file.exists()) {
      const ext = path.split('.').pop() ?? ''
      return new Response(file, {
        headers: { 'Content-Type': MIME[ext] ?? 'application/octet-stream' },
      })
    }
    const index = Bun.file(join(DIST, 'index.html'))
    return (await index.exists())
      ? new Response(index, { headers: { 'Content-Type': 'text/html' } })
      : new Response('Run "bun run build" first.', { status: 404 })
  },
})

if (!process.env.YOUCAM_API_KEY) {
  console.warn('\n  !  YOUCAM_API_KEY is not set. Add it to .env.\n')
}
console.log(`  ->  http://localhost:${PORT}\n`)
