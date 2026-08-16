import { useState } from "react";

import { useReveal } from "../useReveal";

const ENTRIES = [
  {
    n: "I",
    t: "Read",
    d: "One photo, measured by YouCam: skin colour, seven concerns, face shape.",
    out: "yc/skin-analysis",
  },
  {
    n: "II",
    t: "Derive",
    d: "Undertone and depth, computed in Lab colour space — neither exists in the API.",
    out: "lab → undertone, depth",
  },
  {
    n: "III",
    t: "Prescribe",
    d: "Each aisle ranked by its own question. Foundation must match. Blush must flatter.",
    out: "rank per objective",
  },
  {
    n: "IV",
    t: "See it",
    d: "The result rendered on your own photo, not a model's.",
    out: "yc/try-on/render",
  },
];

/**
 * The method, kept as a ledger rather than a scroll-driven stepper: every
 * entry is legible at once, and hovering pulls the one you're reading forward.
 */
export function MethodLedger() {
  const [hovered, setHovered] = useState<number | null>(null);
  const headRef = useReveal();

  return (
    <div>
      <div ref={headRef} className="reveal flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--copper)]">
            Method
          </p>
          <h2 className="mt-5 max-w-xl font-serif text-4xl leading-[1.05] tracking-[-0.02em] sm:text-5xl">
            The whole procedure, <span className="italic text-[var(--copper)]">on one page</span>.
          </h2>
        </div>
        <p className="max-w-xs font-mono text-[11px] uppercase leading-relaxed tracking-[0.2em] text-[var(--pencil)]">
          No guessing in any entry
        </p>
      </div>

      <ol className="mt-16 border-t border-[color-mix(in_oklab,var(--ink)_16%,transparent)]">
        {ENTRIES.map((e, i) => {
          const dim = hovered !== null && hovered !== i;
          return (
            <li
              key={e.n}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              className="group relative grid items-baseline gap-x-8 gap-y-3 border-b border-[color-mix(in_oklab,var(--ink)_16%,transparent)] py-10 transition-all duration-500 [transition-timing-function:cubic-bezier(.16,1,.3,1)] sm:py-12 lg:grid-cols-[7rem_16rem_1fr_auto]"
              style={{ opacity: dim ? 0.42 : 1 }}
            >
              {/* Copper wash that fills from the left on hover. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-0 -z-10 origin-left scale-x-0 bg-[color-mix(in_oklab,var(--gilt)_14%,transparent)] transition-transform duration-700 [transition-timing-function:cubic-bezier(.16,1,.3,1)] group-hover:scale-x-100"
                style={{ right: "-1.5rem", left: "-1.5rem" }}
              />

              <span className="font-serif text-[2.75rem] italic leading-none text-[var(--gilt)] transition-transform duration-500 [transition-timing-function:cubic-bezier(.16,1,.3,1)] group-hover:translate-x-1 sm:text-[3.5rem]">
                {e.n}
              </span>

              <h3 className="font-serif text-3xl tracking-[-0.01em] sm:text-4xl">{e.t}</h3>

              <p className="max-w-lg text-[15px] leading-relaxed text-[var(--pencil)]">{e.d}</p>

              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--signal)] lg:text-right">
                {e.out}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
