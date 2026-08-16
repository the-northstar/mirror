import { useRef, type ReactNode, type MouseEvent } from "react";

export function MagneticButton({
  children,
  onClick,
  variant = "solid",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "solid" | "ghost";
}) {
  const ref = useRef<HTMLButtonElement | null>(null);

  function move(e: MouseEvent) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left - r.width / 2;
    const y = e.clientY - r.top - r.height / 2;
    el.style.transform = `translate(${x * 0.28}px, ${y * 0.34}px)`;
  }
  function reset() {
    if (ref.current) ref.current.style.transform = "translate(0,0)";
  }

  const base =
    "inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-sm tracking-wide transition-[transform,background,color,border-color] duration-500 [transition-timing-function:cubic-bezier(.16,1,.3,1)]";
  const skin =
    variant === "solid"
      ? "bg-[var(--ink)] text-[var(--paper)] hover:bg-[var(--copper)]"
      : "border border-[color-mix(in_oklab,var(--ink)_20%,transparent)] text-[var(--ink)] hover:border-[var(--copper)] hover:text-[var(--copper)]";

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      onMouseMove={move}
      onMouseLeave={reset}
      className={`${base} ${skin}`}
    >
      {children}
    </button>
  );
}
