"use client";

import { motion, useInView, useReducedMotion, useScroll, useTransform, type MotionValue } from "motion/react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/*
 * Motion catalogue, taken from the Aoutive reference:
 *   hero headline and sub: word-by-word, opacity 0 → 1, y 10 → 0, blur 10px → 0, spring (stiffness 400, damping 100),
 *     0.05 s between words after a 0.6 s delay; the sub at 0.03 s between words after 1 s
 *   hero buttons and instrument: fade up (y 20, y 60) with a spring (stiffness 150, damping 40) at 2.0 s, 2.1 s, 2.8 s
 *   section elements: fade up on first view (threshold 0.5), y 18 to 48, spring 150/40, staggered 0.1 s
 *   section headlines: letters colour from slate to ink as the block scrolls from 75% to 15% of the viewport
 *   images: pixel-mask reveal, 24-cell grid, 3 s, bottom to top
 *   numbers: count up on first view
 * The presentation brief caps each section to one entrance choreography; prefers-reduced-motion renders everything final.
 */

const SPRING_SOFT = { type: "spring" as const, stiffness: 150, damping: 40, mass: 1 };
const SPRING_TEXT = { type: "spring" as const, stiffness: 400, damping: 100, mass: 1 };

/** Fade up on first view (Aoutive appearEffect: threshold 0.5, replay false). */
export function Reveal({ children, y = 24, delay = 0, className, style, as = "div", once = true, amount = 0.3 }: { children: ReactNode; y?: number; delay?: number; className?: string; style?: React.CSSProperties; as?: "div" | "li" | "section" | "tr"; once?: boolean; amount?: number }) {
  const reduce = useReducedMotion();
  const Tag = motion[as] as typeof motion.div;
  return (
    <Tag className={className} style={style} initial={reduce ? false : { opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once, amount, margin: "60% 0px 0px 0px" }} transition={{ ...SPRING_SOFT, delay }}>
      {children}
    </Tag>
  );
}

/** Hero fade up on mount at an absolute delay (buttons at 2 s, the instrument at 2.8 s in the reference). */
export function MountReveal({ children, y = 20, delay = 0, className, style }: { children: ReactNode; y?: number; delay?: number; className?: string; style?: React.CSSProperties }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} style={style} initial={reduce ? false : { opacity: 0, y }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING_SOFT, delay }}>
      {children}
    </motion.div>
  );
}

