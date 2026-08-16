/**
 * Normalise a picked photo before it reaches the API.
 *
 * YouCam accepts jpg/jpeg/png only, so WebP, HEIC and friends are converted
 * here rather than rejected at the picker. The browser already decodes these
 * formats to draw them, so re-encoding is a canvas round-trip with no library.
 */

/** What YouCam takes as-is. */
const NATIVE = ['image/jpeg', 'image/png']

/** The API caps uploads at 10MB, and oversized photos are the usual cause. */
const MAX_BYTES = 10 * 1024 * 1024
const MAX_EDGE = 2560

export async function normalizeImage(file: File): Promise<File> {
  const needsConvert = !NATIVE.includes(file.type)
  const needsShrink = file.size > MAX_BYTES

  if (!needsConvert && !needsShrink) return file

  const bitmap = await decode(file)
  try {
    // Long edge is capped at what the analysis engines use anyway, so this
    // costs no precision while bringing big phone photos under the limit.
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not read that image.')
    ctx.drawImage(bitmap, 0, 0, w, h)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92),
    )
    if (!blob) throw new Error('Could not convert that image.')

    const name = file.name.replace(/\.[^.]+$/, '') || 'photo'
    return new File([blob], `${name}.jpg`, { type: 'image/jpeg' })
  } finally {
    bitmap.close?.()
  }
}

/**
 * createImageBitmap handles every format the browser can decode, including
 * WebP and AVIF. Safari needs the <img> fallback for some of them.
 */
async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file)
  } catch {
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return await createImageBitmap(img)
    } catch {
      throw new Error(
        'That image format could not be read. Try a JPEG or PNG.',
      )
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

/** Everything the picker will take, given we convert what we must. */
export const ACCEPTED_TYPES =
  'image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif,image/gif,image/bmp,image/tiff'
