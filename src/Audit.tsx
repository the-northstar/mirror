/**
 * The coverage audit, for the people who stock the shelves.
 *
 * Every other screen asks what suits one face. This one asks a brand who its
 * range fails, which its own data can never tell it: a shopper with no shade
 * leaves without buying, so she appears in neither the sales nor the returns.
 *
 * Public on purpose. A judge, a buyer or a founder can run it on the sample
 * range or their own sheet without an account; a signed-in store gets the same
 * view of its own catalogue, plus the shoppers who actually scanned there.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizeImage } from './lib/image'
import type {
  Audit as Report,
  Cell,
  DemandReport,
  Finding,
  Placement,
  SkinType,
  Verdict,
} from './lib/coverage'

/** What the audit needs from a scan: the reading, never the photo. */
export interface ScanForAudit {
  fileId: string
  skinHex: string
  concerns: Array<{ type: string; ui_score: number; raw_score: number }>
}

type Source =
  | { kind: 'sample' }
  | { kind: 'csv'; name: string; text: string }
  | { kind: 'mirror' }
  | { kind: 'store'; storeId: string }

interface FaceResult extends Placement {
  skinHex: string
  need: string
  onScale: { at: number; hex: string; dE: number }
  renders: {
    needed: { label: string; effects: unknown[] }
    stocked: { label: string; effects: unknown[] } | null
  }
}

interface Result {
  label: string
  note: string
  intake: { rejected: Array<{ name: string; why: string }>; skipped: number } | null
  audit: Report
  demand: DemandReport | null
  face: FaceResult | null
}

const MAX_CSV = 2 * 1024 * 1024

export default function Audit({ scan, storeId }: { scan?: ScanForAudit | null; storeId?: string }) {
  const [source, setSource] = useState<Source>(storeId ? { kind: 'store', storeId } : { kind: 'sample' })
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The face placed in the range, once someone asks for it. */
  const [face, setFace] = useState<ScanForAudit | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const run = useCallback(async (src: Source, placed: ScanForAudit | null) => {
    setBusy(true)
    setError(null)
    try {
      const body: Record<string, unknown> =
        src.kind === 'store'
          ? { source: 'store', storeId: src.storeId }
          : src.kind === 'mirror'
            ? { source: 'mirror' }
            : {
                source: 'csv',
                csv: src.kind === 'csv' ? src.text : await (await fetch('/sample-range.csv')).text(),
              }
      if (placed) body.face = { skinHex: placed.skinHex, concerns: placed.concerns }
      const res = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.audit) throw new Error(json?.error ?? 'The audit failed.')
      setResult(json)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void run(source, face)
  }, [run, source, face])

  const upload = async (file: File) => {
    if (file.size > MAX_CSV) {
      setError('That file is over 2 MB.')
      return
    }
    setSource({ kind: 'csv', name: file.name, text: await file.text() })
  }

  const audit = result?.audit

  return (
    <main className="wrap stack-lg audit">
      {!storeId && (
        <header className="audit-head">
          <span className="kicker">For brands · Coverage audit</span>
          <h1 className="display">Who can't buy from your range?</h1>
          <p className="lead">
            A shade finder checks one face. This checks every face: your catalogue against
            the whole Monk Skin Tone Scale and three skin types, on shade <em>and</em>{' '}
            formula, with the same matching Mirror uses for shoppers. No model, no guessing —
            every line names the measurement behind it.
          </p>
        </header>
      )}

      <nav className="aisles" aria-label="What to audit">
        {storeId ? (
          <button className="aisle on" aria-current>
            Your catalogue
          </button>
        ) : (
          <>
            <button
              className={source.kind === 'sample' ? 'aisle on' : 'aisle'}
              aria-current={source.kind === 'sample'}
              onClick={() => setSource({ kind: 'sample' })}
            >
              Sample range
            </button>
            <button
              className={source.kind === 'csv' ? 'aisle on' : 'aisle'}
              aria-current={source.kind === 'csv'}
              onClick={() => fileRef.current?.click()}
            >
              {source.kind === 'csv' ? source.name : 'Upload your range'}
            </button>
            <button
              className={source.kind === 'mirror' ? 'aisle on' : 'aisle'}
              aria-current={source.kind === 'mirror'}
              onClick={() => setSource({ kind: 'mirror' })}
            >
              Mirror's own shelves
            </button>
          </>
        )}
      </nav>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void upload(f)
          e.target.value = ''
        }}
      />

      <SourceNote source={source} result={result} />

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}

      {!audit && busy && <p className="tiny">Auditing every point on the scale…</p>}

      {result && audit && (
        <div className={busy ? 'stack-lg audit-body is-busy' : 'stack-lg audit-body'} aria-busy={busy}>
          <Headline audit={audit} demand={result.demand} />
          <Strip cells={audit.cells} />
          <Findings findings={audit.findings} />
          {result.demand && <Demand demand={result.demand} />}
          <FaceTest
            scan={scan ?? null}
            placed={face}
            result={result.face}
            onPlace={setFace}
            onError={setError}
          />
          <Method />
        </div>
      )}
    </main>
  )
}