/** Word-by-word blur reveal on mount (Aoutive textEffect, tokenization "word"). */
export function WordReveal({ text, delay = 0.6, stagger = 0.05, className, as: Tag = "h1", style }: { text: string; delay?: number; stagger?: number; className?: string; as?: "h1" | "h2" | "p"; style?: React.CSSProperties }) {
  const reduce = useReducedMotion();
  const words = text.split(" ");
  return (
    <Tag className={className} style={style} aria-label={text}>
      {words.map((w, i) => (
        <motion.span
          key={`${w}-${i}`}
          aria-hidden
          style={{ display: "inline-block", willChange: "transform, filter, opacity" }}
          initial={reduce ? false : { opacity: 0, y: 10, filter: "blur(10px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ ...SPRING_TEXT, delay: delay + i * stagger }}
        >
          {w}
          {i < words.length - 1 ? " " : ""}
        </motion.span>
      ))}
    </Tag>
  );
}

function Char({ ch, start, end, progress }: { ch: string; start: number; end: number; progress: MotionValue<number> }) {
  const color = useTransform(progress, [start, end], ["var(--slate)", "var(--ink)"]);
  return <motion.span style={{ color }}>{ch}</motion.span>;
}

/**
 * Headline that colours in letter by letter as it scrolls through the viewport (Aoutive Text_Color_Letters:
 * useScroll offset ["start 0.75", "start 0.15"], slate to ink, character by character within each word).
 */
export function ScrollColorText({ text, as: Tag = "h2", className, style }: { text: string; as?: "h1" | "h2" | "p"; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.75", "start 0.15"] });
  const words = useMemo(() => text.split(" "), [text]);
  const total = words.length;
  if (reduce) return <Tag className={className} style={style}>{text}</Tag>;
  return (
    <Tag ref={ref as never} className={className} style={{ color: "var(--slate)", ...style }} aria-label={text}>
      {words.map((w, wi) => {
        const ws = wi / total;
        const we = (wi + 1) / total;
        const step = (we - ws) / w.length;
        return (
          <span key={`${w}-${wi}`} aria-hidden style={{ display: "inline-block", whiteSpace: "nowrap" }}>
            {w.split("").map((ch, ci) => <Char key={ci} ch={ch} start={ws + step * ci} end={ws + step * (ci + 1)} progress={scrollYProgress} />)}
            {wi < total - 1 ? " " : ""}
          </span>
        );
      })}
    </Tag>
  );
}

/** Count up from zero on first view; keeps the exact final string so decimals never change. */
export function CountUp({ value, duration = 0.9, className, style }: { value: string; duration?: number; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : "0");
  useEffect(() => {
    if (reduce || !inView) return;
    const m = value.match(/^([^\d]*)([\d,]+)(\.(\d+))?(.*)$/);
    let raf = 0;
    if (!m) {
      raf = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(raf);
    }
    const prefix = m[1] ?? "";
    const whole = Number((m[2] ?? "0").replaceAll(",", ""));
    const decimals = m[4] ?? "";
    const suffix = m[5] ?? "";
    const target = whole + (decimals ? Number(`0.${decimals}`) : 0);
    const start = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / (duration * 1000));
      const eased = 1 - Math.pow(1 - k, 3);
      const v = target * eased;
      const text = decimals ? v.toFixed(decimals.length) : Math.round(v).toLocaleString("en-US");
      setShown(`${prefix}${k >= 1 ? `${(m[2] ?? "").includes(",") ? whole.toLocaleString("en-US") : whole}${decimals ? `.${decimals}` : ""}` : text}${suffix}`);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, duration, reduce]);
  return <span ref={ref} className={className} style={style}>{shown}</span>;
}

/** Pixel-mask reveal: a grid of surface-coloured cells over an image, cleared bottom to top in a random order (Aoutive: grid 24, 3 s, direction up). */
export function PixelReveal({ src, alt, cols = 24, rows = 18, duration = 3, className }: { src: string; alt: string; cols?: number; rows?: number; duration?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const reduce = useReducedMotion();
  const cells = useMemo(() => {
    // Seeded so the server and the client render the same delays (a hydration mismatch otherwise).
    let seed = 1234567;
    const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const out: number[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push(((rows - 1 - r) / rows) * duration + rnd() * (duration / rows) * 3);
    return out;
  }, [cols, rows, duration]);
  return (
    <div ref={ref} className={`pixel ${className ?? ""}`}>
      <Image src={src} alt={alt} width={1280} height={960} unoptimized style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top left", display: "block" }} />
      {!reduce ? (
        <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }} aria-hidden>
          {cells.map((d, i) => (
            <i key={i} style={{ opacity: inView ? 0 : 1, transition: `opacity 0.25s linear ${d.toFixed(2)}s` }} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The same pixel mask over arbitrary children, so a live instrument (not only an image) can be revealed cell by cell. */
export function PixelMask({ children, cols = 24, rows = 13, duration = 3, className }: { children: React.ReactNode; cols?: number; rows?: number; duration?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.2 });
  const reduce = useReducedMotion();
  const cells = useMemo(() => {
    let seed = 7654321;
    const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const out: number[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push(((rows - 1 - r) / rows) * duration + rnd() * (duration / rows) * 3);
    return out;
  }, [cols, rows, duration]);
  return (
    <div ref={ref} className={`pixel ${className ?? ""}`}>
      {children}
      {!reduce ? (
        <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }} aria-hidden>
          {cells.map((d, i) => (
            <i key={i} style={{ opacity: inView ? 0 : 1, transition: `opacity 0.25s linear ${d.toFixed(2)}s`, pointerEvents: inView ? "none" : "auto" }} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Button label with the two-copy text-roll hover. */
export function Roll({ children }: { children: ReactNode }) {
  return (
    <span className="roll" aria-hidden={false}>
      <span>{children}</span>
      <span aria-hidden>{children}</span>
    </span>
  );
}

/** Rows that enter one at a time (ledger lines, statement rows, matrix rows). */
export function Stagger({ children, step = 0.08, base = 0, className, once = true }: { children: ReactNode[]; step?: number; base?: number; className?: string; once?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <div className={className}>
      {children.map((c, i) => (
        <motion.div key={i} initial={reduce ? false : { opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once, amount: 0.2, margin: "100% 0px 0px 0px" }} transition={{ duration: 0.22, ease: [0.2, 0, 0, 1], delay: base + i * step }}>
          {c}
        </motion.div>
      ))}
    </div>
  );
}

/**
 * Ticker (Aoutive tickerEffect): the row scrolls left at `velocity` px/s and slows to `hoverModifier`% on hover.
 * The children are duplicated so the loop is seamless; off under reduced motion.
 */
export function Ticker({ children, velocity = 50, hoverModifier = 40, gap = 48, className }: { children: ReactNode; velocity?: number; hoverModifier?: number; gap?: number; className?: string }) {
  const track = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const hover = useRef(false);
  useEffect(() => {
    if (reduce) return;
    const el = track.current;
    if (!el) return;
    let x = 0;
    let last = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      const v = velocity * (hover.current ? hoverModifier / 100 : 1);
      x -= v * dt;
      const half = el.scrollWidth / 2;
      if (half > 0 && -x >= half) x += half;
      el.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [velocity, hoverModifier, reduce]);
  return (
    <div className={className} style={{ overflow: "hidden", width: "100%" }} onMouseEnter={() => { hover.current = true; }} onMouseLeave={() => { hover.current = false; }}>
      <div ref={track} style={{ display: "flex", gap, width: "max-content", willChange: "transform" }}>
        <div style={{ display: "flex", gap, alignItems: "center" }}>{children}</div>
        <div style={{ display: "flex", gap, alignItems: "center" }} aria-hidden>{children}</div>
      </div>
    </div>
  );
}

/** Slide in from the side on first view (Aoutive styleTransformEffect: x ±290 → 0, spring 300/100). */
export function SlideIn({ children, x = 0, y = 0, className }: { children: ReactNode; x?: number; y?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} initial={reduce ? false : { x, y }} whileInView={{ x: 0, y: 0 }} viewport={{ once: true, amount: 0.2 }} transition={{ type: "spring", stiffness: 300, damping: 100, mass: 1 }}>
      {children}
    </motion.div>
  );
}
