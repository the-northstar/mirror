import type { Demand, Finish } from './coverage'

/**
 * Who actually scanned, as a brand is allowed to see it.
 *
 * The coverage panel says who a range COULD fail; this says who it DID. Each
 * entry is a measured skin colour and the finish prescribed for it, and
 * nothing else — no photo, no file id, no identity, and only the day. That is
 * enough to place a shopper against a range and too little to point at one.
 *
 * Keyed by store, so an embedded store sees its own shoppers. Scans in the
 * main app are kept under MIRROR.
 */

export const MIRROR = 'mirror'

/** Per store, oldest dropped first. A ledger of colours, not a history. */
const MAX_PER_STORE = 5000

interface Entry extends Demand {
  /** ISO day only. */
  day: string
}

const ledger = new Map<string, Entry[]>()

/**
 * Record one scan. Returns false when it was already counted today.
 *
 * The shop is requested again whenever a shopper changes who they are
 * shopping for, so the same face would otherwise be counted once per click.
 * Colour, finish and day together are the key: the same face on the same day
 * is one shopper.
 */
export function recordDemand(store: string, skinHex: string, finish: Finish, now = Date.now()): boolean {
  if (!/^#[0-9a-f]{6}$/i.test(skinHex)) return false
  const day = new Date(now).toISOString().slice(0, 10)
  const hex = skinHex.toLowerCase()
  const rows = ledger.get(store) ?? []
  if (rows.some((r) => r.day === day && r.skinHex === hex && r.finish === finish)) return false
  rows.push({ skinHex: hex, finish, day })
  if (rows.length > MAX_PER_STORE) rows.splice(0, rows.length - MAX_PER_STORE)
  ledger.set(store, rows)
  return true
}

export const demandFor = (store: string): Demand[] =>
  (ledger.get(store) ?? []).map(({ skinHex, finish }) => ({ skinHex, finish }))

export type DemandSnapshot = Record<string, Entry[]>

export const snapshotDemand = (): DemandSnapshot => Object.fromEntries(ledger)

export function restoreDemand(snap: DemandSnapshot): void {
  ledger.clear()
  for (const [store, rows] of Object.entries(snap ?? {})) {
    if (Array.isArray(rows)) ledger.set(store, rows.slice(-MAX_PER_STORE))
  }
}