/* -- Pieces ------------------------------------------------------------------ */

function SourceNote({ source, result }: { source: Source; result: Result | null }) {
  if (source.kind === 'sample') {
    return (
      <p className="tiny">
        <strong>Demo Brand is fictional</strong> — a small range built to show each kind of
        gap. It goes through the same upload path yours would.{' '}
        <a href="/sample-range.csv" download>
          Download it
        </a>{' '}
        to see the columns: name, aisle, hex, and optionally shade, finish, brand.
      </p>
    )
  }
  if (source.kind === 'csv') {
    const skipped = result?.intake?.skipped ?? 0
    const rejected = result?.intake?.rejected ?? []
    return (
      <div className="stack">
        <p className="tiny">
          {result?.note ?? 'Audited from the file you uploaded. Nothing in it is stored.'}
          {skipped > 0 && ` ${skipped} row${skipped === 1 ? '' : 's'} from other aisles were set aside.`}
        </p>
        {rejected.length > 0 && (
          <p className="notice" role="status">
            {rejected.length} row{rejected.length === 1 ? '' : 's'} could not be read:{' '}
            {rejected.slice(0, 4).map((r) => `${r.name} (${r.why.replace(/\.$/, '')})`).join('; ')}
            {rejected.length > 4 ? '…' : '.'}
          </p>
        )}
      </div>
    )
  }
  return result ? <p className="tiny">{result.note}</p> : null
}

const pct = (v: number) => `${Math.round(v * 100)}%`

function Headline({ audit, demand }: { audit: Report; demand: DemandReport | null }) {
  const c = audit.catalogue
  return (
    <section className="books audit-books" aria-label="Coverage at a glance">
      <div className="figure">
        <strong>{pct(audit.shadeCoverage)}</strong>
        <span className="tiny">of the scale has a shade within 5 ΔE</span>
      </div>
      <div className="figure">
        <strong>
          {pct(audit.formulaCoverage.oily)} · {pct(audit.formulaCoverage.balanced)} ·{' '}
          {pct(audit.formulaCoverage.dry)}
        </strong>
        <span className="tiny">served in the right finish: oily · balanced · dry</span>
      </div>
      <div className="figure">
        <strong>{c.base}</strong>
        <span className="tiny">
          bases audited{c.setAside ? `, ${c.setAside} powders and concealers set aside` : ''}
        </span>
      </div>
      {demand && demand.count > 0 ? (
        <div className="figure">
          <strong>
            {demand.count - demand.byVerdict.served} of {demand.count}
          </strong>
          <span className="tiny">real shoppers who scanned found no match</span>
        </div>
      ) : (
        <div className="figure">
          <strong>{c.blush + c.lipstick}</strong>
          <span className="tiny">blushes and lipsticks checked across tones</span>
        </div>
      )}
    </section>
  )
}

const SKIN_ROWS: Array<{ skin: SkinType; label: string }> = [
  { skin: 'oily', label: 'Oily skin · needs matte' },
  { skin: 'balanced', label: 'Balanced · needs natural' },
  { skin: 'dry', label: 'Dry skin · needs dewy' },
]

const VERDICT_WORD: Record<Verdict, string> = {
  served: 'Served',
  'wrong-finish': 'Right shade, wrong finish',
  'finish-unstated': 'Shade matches, finish unstated',
  'no-shade': 'No shade within 5 ΔE',
}

