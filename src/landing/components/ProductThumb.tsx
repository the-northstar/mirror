export type ProductKind = "bottle" | "shirt" | "glasses";

/**
 * Line-drawn product plates. Each item is inked in the palette and filled with
 * its own measured colour, so the picture and the swatch are the same fact.
 */
export function ProductThumb({
  kind,
  color,
  className = "",
  strokeWidth = 1.5,
}: {
  kind: ProductKind;
  color: string;
  className?: string;
  /** Raise this for small renders — the viewBox scales down with the box. */
  strokeWidth?: number;
}) {
  const ink = "color-mix(in oklab, var(--paper) 55%, transparent)";

  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden border border-[color-mix(in_oklab,var(--paper)_16%,transparent)] bg-[color-mix(in_oklab,var(--paper)_5%,transparent)] ${className}`}
    >
      {/* Faint tint of the product's own colour behind the drawing. */}
      <span
        aria-hidden
        className="absolute inset-0 opacity-25 transition-opacity duration-700 [transition-timing-function:cubic-bezier(.16,1,.3,1)]"
        style={{ background: `radial-gradient(120% 90% at 50% 100%, ${color}, transparent 70%)` }}
      />
      <svg
        viewBox="0 0 120 150"
        role="img"
        aria-label={LABELS[kind]}
        className="relative h-full w-full p-[10%]"
        fill="none"
        stroke={ink}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {kind === "bottle" && <Bottle color={color} />}
        {kind === "shirt" && <Shirt color={color} />}
        {kind === "glasses" && <Glasses color={color} />}
      </svg>
    </div>
  );
}

const LABELS: Record<ProductKind, string> = {
  bottle: "Foundation bottle",
  shirt: "Overshirt",
  glasses: "Spectacle frames",
};

function Bottle({ color }: { color: string }) {
  return (
    <>
      {/* pump */}
      <path d="M52 10h16v9H52z" />
      <path d="M56 19h8v8h-8z" />
      <path d="M52 14h-7" />
      {/* body */}
      <path d="M38 42a6 6 0 0 1 6-6h32a6 6 0 0 1 6 6v88a6 6 0 0 1-6 6H44a6 6 0 0 1-6-6z" />
      <path d="M50 27h20l4 9H46z" />
      {/* liquid */}
      <path
        d="M38 66h44v64a6 6 0 0 1-6 6H44a6 6 0 0 1-6-6z"
        fill={color}
        fillOpacity={0.9}
        stroke="none"
      />
      <path d="M38 66h44" />
      {/* label */}
      <path d="M38 92h44" strokeDasharray="3 4" />
      <path d="M48 104h24" opacity={0.7} />
      <path d="M48 112h14" opacity={0.5} />
    </>
  );
}

function Shirt({ color }: { color: string }) {
  return (
    <>
      {/* body + sleeves, filled in the garment colour */}
      <path
        d="M46 22 24 34l-8 30 16 6 4-10v66h48V60l4 10 16-6-8-30-22-12z"
        fill={color}
        fillOpacity={0.85}
      />
      {/* collar */}
      <path d="M46 22 60 36 74 22" fill="none" />
      <path d="M46 22h6l8 10M74 22h-6l-8 10" fill="none" />
      {/* placket + buttons */}
      <path d="M60 36v90" opacity={0.8} />
      <circle cx={60} cy={56} r={1.6} />
      <circle cx={60} cy={78} r={1.6} />
      <circle cx={60} cy={100} r={1.6} />
      {/* chest pockets */}
      <path d="M40 58h13v12H40zM67 58h13v12H67z" opacity={0.7} />
    </>
  );
}

function Glasses({ color }: { color: string }) {
  return (
    <>
      {/* lenses */}
      <circle cx={35} cy={78} r={24} fill={color} fillOpacity={0.5} />
      <circle cx={85} cy={78} r={24} fill={color} fillOpacity={0.5} />
      {/* rims doubled for an acetate weight */}
      <circle cx={35} cy={78} r={20} opacity={0.55} fill="none" />
      <circle cx={85} cy={78} r={20} opacity={0.55} fill="none" />
      {/* bridge + temples */}
      <path d="M59 74c2-4 8-4 10 0" />
      <path d="M11 70 2 62M109 70l9-8" />
      {/* highlight */}
      <path d="M24 68a14 14 0 0 1 10-8" opacity={0.6} />
    </>
  );
}
