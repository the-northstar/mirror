import { useEffect, useRef } from "react";

export function useReveal<T extends HTMLElement = HTMLDivElement>(delay = 0) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (!e || !e.isIntersecting) return;
        el.style.animationDelay = `${delay}ms`;
        el.classList.add("shown");
        io.disconnect();
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [delay]);
  return ref;
}
