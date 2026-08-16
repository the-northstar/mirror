/**
 * YouCam API client. Server-side only: credentials never reach the browser.
 *
 * Auth is a plain bearer key. There IS a legacy /s2s/v1.0/client/auth flow that
 * RSA-encrypts client_id+timestamp with a public key, and YOUCAM_SECRET_KEY is
 * such a key, but it is not what v2.x uses. Probed live: that endpoint returns
 * 401 InvalidAuthentication while every v2.0 call below succeeds on the bearer
 * key alone. Do not reintroduce the handshake.
 */

const BASE = 'https://yce-api-01.makeupar.com'

/** Carries YouCam's own error_code so callers never scrape it from a string. */
export class YouCamError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 502,
  ) {
    super(message)
    this.name = 'YouCamError'
  }
}

const key = (): string => {
  const k = process.env.YOUCAM_API_KEY
  if (!k) throw new YouCamError('YOUCAM_API_KEY is not set', 'MissingApiKey', 500)
  return k
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      // The space after Bearer is required.
      Authorization: `Bearer ${key()}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  const body = (await res.json().catch(() => null)) as any
  if (!res.ok || body?.status >= 400) {
    throw new YouCamError(
      body?.error ?? res.statusText,
      body?.error_code ?? `HTTP_${res.status}`,
      res.status,
    )
  }
  return body.data as T
}

/* -- Files -------------------------------------------------------------- */

/**
 * Reserve a slot, PUT the bytes, return the file_id.
 *
 * Calling the file API without completing the PUT does not fail here; it
 * surfaces later as an opaque 500 on the task, so both legs always run.
 */
export async function uploadFile(
  bytes: ArrayBuffer,
  fileName: string,
  contentType: string,
): Promise<string> {
  const data = await call<{
    files: Array<{
      file_id: string
      requests: Array<{ method: string; url: string; headers: Record<string, string> }>
    }>
  }>('/s2s/v2.0/file', {
    method: 'POST',
    body: JSON.stringify({
      files: [
        { content_type: contentType, file_name: fileName, file_size: bytes.byteLength },
      ],
    }),
  })

  const file = data.files[0]
  const put = file.requests[0]
  const res = await fetch(put.url, {
    method: put.method,
    headers: put.headers,
    body: bytes,
  })
  if (!res.ok) throw new YouCamError(`Storage upload failed (${res.status})`, 'UploadFailed')

  return file.file_id
}

/* -- Tasks -------------------------------------------------------------- */

export type TaskStatus = 'running' | 'success' | 'error'

/**
 * Submit a task and poll it to completion.
 *
 * Polling is not optional: an abandoned running task expires into
 * InvalidTaskId and still consumes units.
 */
export async function runTask<T>(
  name: string,
  params: Record<string, unknown>,
  opts: { version?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const v = opts.version ?? 'v2.0'
  const { task_id } = await call<{ task_id: string }>(`/s2s/${v}/task/${name}`, {
    method: 'POST',
    body: JSON.stringify(params),
  })

  const deadline = Date.now() + 4 * 60_000
  let wait = 2000

  while (Date.now() < deadline) {
    if (opts.signal?.aborted) throw new YouCamError('Cancelled', 'Cancelled', 499)

    const data = await call<{
      task_status: TaskStatus
      polling_interval?: number
      error?: string | null
      error_code?: string
      results?: T
    }>(`/s2s/${v}/task/${name}/${encodeURIComponent(task_id)}`)

    if (data.task_status === 'success') return data.results as T
    if (data.task_status === 'error') {
      // YouCam reports the failure reason in `error`; keep it as the code so
      // the UI can decide fault without parsing prose.
      throw new YouCamError(
        data.error ?? 'Task failed',
        data.error_code ?? data.error ?? 'TaskFailed',
      )
    }

    if (data.polling_interval) wait = data.polling_interval * 1000
    await new Promise((r) => setTimeout(r, wait))
    wait = Math.min(wait * 1.4, 8000)
  }
  throw new YouCamError('Timed out waiting for YouCam', 'Timeout', 504)
}

/* -- The reading -------------------------------------------------------- */

/** SD set. HD and SD cannot be mixed in one request: that is InvalidParameters. */
export const SD_CONCERNS = [
  'oiliness',
  'moisture',
  'redness',
  'acne',
  'texture',
  'pore',
  'dark_circle_v2',
]

export interface ToneResult {
  color: {
    skin_color: string
    lip_color: string
    eye_color: string
    eyebrow_color: string
    hair_color: string
    eye_color_name?: string
    hair_color_name?: string
  }
  face_quality?: {
    has_face: boolean
    area: string
    frontal: string
    lighting: string
    faceangle: string
  }
}

export interface ConcernOut {
  type: string
  region?: string
  ui_score: number
  raw_score: number
  mask_urls?: string[]
}

/**
 * Skin colour. `results` is an OBJECT here, not an array; reading results[0]
 * silently yields nothing and looks like it works.
 */
export const analyzeTone = (srcFileId: string, signal?: AbortSignal) =>
  runTask<ToneResult>(
    'skin-tone-analysis',
    // Strictness defaults to `high`, which rejects a face more than ~10 degrees
    // off-axis. On a demo floor a rejected selfie costs more than a slightly
    // less precise reading.
    { src_file_id: srcFileId, face_angle_strictness_level: 'flexible' },
    { signal },
  )

/** Skin concerns. `format: json` matters; the API defaults to `zip`. */
export const analyzeConcerns = (srcFileId: string, signal?: AbortSignal) =>
  runTask<{ output: ConcernOut[] }>(
    'skin-analysis',
    { src_file_id: srcFileId, dst_actions: SD_CONCERNS, format: 'json' },
    { signal },
  ).then((r) => r.output)

/**
 * Face attributes.
 *
 * The published bundle documents a nested payload/actions/dst_actions envelope,
 * but the deployed v2.0 endpoint rejects it and requires a FLAT body with
 * `features`. Verified live. The enum values are camelCase either way.
 */
export const analyzeFace = (srcFileId: string, signal?: AbortSignal) =>
  runTask<Record<string, unknown>>(
    'face-attr-analysis',
    { src_file_id: srcFileId, features: ['faceShape', 'age', 'gender'] },
    { signal },
  )

/* -- Try-on ------------------------------------------------------------- */

export type GarmentCategory =
  | 'full_body'
  | 'upper_body'
  | 'lower_body'
  | 'shoes'
  | 'outer'
  | 'auto'

export const tryOnCloth = (
  model: { fileId?: string; url?: string },
  garment: { fileId?: string; url?: string },
  category: GarmentCategory,
  signal?: AbortSignal,
) =>
  runTask<{ url: string }>(
    'cloth-v4',
    {
      ...(model.fileId ? { src_file_id: model.fileId } : { src_file_url: model.url }),
      ...(garment.fileId
        ? { ref_file_id: garment.fileId }
        : { ref_file_url: garment.url }),
      garment_category: category,
    },
    { signal },
  ).then((r) => r.url)

export interface MakeupEffect {
  category: string
  palettes: Array<Record<string, unknown>>
  shape?: Record<string, unknown>
  style?: Record<string, unknown>
  pattern?: Record<string, unknown>
}

/**
 * Makeup try-on.
 *
 * Foundation is applied by skin segmentation, so it takes no shape/pattern and
 * needs all four palette fields. Lip colour additionally requires shape and
 * style. Rendering the prescribed formula on her face is the point: these
 * intensities come from formulaFor(), not from a preset.
 */
export const tryOnMakeup = (
  srcFileId: string,
  effects: MakeupEffect[],
  signal?: AbortSignal,
) =>
  runTask<{ url: string }>(
    'makeup-vto',
    { src_file_id: srcFileId, effects },
    { signal },
  ).then((r) => r.url)

export interface ClothTemplate {
  id: string
  thumb: string
  title: string
  category_name: string
}

/**
 * YouCam's own garment catalogue.
 *
 * A free GET, and the templates are the exact garments the engine renders, so
 * a recommendation can point at the real thing rather than an approximation.
 */
export const clothTemplates = (pageSize = 20, token?: string) =>
  call<{ templates: ClothTemplate[]; next_token?: string }>(
    `/s2s/v2.0/task/template/cloth?page_size=${pageSize}${token ? `&starting_token=${token}` : ''}`,
  )

/**
 * Template-based clothes try-on.
 *
 * Note this is /task/cloth, not cloth-v4: v4 dropped template_id and requires
 * a reference image, so templates only work on the v2 endpoint. Verified live.
 */
export const tryOnClothTemplate = (
  src: { fileId?: string; url?: string },
  templateId: string,
  signal?: AbortSignal,
) =>
  runTask<{ url: string }>(
    'cloth',
    {
      ...(src.fileId ? { src_file_id: src.fileId } : { src_file_url: src.url }),
      template_id: templateId,
    },
    { signal },
  ).then((r) => r.url)

export interface HairTemplate {
  id: string
  thumb: string
  title: string
  category_name: string
  keep_users_color: boolean
}

/** Free GET: YouCam's own style catalogue, so a recommendation can be exact. */
export const hairTemplates = (pageSize = 20) =>
  call<{ templates: HairTemplate[]; next_token?: string }>(
    `/s2s/v2.1/task/template/hair-transfer?page_size=${pageSize}`,
  )

export const tryOnHair = (
  srcFileId: string,
  templateId: string,
  signal?: AbortSignal,
) =>
  runTask<{ url: string }>(
    'hair-transfer',
    { src_file_id: srcFileId, template_id: templateId },
    { version: 'v2.1', signal },
  ).then((r) => r.url)

/* -- Fault ownership ---------------------------------------------------- */

/**
 * Whose problem is this?
 *
 * The `error_` prefix is NOT the test: `error_download_image` is shop-owned and
 * has it, `exceed_max_filesize` is shopper-owned and does not. Kept beside the
 * shopper-facing copy so a newly mapped code cannot be classified one way and
 * explained the other.
 */
const SHOPPER_OWNED: Record<string, string> = {
  error_no_face: 'We could not find a face. Try a clear, front-facing photo.',
  error_src_face_too_small: 'Move closer so your face fills more of the frame.',
  error_lighting_dark: 'Too dark. Try again in brighter, even light.',
  error_src_face_out_of_bound: 'Your face is partly out of frame. Centre yourself.',
  error_pose: 'Stand facing the camera with your whole body in frame.',
  exceed_max_filesize: 'That photo is too large. Use one under 10MB.',
  error_below_min_image_size: 'That photo is too small for try-on.',
  error_exceed_max_image_size:
    'That photo is too large for try-on. Use a smaller one, or retake it.',
  error_nsfw_content_detected: 'That image was rejected by content safety checks.',
}

export function faultOf(code: string): {
  owner: 'shopper' | 'shop'
  message: string
} {
  const shopper = SHOPPER_OWNED[code]
  if (shopper) return { owner: 'shopper', message: shopper }

  if (code === 'CreditInsufficiency') {
    return {
      owner: 'shop',
      message: 'The store is out of API credits right now.',
    }
  }
  return { owner: 'shop', message: 'Something went wrong on our side.' }
}
