import { useState } from "react";

import { ProductThumb, type ProductKind } from "./ProductThumb";
import { useReveal } from "../useReveal";

type Sample = {
  key: string;
  brand: string;
  product: string;
  kind: ProductKind;
  swatch: string;
  verdict: "keep" | "skip";
  headline: string;
  reason: string;
  metric: string;
  price: string;
};

const SAMPLES: Sample[] = [
  {
    key: "a",
    brand: "Aureal",
    product: "Longwear Fluid 24 — 4W",
    kind: "bottle",
    swatch: "#B07C55",
    verdict: "skip",
    headline: "Don't buy it",
    reason:
      "The colour is one step too deep and the base is dewy — against oiliness 71 it will break down by midday.",
    metric: "ΔE 5.8 · dewy vs oily 71",
    price: "$42",
  },
  {
    key: "b",
    brand: "Norr Studio",
    product: "Sage poplin overshirt",
    kind: "shirt",
    swatch: "#7C8A6E",
    verdict: "keep",
    headline: "It fits you",
    reason:
      "Muted green on a warm undertone at depth 4/6 — this is the pairing your face is already asking for.",
    metric: "undertone warm · depth 4/6",
    price: "$88",
  },
  {
    key: "c",
    brand: "Kessel Optic",
    product: "Round acetate, cool grey",
    kind: "glasses",
    swatch: "#6E7480",
    verdict: "skip",
    headline: "Don't buy it",
    reason:
      "A round rim on a round face removes the only line you have; cool grey fights a warm measured tone twice over.",
    metric: "face round · metal cool",
    price: "$165",
  },
];

/**
 * The headline feature: check something you already own — or something in a
 * shop tab — against your own measurements before spending on it.
 */
