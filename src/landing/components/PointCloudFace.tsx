import { useEffect, useRef } from "react";

interface P {
  x: number;
  y: number;
  hx: number;
  hy: number;
  vx: number;
  vy: number;
  r: number;
  a: number;
}

export function PointCloudFace({ src, className = "" }: { src: string; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mouse = useRef({ x: -9999, y: -9999 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let points: P[] = [];

    const img = new Image();
    img.crossOrigin = "anonymous";

    function sample() {
      const w = canvas!.clientWidth;
      const h = canvas!.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      const off = document.createElement("canvas");
      const step = 4;
      off.width = Math.max(1, Math.floor(w / step));
      off.height = Math.max(1, Math.floor(h / step));
      const octx = off.getContext("2d", { willReadFrequently: true });
      if (!octx) return;

      const scale = Math.max(off.width / img.width, off.height / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      octx.drawImage(img, (off.width - dw) / 2, (off.height - dh) / 2, dw, dh);

      const data = octx.getImageData(0, 0, off.width, off.height).data;
      const next: P[] = [];

      for (let y = 0; y < off.height; y++) {
        for (let x = 0; x < off.width; x++) {
          const i = (y * off.width + x) * 4;
          const lum =
            ((data[i] ?? 0) * 0.299 + (data[i + 1] ?? 0) * 0.587 + (data[i + 2] ?? 0) * 0.114) / 255;
          if (lum > 0.62) continue;
          if (Math.random() > 0.55) continue;
          const px = x * step;
          const py = y * step;
          next.push({
            x: px,
            y: py,
            hx: px,
            hy: py,
            vx: 0,
            vy: 0,
            r: lum < 0.28 ? 1.25 : 0.8,
            a: 0.25 + (1 - lum) * 0.55,
          });
        }
      }
      points = next;
    }

    function frame() {
      const w = canvas!.clientWidth;
      const h = canvas!.clientHeight;
      ctx!.clearRect(0, 0, w, h);

      const styles = getComputedStyle(document.documentElement);
      const ink = styles.getPropertyValue("--ink").trim() || "#16130F";
      const copper = styles.getPropertyValue("--copper").trim() || "#A65E3C";

      for (const p of points) {
        const dx = p.x - mouse.current.x;
        const dy = p.y - mouse.current.y;
        const d2 = dx * dx + dy * dy;
        const R = 120;

        if (d2 < R * R && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const push = (1 - d / R) * 2.6;
          p.vx += (dx / d) * push;
          p.vy += (dy / d) * push;
        }

        p.vx += (p.hx - p.x) * 0.045;
        p.vy += (p.hy - p.y) * 0.045;
        p.vx *= 0.86;
        p.vy *= 0.86;
        p.x += p.vx;
        p.y += p.vy;

        const disp = Math.abs(p.x - p.hx) + Math.abs(p.y - p.hy);
        ctx!.fillStyle = disp > 3 ? copper : ink;
        ctx!.globalAlpha = p.a;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }

    function onMove(e: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      mouse.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
    function onLeave() {
      mouse.current = { x: -9999, y: -9999 };
    }
    function onResize() {
      sample();
    }

    img.onload = () => {
      sample();
      if (reduced) {
        frame();
        cancelAnimationFrame(raf);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    img.src = src;

    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("resize", onResize);
    };
  }, [src]);

  return (
    <div className={`relative ${className}`}>
      <canvas ref={canvasRef} className="h-full w-full touch-none" aria-hidden="true" />
      <div className="pointer-events-none absolute bottom-6 left-6 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--signal)]">
        <span className="animate-blink inline-block h-1.5 w-1.5 rounded-full bg-[var(--signal)]" />
        reading your face
      </div>
      <div className="pointer-events-none absolute right-6 top-6 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--pencil)]">
        tone · texture · shape
      </div>
    </div>
  );
}
