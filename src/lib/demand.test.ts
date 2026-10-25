import { beforeEach, expect, test } from 'bun:test'
import { demandFor, recordDemand, restoreDemand, snapshotDemand } from './demand'

const DAY = 24 * 60 * 60 * 1000
const t0 = Date.UTC(2026, 9, 26, 12)

beforeEach(() => restoreDemand({}))

test('the same face on the same day is one shopper, however often the shop reloads', () => {
  expect(recordDemand('s', '#8A6A50', 'matte', t0)).toBe(true)
  expect(recordDemand('s', '#8a6a50', 'matte', t0 + 1000)).toBe(false)
  expect(recordDemand('s', '#8a6a50', 'matte', t0 + DAY)).toBe(true)
  expect(demandFor('s')).toHaveLength(2)
})

test('a different finish for the same colour is a different shopper', () => {
  recordDemand('s', '#8a6a50', 'matte', t0)
  recordDemand('s', '#8a6a50', 'dewy', t0)
  expect(demandFor('s').map((d) => d.finish)).toEqual(['matte', 'dewy'])
})

test('only a colour and a finish leave the ledger — not even the day', () => {
  recordDemand('s', '#8a6a50', 'natural', t0)
  expect(demandFor('s')).toEqual([{ skinHex: '#8a6a50', finish: 'natural' }])
})

test('stores never see each other, and junk colours are not recorded', () => {
  recordDemand('a', '#111111', 'matte', t0)
  expect(recordDemand('b', 'not-a-hex', 'matte', t0)).toBe(false)
  expect(demandFor('b')).toEqual([])
})

test('the ledger survives a restart through its snapshot', () => {
  recordDemand('s', '#8a6a50', 'dewy', t0)
  const snap = JSON.parse(JSON.stringify(snapshotDemand()))
  restoreDemand({})
  expect(demandFor('s')).toEqual([])
  restoreDemand(snap)
  expect(demandFor('s')).toHaveLength(1)
})
