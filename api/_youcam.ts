/**
 * Server-side YouCam (Perfect Corp) client.
 *
 * Lives under /api so the key never reaches the browser. Verified against the
 * official OpenAPI bundles at docs.perfectcorp.com.
 *
 * Auth is a plain bearer key — there is a legacy /s2s/v1.0/client/auth RSA
 * handshake still live on this host, but it is undocumented in v2.x. Do not
 * reintroduce it.
 */

const BASE = 'https://yce-api-01.makeupar.com'

const apiKey = (): string => {
  const key = process.env.YOUCAM_API_KEY
  if (!key) throw new Error('YOUCAM_API_KEY is not set')
  return key
}

const authHeaders = () => ({
  // The space after "Bearer" is required.
  Authorization: `Bearer ${apiKey()}`,
  'Content-Type': 'application/json',
})

/** Perfect Corp wraps everything in {status, data} and 200s on some errors. */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...init?.headers },
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const code = body?.error_code ?? res.status
    throw new Error(`YouCam ${path} failed (${code}): ${body?.error ?? res.statusText}`)
  }
  return body.data as T
}

/**
 * Upload bytes and return a file_id usable as src_file_id / ref_file_id.
 *
 * Three legs: reserve a slot, PUT the bytes to S3, then hand back the id.
 * Skipping the PUT does not fail here — it surfaces later as an opaque 500 on
 * the task, so we always complete the upload before returning.
 */
export async function uploadFile(
  bytes: ArrayBuffer,
  fileName: string,
  contentType: string,
): Promise<string> {
  const size = bytes.byteLength
  const data = await call<{
    files: Array<{
      file_id: string
      requests: Array<{ method: string; url: string; headers: Record<string, string> }>
    }>
  }>('/s2s/v2.0/file', {
    method: 'POST',
    body: JSON.stringify({
      files: [{ content_type: contentType, file_name: fileName, file_size: size }],
    }),
  })

  const file = data.files[0]
  const upload = file.requests[0]

  // S3 presigned PUT — send its headers verbatim and no Authorization.
  const put = await fetch(upload.url, {
    method: upload.method,
    headers: upload.headers,
    body: bytes,
  })
  if (!put.ok) throw new Error(`Upload to storage failed: ${put.status}`)

  return file.file_id
}

export type TaskStatus = 'running' | 'success' | 'error'

/**
 * Poll until the task settles.
 *
 * Not optional: the docs are explicit that abandoning a running task makes it
 * expire into InvalidTaskId *while still consuming units*. The docs reference a
 * `polling_interval` but never publish a value, so we read it when present and
 * otherwise back off gently, staying well under the 250-req/300s limit.
 */
async function pollTask<T>(path: string, taskId: string, signal?: AbortSignal): Promise<T> {
  const deadline = Date.now() + 3 * 60_000
  let waitMs = 2000

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('Cancelled')

    const data = await call<{
      task_status: TaskStatus
      polling_interval?: number
      error?: string | null
      results?: T
    }>(`${path}/${encodeURIComponent(taskId)}`)

    if (data.task_status === 'success') return data.results as T
    if (data.task_status === 'error') {
      throw new Error(`Task failed: ${data.error ?? 'unknown error'}`)
    }

    // polling_interval is documented in seconds where it appears.
    if (data.polling_interval) waitMs = data.polling_interval * 1000
    await new Promise((r) => setTimeout(r, waitMs))
    waitMs = Math.min(waitMs * 1.4, 8000)
  }
  throw new Error('Timed out waiting for YouCam task')
}

/** One concern reading. `raw_score` is the true value; `ui_score` is inflated. */
export interface SkinResult {
  type: string
  region?: string
  ui_score: number
  raw_score: number
  mask_urls?: string[]
}

/**
 * Run skin analysis.
 *
 * `format: 'json'` is deliberate — the API defaults to 'zip', which returns a
 * completely different response shape.
 *
 * HD and SD concerns cannot be mixed in one request; the caller supplies one
 * consistent set.
 */
export async function analyzeSkin(
  srcFileId: string,
  concerns: string[],
  signal?: AbortSignal,
): Promise<SkinResult[]> {
  const { task_id } = await call<{ task_id: string }>('/s2s/v2.0/task/skin-analysis', {
    method: 'POST',
    body: JSON.stringify({
      src_file_id: srcFileId,
      dst_actions: concerns,
      format: 'json',
    }),
  })

  const results = await pollTask<{ output: SkinResult[] }>(
    '/s2s/v2.0/task/skin-analysis',
    task_id,
    signal,
  )
  return results.output
}

export type GarmentCategory =
  | 'full_body'
  | 'upper_body'
  | 'lower_body'
  | 'shoes'
  | 'outer'
  | 'auto'

/**
 * Run apparel try-on (v4 — `outer` exists only on this version).
 *
 * Garment may be a file_id or a public URL; model likewise.
 */
export async function tryOnGarment(
  model: { fileId?: string; url?: string },
  garment: { fileId?: string; url?: string },
  category: GarmentCategory,
  signal?: AbortSignal,
): Promise<string> {
  const { task_id } = await call<{ task_id: string }>('/s2s/v2.0/task/cloth-v4', {
    method: 'POST',
    body: JSON.stringify({
      ...(model.fileId ? { src_file_id: model.fileId } : { src_file_url: model.url }),
      ...(garment.fileId ? { ref_file_id: garment.fileId } : { ref_file_url: garment.url }),
      garment_category: category,
    }),
  })

  const results = await pollTask<{ url: string }>('/s2s/v2.0/task/cloth-v4', task_id, signal)
  // Result links expire after 2 hours; re-poll the task_id for a fresh one.
  return results.url
}
