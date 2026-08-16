import { useReveal } from "../useReveal";

export function ReceiptCard({
  product,
  brand,
  swatch,
  reason,
  metric,
  delay = 0,
  drop = false,
}: {
  product: string;
  brand: string;
  swatch: string;
  reason: string;
  metric: string;
  delay?: number;
  drop?: boolean;
}) {
  const ref = useReveal(delay);
  return (
    <div
      ref={ref}
      className={`reveal border border-[color-mix(in_oklab,var(--ink)_14%,transparent)] bg-[var(--bone)] p-7 ${
        drop ? "lg:mt-10" : ""
      }`}
    >
      <div className="flex items-start gap-4">
        <span
          className="mt-1 h-11 w-11 shrink-0 rounded-full ring-1 ring-inset ring-[color-mix(in_oklab,var(--ink)_20%,transparent)]"
          style={{ background: swatch }}
        />
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--pencil)]">
            {brand}
          </p>
          <p className="mt-1.5 font-serif text-2xl leading-snug tracking-[-0.01em]">{product}</p>
        </div>
      </div>
      <p className="mt-6 border-t border-dashed border-[color-mix(in_oklab,var(--ink)_18%,transparent)] pt-6 text-[15px] leading-relaxed text-[var(--ink)]">
        &ldquo;{reason}&rdquo;
      </p>
      <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--signal)]">
        {metric}
      </p>
    </div>
  );
}
