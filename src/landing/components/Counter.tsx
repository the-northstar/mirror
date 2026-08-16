import { useEffect, useRef, useState } from "react";

export function Counter({
  to,
  label,
  suffix = "",
}: {
  to: number;
  label: string;
  suffix?: string;
}) {
  const [n, setN] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (!e || !e.isIntersecting) return;
        const start = performance.now();
        const dur = 1400;
        const tick = (now: number) => {
          const p = Math.min(1, (now - start) / dur);
          const eased = 1 - Math.pow(1 - p, 3);
          setN(Math.round(to * eased));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        io.disconnect();
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [to]);

  return (
    <div ref={ref} className="border-t border-[color-mix(in_oklab,var(--ink)_15%,transparent)] pt-5">
      <p className="font-mono text-4xl tracking-[-0.03em] sm:text-5xl">
        {n.toLocaleString()}
        {suffix}
      </p>
      <p className="mt-3 text-[13px] uppercase tracking-[0.16em] text-[var(--pencil)]">{label}</p>
    </div>
  );
}