export function ProductCheck({ onCheck }: { onCheck: () => void }) {
  const [i, setI] = useState(0);
  const [armed, setArmed] = useState(false);
  const ref = useReveal();
  const s = SAMPLES[i]!;
  const keep = s.verdict === "keep";

  return (
    <section
      id="check"
      className="scroll-mt-20 bg-[var(--graphite)] text-[var(--paper)]"
    >
      <div ref={ref} className="reveal mx-auto max-w-[1400px] px-6 py-28 sm:px-10 lg:py-36">
        <div className="flex flex-wrap items-center gap-4">
          <span className="rounded-full border border-[var(--gilt)] px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--gilt)]">
            The part that saves you money
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-[color-mix(in_oklab,var(--paper)_45%,transparent)]">
            works on anything you already own
          </span>
        </div>

        <h2 className="mt-8 max-w-4xl font-serif text-[2.9rem] leading-[1.02] tracking-[-0.03em] sm:text-[4.2rem]">
          Upload a product.
          <br />
          Find out if it suits you{" "}
          <span className="italic text-[var(--gilt)]">before you pay for it.</span>
        </h2>

        <p className="mt-8 max-w-xl text-[17px] leading-relaxed text-[color-mix(in_oklab,var(--paper)_65%,transparent)]">
          A photo of the bottle, the shirt or the frames — or the shop link. Mirror runs it
          against your own reading and answers one question: does this fit you, or not? Nothing
          bought twice, nothing worn once and abandoned in a drawer.
        </p>

        <div className="mt-16 grid gap-8 lg:grid-cols-[1fr_1fr] lg:gap-14">
          {/* Upload frame */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setArmed(true);
            }}
            onDragLeave={() => setArmed(false)}
            onDrop={(e) => {
              e.preventDefault();
              setArmed(false);
              // Checking a product needs a reading first, so any drop starts
              // the scan rather than silently swallowing the file.
              onCheck();
            }}
            className="relative flex min-h-[320px] flex-col items-center justify-center overflow-hidden border border-dashed p-10 text-center transition-colors duration-500 [transition-timing-function:cubic-bezier(.16,1,.3,1)]"
            style={{
              borderColor: armed
                ? "var(--gilt)"
                : "color-mix(in oklab, var(--paper) 28%, transparent)",
              background: armed
                ? "color-mix(in oklab, var(--gilt) 10%, transparent)"
                : "color-mix(in oklab, var(--paper) 4%, transparent)",
            }}
          >
            {/* Corner registration marks — this is a measuring instrument. */}
            {[
              "left-4 top-4 border-l border-t",
              "right-4 top-4 border-r border-t",
              "left-4 bottom-4 border-l border-b",
              "right-4 bottom-4 border-r border-b",
            ].map((c) => (
              <span
                key={c}
                aria-hidden
                className={`pointer-events-none absolute h-5 w-5 border-[var(--gilt)] ${c}`}
              />
            ))}

            <span className="font-serif text-3xl leading-tight sm:text-4xl">
              Drop the product in
            </span>
            <span className="mt-4 max-w-xs font-mono text-[11px] uppercase leading-relaxed tracking-[0.2em] text-[color-mix(in_oklab,var(--paper)_50%,transparent)]">
              photo of the item · shelf shot · or paste the shop link
            </span>
            <button
              type="button"
              onClick={onCheck}
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-[var(--paper)] px-7 py-3.5 text-sm tracking-wide text-[var(--graphite)] transition-colors duration-500 [transition-timing-function:cubic-bezier(.16,1,.3,1)] hover:bg-[var(--gilt)]"
            >
              Check this product
            </button>
            <span className="mt-5 font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--gilt)]">
              answer in 1.9 s
            </span>
          </div>

          {/* Verdict readout */}
          <div className="flex flex-col">
            <div className="flex flex-wrap gap-2">
              {SAMPLES.map((x, n) => (
                <button
                  key={x.key}
                  type="button"
                  onClick={() => setI(n)}
                  className="inline-flex items-center gap-2.5 rounded-full border py-1.5 pl-1.5 pr-4 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors duration-500 [transition-timing-function:cubic-bezier(.16,1,.3,1)]"
                  style={{
                    borderColor:
                      n === i
                        ? "var(--gilt)"
                        : "color-mix(in oklab, var(--paper) 22%, transparent)",
                    color:
                      n === i
                        ? "var(--gilt)"
                        : "color-mix(in oklab, var(--paper) 55%, transparent)",
                  }}
                >
                  <ProductThumb
                    kind={x.kind}
                    color={x.swatch}
                    strokeWidth={5}
                    className="h-7 w-7 shrink-0 rounded-full"
                  />
                  {x.brand}
                </button>
              ))}
            </div>

            <div className="mt-6 flex-1 border border-[color-mix(in_oklab,var(--paper)_18%,transparent)] bg-[color-mix(in_oklab,var(--paper)_6%,transparent)] p-8">
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[color-mix(in_oklab,var(--paper)_45%,transparent)]">
                sample reading
              </p>

              <div className="mt-6 flex items-start gap-5">
                <ProductThumb
                  key={s.key}
                  kind={s.kind}
                  color={s.swatch}
                  className="h-28 w-24 shrink-0"
                />
                <div className="pt-1">
                  <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[color-mix(in_oklab,var(--paper)_55%,transparent)]">
                    {s.brand} · {s.price}
                  </p>
                  <p className="mt-1.5 font-serif text-2xl leading-snug tracking-[-0.01em]">
                    {s.product}
                  </p>
                  <p className="mt-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.24em] text-[color-mix(in_oklab,var(--paper)_45%,transparent)]">
                    <span
                      className="inline-block h-3 w-3 rounded-full ring-1 ring-inset ring-[color-mix(in_oklab,var(--paper)_30%,transparent)]"
                      style={{ background: s.swatch }}
                    />
                    {s.swatch}
                  </p>
                </div>
              </div>

              <p
                className="mt-8 font-serif text-[2.6rem] italic leading-none tracking-[-0.02em] sm:text-5xl"
                style={{ color: keep ? "var(--signal)" : "var(--copper)" }}
              >
                {s.headline}
              </p>

              <p className="mt-6 max-w-md text-[15px] leading-relaxed text-[color-mix(in_oklab,var(--paper)_72%,transparent)]">
                {s.reason}
              </p>

              <p className="mt-6 border-t border-dashed border-[color-mix(in_oklab,var(--paper)_20%,transparent)] pt-5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--gilt)]">
                {s.metric}
                <span className="mt-2 block text-[color-mix(in_oklab,var(--paper)_50%,transparent)]">
                  {keep ? `${s.price} well spent` : `${s.price} not spent`}
                </span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
