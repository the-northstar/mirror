/**
 * Past scans, kept in the browser.
 *
 * A scan costs API units, so re-using one is free where re-uploading is not.
 * The photo is stored as a data URL because an object URL dies with the tab and
 * would leave a broken thumbnail behind.
 */

export interface PastScan {
  id: string
  at: number
  photo: string
  fileId: string
  skinHex: string
  season: string
  /** Whole reading, so re-opening one costs nothing. */
  reading: unknown
}

const KEY = 'mirror.scans'
const MAX = 8

export function loadScans(): PastScan[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as PastScan[]) : []
  } catch {
    return []
  }
}

export function saveScan(scan: Omit<PastScan, 'id' | 'at'>): PastScan[] {
  const next: PastScan = { ...scan, id: crypto.randomUUID(), at: Date.now() }
  // Newest first, capped: localStorage is small and data URLs are not.
  const all = [next, ...loadScans()].slice(0, MAX)
  persist(all)
  return all
}

export function removeScan(id: string): PastScan[] {
  const all = loadScans().filter((s) => s.id !== id)
  persist(all)
  return all
}

function persist(all: PastScan[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // Quota is the usual failure. Drop the oldest and try once more rather
    // than losing the scan the user just paid for.
    try {
      localStorage.setItem(KEY, JSON.stringify(all.slice(0, 3)))
    } catch {
      // Out of room entirely; history is a convenience, not the product.
    }
  }
}

/** Files are what the camera and picker hand us; storage needs a data URL. */
export const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('Could not read that photo.'))
    r.readAsDataURL(file)
  })

export const relativeTime = (at: number): string => {
  const mins = Math.round((Date.now() - at) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}
