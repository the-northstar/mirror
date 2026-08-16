import { useReveal } from "../useReveal";

const SHADE = "#B8615C";

export function FormulaSplit() {
  const ref = useReveal();

  return (
    <div ref={ref} className="reveal">
      <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--copper)]">
        The part nobody else does
      </p>
      <h2 className="mt-5 max-w-3xl font-serif text-4xl leading-[1.05] tracking-[-0.02em] sm:text-5xl lg:text-6xl">
        Your skin picks the shade.
        <br />
        <span className="text-[var(--copper)]">Your skin also picks the formula.</span>
      </h2>

      <div className="mt-16 grid gap-8 lg:grid-cols-2">
        <Card
          reading="oiliness 71 · moisture 28"
          finish="Matte, oil-controlling"
          coverage="Medium-full, powder set"
          glow={22}
          cover={78}
          because="High oiliness suppresses dewy finishes and raises longwear formulas."
        />
        <Card
          reading="oiliness 19 · moisture 74"
          finish="Dewy, hydrating"
          coverage="Sheer-medium, serum base"
          glow={81}
          cover={44}
          because="Low oiliness with high moisture inverts the ranking — matte drops out entirely."
          offset
        />
      </div>

      <p className="mt-14 max-w-2xl border-l-2 border-[var(--copper)] pl-6 font-serif text-2xl leading-snug tracking-[-0.01em] sm:text-3xl">
        Same matched colour. Two different products. Because we measured more than colour.
      </p>
    </div>
  );
}

function Card({
  reading,
  finish,
  coverage,
  glow,
  cover,
  because,
  offset = false,
}: {
  reading: string;
  finish: string;
  coverage: string;
  glow: number;
  cover: number;
  because: string;
  offset?: boolean;
}) {
  const ref = useReveal(offset ? 140 : 0);
  return (
    <div
      ref={ref}
      className={`reveal border border-[color-mix(in_oklab,var(--ink)_14%,transparent)] bg-[var(--bone)] p-8 sm:p-10 ${
        offset ? "lg:translate-y-8" : ""
      }`}
    >
      <div className="flex items-start gap-4">
        <span
          className="mt-1 h-12 w-12 shrink-0 rounded-full ring-1 ring-inset ring-[color-mix(in_oklab,var(--ink)_20%,transparent)]"
          style={{ background: SHADE }}
        />
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--pencil)]">
            Measured
          </p>
          <p className="mt-1.5 font-mono text-sm text-[var(--signal)]">{reading}</p>
        </div>
      </div>

      <dl className="mt-8 space-y-3 text-sm">
        <div className="flex justify-between gap-4 border-t border-[color-mix(in_oklab,var(--ink)_12%,transparent)] pt-3">
          <dt className="text-[var(--pencil)]">Finish</dt>
          <dd className="text-right font-serif text-lg">{finish}</dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-[color-mix(in_oklab,var(--ink)_12%,transparent)] pt-3">
          <dt className="text-[var(--pencil)]">Coverage</dt>
          <dd className="text-right font-serif text-lg">{coverage}</dd>
        </div>
      </dl>

      <div className="mt-8 space-y-5">
        <Meter label="glow" value={glow} caption={`${glow}/100`} />
        <Meter label="coverage" value={cover} caption={`${cover}/100`} />
      </div>

      <p className="mt-8 text-[15px] leading-relaxed text-[var(--pencil)]">{because}</p>
    </div>
  );
}

function Meter({ label, value, caption }: { label: string; value: number; caption: string }) {
  const ref = useReveal(300);
  return (
    <div ref={ref} className="reveal">
      <div className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--pencil)]">
        <span>{label}</span>
        <span className="text-[var(--signal)]">{caption}</span>
      </div>
      <div className="mt-2 h-[3px] w-full bg-[color-mix(in_oklab,var(--ink)_12%,transparent)]">
        <div
          className="h-full bg-[var(--copper)] transition-[width] duration-1000 [transition-timing-function:cubic-bezier(.16,1,.3,1)]"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}
