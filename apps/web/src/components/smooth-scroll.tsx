"use client";

import { useEffect } from "react";
import Lenis from "lenis";

/** The reference wraps the page in a Smooth Scroll component (intensity 10). Lenis gives the same inertia; off under reduced motion. */
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 1, smoothWheel: true });
    let raf = 0;
    const loop = (t: number) => { lenis.raf(t); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a[href^='#']") as HTMLAnchorElement | null;
      if (!a) return;
      const el = document.querySelector(a.getAttribute("href") ?? "");
      if (el) { e.preventDefault(); lenis.scrollTo(el as HTMLElement, { offset: -80 }); }
    };
    document.addEventListener("click", onClick);
    return () => { cancelAnimationFrame(raf); document.removeEventListener("click", onClick); lenis.destroy(); };
  }, []);
  return null;
}