function cellTitle(c: Cell): string {
  const where = `Monk ${Number.isInteger(c.at) ? c.at : c.at.toFixed(2)} · ${c.hex}`
  const near = c.closest
    ? ` — closest: ${c.closest.name}${c.closest.shadeName ? ` ${c.closest.shadeName}` : ''}, ${c.closest.dE.toFixed(1)} ΔE${c.closest.finish ? `, ${c.closest.finish}` : ''}`
    : ''
  return `${where}\n${VERDICT_WORD[c.verdict]}${near}`
}

/**
 * The scale, drawn as three rows of the skin it stands for.
 *
 * Each cell is painted in its own skin colour, so a gap reads as a stretch of
 * faces with nothing on the shelf rather than as an abstract red block.
 */
function Strip({ cells }: { cells: Cell[] }) {
  const rungs = [...new Set(cells.map((c) => c.at))].sort((a, b) => a - b)
  const anchors = rungs
    .map((at, i) => ({ at, i }))
    .filter((r) => Number.isInteger(r.at))
  return (
    <section className="card stack strip">
      <div>
        <span className="kicker">Monk Skin Tone Scale, 1 to 10</span>
        <h2 className="strip-title">Where the range reaches</h2>
      </div>
      {SKIN_ROWS.map(({ skin, label }) => {
        const row = cells.filter((c) => c.skin === skin).sort((a, b) => a.at - b.at)
        const served = row.filter((c) => c.verdict === 'served').length
        return (
          <div className="strip-row" key={skin}>
            <span className="strip-label tiny">{label}</span>
            <div
              className="strip-cells"
              role="img"
              aria-label={`${label}: served on ${pct(served / row.length)} of the scale`}
            >
              {row.map((c) => (
                <span
                  key={c.at}
                  className={`strip-cell v-${c.verdict}`}
                  style={{ ['--c' as string]: c.hex }}
                  title={cellTitle(c)}
                />
              ))}
            </div>
          </div>
        )
      })}
      <div className="strip-row strip-axis-row" aria-hidden>
        <span className="strip-label" />
        <div className="strip-axis">
          {anchors.map((a) => (
            <span key={a.at} style={{ left: `${((a.i + 0.5) / rungs.length) * 100}%` }}>
              {a.at}
            </span>
          ))}
        </div>
      </div>
      <ul className="strip-legend tiny">
        {(Object.keys(VERDICT_WORD) as Verdict[]).map((v) => (
          <li key={v}>
            <span className={`strip-cell v-${v}`} style={{ ['--c' as string]: '#a07e56' }} aria-hidden />
            {VERDICT_WORD[v]}
          </li>
        ))}
      </ul>
    </section>
  )
}

const KIND_WORD = { gap: 'Gap', warn: 'Watch', good: 'Working' } as const

