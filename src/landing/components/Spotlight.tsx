import { useRef, type ReactNode, type MouseEvent } from "react";

export function Spotlight({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);

  function move(e: MouseEvent) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  }

  return (
    <div
      ref={ref}
      onMouseMove={move}
      className="relative isolate overflow-hidden bg-[var(--graphite)] px-6 py-24 sm:px-10 lg:px-16"
      style={
        {
          "--mx": "50%",
          "--my": "50%",
        } as React.CSSProperties
      }
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-70 transition-opacity duration-700"
        style={{
          background:
            "radial-gradient(420px circle at var(--mx) var(--my), color-mix(in oklab, var(--copper) 26%, transparent), transparent 70%)",
        }}
      />
      {children}
    </div>
  );
}
