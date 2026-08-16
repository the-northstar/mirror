import { useEffect, useRef, useState } from "react";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ▚▞░▒#*/\\<>";

export function ScrambleText({
  text,
  className = "",
  speed = 26,
}: {
  text: string;
  className?: string;
  speed?: number;
}) {
  const [out, setOut] = useState(text);
  const ref = useRef<HTMLSpanElement | null>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let id: ReturnType<typeof setInterval> | undefined;
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (!e || !e.isIntersecting || done.current) return;
        done.current = true;
        let frame = 0;
        id = setInterval(() => {
          setOut(
            text
              .split("")
              .map((ch, i) => {
                if (ch === " " || ch === "\n") return ch;
                if (i < frame) return ch;
                return GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? ch;
              })
              .join(""),
          );
          frame += 0.55;
          if (frame >= text.length) {
            if (id) clearInterval(id);
            setOut(text);
          }
        }, speed);
        io.disconnect();
      },
      { threshold: 0.4 },
    );

    io.observe(el);
    return () => {
      if (id) clearInterval(id);
      io.disconnect();
    };
  }, [text, speed]);

  return (
    <span ref={ref} className={className}>
      {out}
    </span>
  );
}