function Findings({ findings }: { findings: Finding[] }) {
  return (
    <section className="stack">
      <h2 className="strip-title">What to fix, in order</h2>
      <ol className="findings">
        {findings.map((f) => (
          <li key={f.title} className={`card finding finding-${f.kind}`}>
            <span className="finding-tag">{KIND_WORD[f.kind]}</span>
            <h3>{f.title}</h3>
            <p className="tiny">{f.body}</p>
            {f.action && (
              <p className="finding-action">
                {f.hexes && f.hexes.length > 0 && (
                  <span className="finding-swatches" aria-hidden>
                    {f.hexes.map((h) => (
                      <i key={h} style={{ background: h }} title={h} />
                    ))}
                  </span>
                )}
                <span>{f.action}</span>
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

function Demand({ demand }: { demand: DemandReport }) {
  const rows: Array<[Verdict, string]> = [
    ['served', 'Found shade and formula'],
    ['wrong-finish', 'Shade, but not their finish'],
    ['finish-unstated', 'Shade, finish unstated'],
    ['no-shade', 'No shade at all'],
  ]
  const top = Math.max(1, ...rows.map(([v]) => demand.byVerdict[v]))
  return (
    <section className="card stack">
      <div>
        <span className="kicker">From real scans</span>
        <h2 className="strip-title">
          {demand.count === 0
            ? 'No one has scanned here yet'
            : `${demand.byVerdict.served} of ${demand.count} shoppers who scanned found their match`}
        </h2>
      </div>
      {demand.count > 0 && (
        <>
          <ul className="bars">
            {rows.map(([v, label]) => (
              <li key={v}>
                <span>{label}</span>
                <span className="meter" aria-hidden>
                  <span style={{ width: `${Math.round((demand.byVerdict[v] / top) * 100)}%` }} />
                </span>
                <span className="num">{demand.byVerdict[v]}</span>
              </li>
            ))}
          </ul>
          {demand.missed.length > 0 && (
            <div className="missed">
              <span className="tiny">Skin colours the range missed, deepest first</span>
              <div className="finding-swatches">
                {demand.missed.map((m, i) => (
                  <i
                    key={`${m.skinHex}-${i}`}
                    style={{ background: m.skinHex }}
                    title={`${m.skinHex} · needs ${m.finish} · ${VERDICT_WORD[m.verdict]}${m.dE !== null ? ` (closest ${m.dE} ΔE)` : ''}`}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
      <p className="tiny">
        Each scan leaves exactly two things here: its measured skin colour and the finish it
        was prescribed. No photo, no account, nothing that points back at a person.
      </p>
    </section>
  )
}

/**
 * Put one real face in the range, then show the gap on that face.
 *
 * Two YouCam renders side by side: the closest thing the range actually
 * stocks, worn in its own finish, and what the scan prescribed. A ΔE number
 * convinces an analyst; a face convinces a buyer.
 */
function FaceTest({
  scan,
  placed,
  result,
  onPlace,
  onError,
}: {
  scan: ScanForAudit | null
  placed: ScanForAudit | null
  result: FaceResult | null
  onPlace: (s: ScanForAudit) => void
  onError: (msg: string) => void
}) {
  const [scanning, setScanning] = useState(false)
  const [renders, setRenders] = useState<{ stocked?: string; needed?: string } | null>(null)
  const [rendering, setRendering] = useState(false)
  const pickRef = useRef<HTMLInputElement>(null)

  // A new face, or the same face in a new range, makes old renders a lie.
  useEffect(() => setRenders(null), [result])

  const scanFace = async (picked: File) => {
    setScanning(true)
    try {
      const file = await normalizeImage(picked)
      const form = new FormData()
      form.append('image', file)
      const res = await fetch('/api/read', { method: 'POST', body: form })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.color) throw new Error(body?.error ?? 'The scan failed.')
      onPlace({ fileId: body.fileId, skinHex: body.color.skin_color, concerns: body.concerns ?? [] })
    } catch (err) {
      onError((err as Error).message)
    } finally {
      setScanning(false)
    }
  }

  const render = async () => {
    if (!placed || !result) return
    setRendering(true)
    try {
      const one = async (effects: unknown[]) => {
        const res = await fetch('/api/tryon/makeup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileId: placed.fileId, effects }),
        })
        const body = await res.json().catch(() => null)
        if (!res.ok || !body?.url) {
          throw new Error(body?.error ?? 'The render failed. If the scan is old, YouCam may have expired the photo — scan again.')
        }
        return body.url as string
      }
      const [needed, stocked] = await Promise.all([
        one(result.renders.needed.effects),
        result.renders.stocked ? one(result.renders.stocked.effects) : Promise.resolve(undefined),
      ])
      setRenders({ needed, stocked })
    } catch (err) {
      onError((err as Error).message)
    } finally {
      setRendering(false)
    }
  }

  return (
    <section className="card stack face-test">
      <div>
        <span className="kicker">Test a real face · YouCam</span>
        <h2 className="strip-title">Put a face in the range</h2>
        <p className="tiny">
          Scan one face, and see where it lands: is there a shade, is it the right formula —
          then see the closest thing you stock on that face, next to what it needed.
        </p>
      </div>

      <div className="actions">
        {scan && (
          <button className="btn btn-sm" onClick={() => onPlace(scan)} disabled={scanning}>
            Place my last scan
          </button>
        )}
        <button
          className={scan ? 'btn btn-sm btn-quiet' : 'btn btn-sm'}
          onClick={() => pickRef.current?.click()}
          disabled={scanning}
        >
          {scanning ? 'Scanning…' : 'Scan a face'}
        </button>
        <input
          ref={pickRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void scanFace(f)
            e.target.value = ''
          }}
        />
      </div>

      {result && placed && (
        <div className="stack">
          <p className={`placement v-${result.verdict}`}>
            <i className="dot" style={{ background: result.skinHex }} aria-hidden />
            <span>{placementSentence(result)}</span>
          </p>
          {result.onScale.dE >= 5 && (
            <p className="tiny">
              This face reads nearest Monk {Number.isInteger(result.onScale.at) ? result.onScale.at : result.onScale.at.toFixed(1)}{' '}
              but sits {result.onScale.dE} ΔE off the scale — real skin varies in undertone and
              saturation at every depth, which ten reference tones cannot show. That is why
              real scans are placed as they are, not snapped to the nearest tone.
            </p>
          )}
          <button className="btn btn-sm" onClick={render} disabled={rendering}>
            {rendering ? 'Rendering on the face…' : 'Show both on this face'}
          </button>
          {renders && (
            <div className="renders">
              {renders.stocked && result.renders.stocked && (
                <figure>
                  <img src={renders.stocked} alt={result.renders.stocked.label} />
                  <figcaption className="tiny">{result.renders.stocked.label}</figcaption>
                </figure>
              )}
              {renders.needed && (
                <figure>
                  <img src={renders.needed} alt={result.renders.needed.label} />
                  <figcaption className="tiny">{result.renders.needed.label}</figcaption>
                </figure>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function placementSentence(r: FaceResult): string {
  const shade = (s: NonNullable<Placement['closest']>) =>
    `${s.name}${s.shadeName ? ` in ${s.shadeName}` : ''}`
  const c = r.closest
  if (!c) return 'This range has no base to place a face against.'
  switch (r.verdict) {
    case 'served':
      return `Served. This face measured ${r.skinHex} and was prescribed ${r.need}; the range has a ${r.need} shade within 5 ΔE.`
    case 'no-shade':
      return `No shade. This face measured ${r.skinHex}; the closest the range gets is ${shade(c)}, ${c.dE.toFixed(1)} ΔE away.`
    case 'wrong-finish':
      return `Right shade, wrong formula. ${shade(c)} matches at ${c.dE.toFixed(1)} ΔE, but it is ${c.finish} and this skin was prescribed ${r.need}.${r.closestInFinish ? ` The nearest ${r.need} option is ${r.closestInFinish.dE.toFixed(1)} ΔE away.` : ''}`
    default:
      return `The shade matches (${shade(c)}, ${c.dE.toFixed(1)} ΔE), but no listing says its finish, so nobody can tell whether it suits ${r.need}-prescribed skin.`
  }
}

function Method() {
  return (
    <details className="card method">
      <summary>How this is measured</summary>
      <div className="stack tiny">
        <p>
          <strong>The panel.</strong> The ten tones of the Monk Skin Tone Scale (Dr. Ellis Monk,
          published by Google under CC BY 4.0), with points laid between them so no skin colour
          on the scale is more than half a match from one — the published tones are unevenly
          spaced, and real skin falls in the gaps. Each point is audited three times: for oily,
          balanced and dry skin, each prescribed by the same function that prescribes a
          shopper.
        </p>
        <p>
          <strong>A match</strong> is a base within 5 ΔE (CIELAB) — the line the shopper side
          calls a match in most light. Powders, concealers and primers filed as foundation are
          set aside.
        </p>
        <p>
          <strong>Finish</strong> is what the brand declares first, then what the product name
          says, then the description. A product that says nothing stays unknown: an unstated
          finish is reported as unstated, never as wrong.
        </p>
        <p>
          <strong>Blush and lipstick</strong> use the shopper side's own bands: a blush must
          lift the skin by 10–42 ΔE to read as a flush; pale low-pigment lip colour reads grey
          on deep skin.
        </p>
        <p>
          <strong>Limits.</strong> The panel audits a reference scale, and real skin does not
          sit exactly on it: measured mid-depth skin is less yellow and less saturated than
          Monk's published tones, so a real face can be several ΔE off the scale at its own
          depth. Real scans and the face test are placed exactly as measured for that reason —
          treat the strip as the map and the scans as the territory. The audit is also only as
          good as the colours it is given: swatch hexes scraped from product photos run light,
          especially at the deep end, which is itself the case for publishing accurate shade
          colours.
        </p>
      </div>
    </details>
  )
}
