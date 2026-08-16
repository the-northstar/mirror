import { useRef } from 'react'
import portrait from './assets/portrait.jpg'
import { Counter } from './components/Counter'
import { FormulaSplit } from './components/FormulaSplit'
import { MagneticButton } from './components/MagneticButton'
import { Marquee } from './components/Marquee'
import { MethodLedger } from './components/MethodLedger'
import { PointCloudFace } from './components/PointCloudFace'
import { ProductCheck } from './components/ProductCheck'
import { ReceiptCard } from './components/ReceiptCard'
import { Spotlight } from './components/Spotlight'
import { SwatchStrip } from './components/SwatchStrip'
import { useReveal } from './useReveal'
import { relativeTime, type PastScan } from '../lib/history'
import './landing.css'
import { ACCEPTED_TYPES } from '../lib/image'

const PROBLEM = [
  'A shade finder matches a colour and stops there.',
  'Your oiliness, redness and moisture never enter the decision.',
  'So the right colour arrives in the wrong formula.',
]

const AISLES = [
  {
    n: '01',
    t: 'Makeup',
    q: 'Foundation must match. Blush, lip and eye must flatter.',
    api: 'yc/skin-analysis + shade-match',
    colors: ['#E3BFA4', '#C99372', '#A56B4B', '#7E4B32', '#5A3323', '#B8615C'],
  },
  {
    n: '02',
    t: 'Clothing',
    q: 'Undertone and depth set the palette; contrast sets the pairing.',
    api: 'yc/skin-tone → lab palette',
    colors: ['#3E4A3C', '#7C8A6E', '#C9B08A', '#A65E3C', '#2A2622', '#E4DCCB'],
  },
  {
    n: '03',
    t: 'Glasses',
    q: 'Face shape decides the rim. Depth decides the metal.',
    api: 'yc/face-shape',
    colors: ['#1D1B18', '#5B4633', '#8E7B62', '#B08D57', '#3B4451', '#D8CFC0'],
  },
  {
    n: '04',
    t: 'Frames & sun',
    q: 'Lens tint checked against measured redness and eye area.',
    api: 'yc/eye-area + concerns',
    colors: ['#2F2A26', '#6B5138', '#94714A', '#4C5A52', '#8A6B6B', '#E9E2D6'],
  },
]

/* What a retailer actually does here, in the order they do it. Mirrors the two
   ways into the Store screen: one product at a time, or a spreadsheet. */
const SHOPKEEPER = [
  {
    n: '01',
    t: 'List what you sell',
    d: 'Add products one at a time, or import the whole catalogue from a spreadsheet.',
  },
  {
    n: '02',
    t: 'Shoppers get measured',
    d: 'One selfie reads undertone, depth, face shape and seven skin concerns.',
  },
  {
    n: '03',
    t: 'They try it on themselves',
    d: 'Your item is ranked against that reading, then rendered onto their own photo.',
  },
]

const CHIPS = [
  'POST /skin-analysis',
  'POST /skin-tone',
  'POST /face-shape',
  'POST /shade-match',
  'POST /try-on/render',
  'GET /catalog/products',
]

