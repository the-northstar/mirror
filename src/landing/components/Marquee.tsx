/* Alternating readings and the verdicts they produce — the ticker should read
   as the product talking, not as a lab dump. */
const TERMS = [
  "your undertone: warm",
  "so: muted sage, yes",
  "oily by midday",
  "so: matte, not dewy",
  "warm depth 4 of 6",
  "so: brass over silver",
  "oval face",
  "so: angular rims work",
  "wrong shade, caught early",
  "so: $42 not spent",
  "cool grey fights you",
  "so: leave it on the shelf",
];

export function Marquee() {
  const row = [...TERMS, ...TERMS];
  return (
    <div className="overflow-hidden border-y border-[color-mix(in_oklab,var(--ink)_12%,transparent)] bg-[var(--graphite)] py-4">
      <div className="animate-marquee flex w-max items-center">
        {row.map((t, i) => (
          <span
            key={`${t}-${i}`}
            className="flex items-center font-mono text-[11px] uppercase tracking-[0.28em] text-[color-mix(in_oklab,var(--paper)_78%,transparent)]"
          >
            <span className={t.startsWith("so:") ? "text-[var(--signal)]" : undefined}>{t}</span>
            <span className="mx-7 h-3 w-px bg-[color-mix(in_oklab,var(--paper)_25%,transparent)]" />
          </span>
        ))}
      </div>
    </div>
  );
}
