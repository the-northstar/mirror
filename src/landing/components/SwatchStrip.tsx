export function SwatchStrip({ colors }: { colors: string[] }) {
  return (
    <div className="flex items-center gap-1.5">
      {colors.map((c, i) => (
        <span
          key={`${c}-${i}`}
          title={c}
          className="h-7 w-7 rounded-full ring-1 ring-inset ring-[color-mix(in_oklab,var(--ink)_18%,transparent)] transition-transform duration-500 [transition-timing-function:cubic-bezier(.16,1,.3,1)] hover:scale-110"
          style={{ background: c }}
        />
      ))}
    </div>
  );
}