export function Landing({
  onCamera,
  onFile,
  onStore,
  scans,
  onReopen,
  onForget,
}: {
  onCamera: () => void
  onFile: (f: File) => void
  onStore: () => void
  scans: PastScan[]
  onReopen: (s: PastScan) => void
  onForget: (id: string) => void
}) {
  const problemRef = useReveal()
  const numbersRef = useReveal()
  const storeRef = useReveal()
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <main className="landing overflow-x-hidden">
      {/* No header here: the app's own bar is already sticky above this page. */}

      {/* 1 — Hero */}
      <section className="mx-auto grid max-w-[1400px] items-center gap-12 px-6 pb-20 pt-2 sm:px-10 lg:grid-cols-[45%_1fr] lg:gap-4 lg:pb-28">
        <div className="lg:pr-10">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--copper)]">
            Hackathon submission · 2026
          </p>
          <h1 className="mt-7 font-serif text-[3rem] leading-[0.98] tracking-[-0.03em] sm:text-[4.2rem] lg:text-[4.8rem]">
            Find what suits you, measured from your own face.
          </h1>
          <p className="mt-8 max-w-md text-[17px] leading-relaxed text-[var(--pencil)]">
            One selfie. Seven measurements. Makeup, clothes, glasses and frames that are chosen —
            not guessed.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <MagneticButton onClick={onCamera}>Open camera</MagneticButton>
            <MagneticButton onClick={() => inputRef.current?.click()} variant="ghost">
              Upload a photo
            </MagneticButton>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onFile(f)
              e.target.value = ''
            }}
          />
          <ul className="mt-8 space-y-1.5 text-[13px] leading-relaxed text-[var(--pencil)]">
            <li>One person only, no one else in frame</li>
            <li>Close up, your face filling most of the photo</li>
            <li>Even light, facing the camera</li>
          </ul>
          <dl className="mt-14 grid max-w-md grid-cols-3 gap-6 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--pencil)]">
            <div>
              <dt className="text-[var(--signal)]">One selfie</dt>
              <dd className="mt-1.5">sets your reading</dd>
            </div>
            <div>
              <dt className="text-[var(--signal)]">Any product</dt>
              <dd className="mt-1.5">photo or shop link</dd>
            </div>
            <div>
              <dt className="text-[var(--signal)]">1.9 s</dt>
              <dd className="mt-1.5">to a straight answer</dd>
            </div>
          </dl>
        </div>

        <div className="relative -mr-6 sm:-mr-10 lg:-mr-24">
          <PointCloudFace src={portrait} className="h-[420px] sm:h-[560px] lg:h-[680px]" />
        </div>
      </section>

      {/* Earlier scans — re-opening one skips the scan and costs no units. */}
      {scans.length > 0 && (
        <section className="mx-auto max-w-[1400px] px-6 pb-16 sm:px-10">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--copper)]">
            Your earlier scans
          </p>
          <p className="mt-3 text-[15px] text-[var(--pencil)]">
            Re-open one to skip the scan. It costs nothing.
          </p>
          <ul className="mt-8 flex flex-wrap gap-4">
            {scans.map((s) => (
              <li key={s.id} className="relative">
                <button
                  onClick={() => onReopen(s)}
                  className="flex items-center gap-4 border border-[color-mix(in_oklab,var(--ink)_14%,transparent)] bg-[var(--bone)] p-3 pr-6 text-left transition-colors duration-500 [transition-timing-function:cubic-bezier(.16,1,.3,1)] hover:border-[var(--copper)]"
                >
                  <img src={s.photo} alt="" className="h-14 w-14 rounded-full object-cover" />
                  <span>
                    <span className="block font-serif text-lg tracking-[-0.01em]">{s.season}</span>
                    <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--pencil)]">
                      {relativeTime(s.at)}
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => onForget(s.id)}
                  aria-label="Forget this scan"
                  className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-[color-mix(in_oklab,var(--ink)_18%,transparent)] bg-[var(--paper)] text-[var(--pencil)] transition-colors duration-300 hover:border-[var(--copper)] hover:text-[var(--copper)]"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 2 — Ticker */}
      <Marquee />

      {/* 3 — The problem */}
      <section className="mx-auto max-w-[1400px] px-6 py-28 sm:px-10 lg:py-36">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--copper)]">
          What goes wrong
        </p>
        <div ref={problemRef} className="reveal mt-10 space-y-6">
          {PROBLEM.map((line, i) => (
            <p
              key={line}
              className="max-w-4xl font-serif text-3xl leading-[1.12] tracking-[-0.02em] sm:text-[2.9rem]"
              style={{ marginLeft: `${i * 44}px`, opacity: 1 - i * 0.14 }}
            >
              {line}
            </p>
          ))}
        </div>
      </section>

      {/* 4 — Bring your own product */}
      <ProductCheck onCheck={onCamera} />

      {/* 5 — How it works */}
      <section
        id="method"
        className="mx-auto max-w-[1400px] scroll-mt-20 px-6 pb-32 pt-28 sm:px-10 lg:pt-36"
      >
        <MethodLedger />
      </section>

      {/* 6 — Differentiator */}
      <section className="border-y border-[color-mix(in_oklab,var(--ink)_12%,transparent)] bg-[color-mix(in_oklab,var(--bone)_60%,var(--paper))]">
        <div className="mx-auto max-w-[1400px] px-6 py-28 sm:px-10 lg:py-36">
          <FormulaSplit />
        </div>
      </section>

      {/* 7 — Receipts */}
      <section className="mx-auto max-w-[1400px] px-6 py-28 sm:px-10 lg:py-36">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--copper)]">
          Receipts
        </p>
        <h2 className="mt-5 max-w-2xl font-serif text-4xl leading-[1.05] tracking-[-0.02em] sm:text-5xl">
          Every pick names the measurement that caused it.
        </h2>
        <div className="mt-16 grid gap-8 lg:grid-cols-3">
          <ReceiptCard
            brand="Aureal"
            product="Longwear Fluid 24 — 3N Warm"
            swatch="#C99372"
            reason="Chosen because oiliness measured 71: the matte fluid outranked every dewy base at the same colour."
            metric="oiliness 71 · ΔE 1.2 · matte"
            delay={0}
          />
          <ReceiptCard
            brand="Norr Studio"
            product="Sage poplin overshirt"
            swatch="#7C8A6E"
            reason="Warm undertone with depth 4/6 lifts muted greens; cool blue-greys were ranked down."
            metric="undertone warm · depth 4/6"
            delay={120}
            drop
          />
          <ReceiptCard
            brand="Kessel Optic"
            product="Titanium rectangle, brushed brass"
            swatch="#B08D57"
            reason="Oval face shape tolerates angular rims; brass reads with a warm measured skin tone."
            metric="face oval · warm metal"
            delay={240}
          />
        </div>
      </section>

      {/* 8 — By the numbers */}
      <section className="mx-auto max-w-[1400px] px-6 pb-28 sm:px-10">
        <div ref={numbersRef} className="reveal grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <Counter to={6} label="YouCam endpoints" />
          <Counter to={3975} label="Products indexed" />
          <Counter to={7} label="Skin concerns read" />
          <Counter to={0} label="Hand-tagged colours" />
        </div>
      </section>

      {/* 9 — Aisles */}
      <section className="mx-auto max-w-[1400px] px-6 pb-28 sm:px-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--copper)]">
          Four aisles, four questions
        </p>
        <div className="mt-12">
          {AISLES.map((a) => (
            <div
              key={a.n}
              className="grid items-center gap-6 border-t border-[color-mix(in_oklab,var(--ink)_15%,transparent)] py-8 transition-colors duration-500 [transition-timing-function:cubic-bezier(.16,1,.3,1)] hover:bg-[var(--bone)] lg:grid-cols-[80px_240px_1fr_auto]"
            >
              <span className="font-mono text-[11px] tracking-[0.28em] text-[var(--copper)]">
                {a.n}
              </span>
              <h3 className="font-serif text-3xl tracking-[-0.01em]">{a.t}</h3>
              <p className="max-w-lg text-[15px] leading-relaxed text-[var(--pencil)]">
                {a.q}
                <span className="mt-2 block font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--signal)]">
                  {a.api}
                </span>
              </p>
              <SwatchStrip colors={a.colors} />
            </div>
          ))}
          <div className="border-t border-[color-mix(in_oklab,var(--ink)_15%,transparent)]" />
        </div>
      </section>

      {/* 10 — API strip */}
      <Spotlight>
        <div className="mx-auto max-w-[1400px]">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--copper)]">
            Under the panel
          </p>
          <h2 className="mt-5 max-w-2xl font-serif text-4xl leading-[1.05] tracking-[-0.02em] text-[color-mix(in_oklab,var(--paper)_92%,transparent)] sm:text-5xl">
            Six calls. No colour tagged by hand.
          </h2>
          <div className="mt-12 flex flex-wrap gap-3">
            {CHIPS.map((c) => (
              <span
                key={c}
                className="rounded-full border border-[color-mix(in_oklab,var(--paper)_22%,transparent)] px-4 py-2 font-mono text-[11px] tracking-[0.12em] text-[color-mix(in_oklab,var(--paper)_80%,transparent)]"
              >
                {c}
              </span>
            ))}
          </div>
          <p className="mt-12 max-w-xl font-mono text-[12px] leading-relaxed text-[var(--signal)]">
            Undertone and depth are derived in CIELAB from the measured skin tone; ranking runs
            per-aisle with its own objective, then the result is rendered back onto the original
            photo.
          </p>
        </div>
      </Spotlight>

      {/* 11 — For stores. Sits after the shopper's case is made: a retailer only
          cares that the match is measured once they have seen it work. */}
      <section className="border-y border-[color-mix(in_oklab,var(--ink)_12%,transparent)] bg-[color-mix(in_oklab,var(--bone)_60%,var(--paper))]">
        <div ref={storeRef} className="reveal mx-auto max-w-[1400px] px-6 py-28 sm:px-10 lg:py-36">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--copper)]">
            For stores
          </p>
          <h2 className="mt-5 max-w-3xl font-serif text-4xl leading-[1.05] tracking-[-0.02em] sm:text-5xl">
            Join as a store. Add your products, and let people try them on.
          </h2>
          <p className="mt-7 max-w-xl text-[17px] leading-relaxed text-[var(--pencil)]">
            What you list is ranked against each shopper&rsquo;s own measurements and rendered onto
            their photo — so they see it on themselves, not on a model, with the reason named.
          </p>
          <ol className="mt-16 grid gap-10 sm:grid-cols-3">
            {SHOPKEEPER.map((s) => (
              <li
                key={s.n}
                className="border-t border-[color-mix(in_oklab,var(--ink)_15%,transparent)] pt-6"
              >
                <span className="font-mono text-[11px] tracking-[0.28em] text-[var(--copper)]">
                  {s.n}
                </span>
                <h3 className="mt-4 font-serif text-2xl tracking-[-0.01em]">{s.t}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-[var(--pencil)]">{s.d}</p>
              </li>
            ))}
          </ol>
          <div className="mt-16">
            <MagneticButton onClick={onStore}>Join as a store</MagneticButton>
          </div>
        </div>
      </section>

      {/* 12 — Footer CTA */}
      <footer className="mx-auto max-w-[1400px] px-6 py-28 sm:px-10 lg:py-36">
        <h2 className="max-w-3xl font-serif text-[3rem] leading-[0.98] tracking-[-0.03em] sm:text-[4rem]">
          Stop paying to find out.
        </h2>
        <p className="mt-7 max-w-lg text-[17px] leading-relaxed text-[var(--pencil)]">
          One selfie sets your reading. After that, every product you upload gets a straight
          answer.
        </p>
        <div className="mt-12 flex flex-wrap items-center gap-4">
          <MagneticButton onClick={onCamera}>Open camera</MagneticButton>
          <MagneticButton onClick={() => inputRef.current?.click()} variant="ghost">
            Upload a photo
          </MagneticButton>
        </div>
        <div className="mt-20 flex flex-col gap-3 border-t border-[color-mix(in_oklab,var(--ink)_15%,transparent)] pt-8 font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--pencil)] sm:flex-row sm:justify-between">
          <span>Mirror · built on the YouCam API</span>
          <span className="text-[var(--signal)]">status: calibrated</span>
        </div>
      </footer>
    </main>
  )
}
