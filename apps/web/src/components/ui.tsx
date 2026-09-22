"use client";

import { motion, useReducedMotion } from "motion/react";

import Image from "next/image";
import { useState, type ReactNode } from "react";

/** Section label with a coloured pill indicator (Framer "Tag"). */
export function Label({ children, tone = "blue" }: { children: ReactNode; tone?: "blue" | "green" | "yellow" | "cyan" | "purple" | "pink" | "orange" | "teal" }) {
  return (
    <span className={`label ${tone}`}>
      <i />
      {children}
    </span>
  );
}

export function Badge({ children, tone, dot }: { children: ReactNode; tone?: "green" | "yellow" | "amber" | "blue" | "red" | "purple" | "accent"; dot?: boolean }) {
  return (
    <span className={`badge ${tone ?? ""}`}>
      {dot ? <i /> : null}
      {children}
    </span>
  );
}

export function Stat({ k, v, s, tone }: { k: string; v: ReactNode; s?: ReactNode; tone?: "green" | "red" | "yellow" }) {
  return (
    <div className="card pad stat">
      <div className="k">{k}</div>
      <div className={`v ${tone === "green" ? "up" : tone === "red" ? "down" : ""}`}>{v}</div>
      {s ? <div className="s">{s}</div> : null}
    </div>
  );
}

export function KV({ items, wrap = false, columns = 1 }: { items: { k: string; v: ReactNode }[]; wrap?: boolean; /** Two lays the pairs out side by side on wide screens. */ columns?: 1 | 2 }) {
  return (
    <dl className={`kv ${wrap ? "wrap" : ""} ${columns === 2 ? "kv-2" : ""}`}>
      {items.map((it) => (
        <div key={it.k} className="contents">
          <dt>{it.k}</dt>
          <dd>{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Address({ value, n = 4, href }: { value: string; n?: number; href?: string | null }) {
  const [done, setDone] = useState(false);
  const short = value.length > n * 2 + 2 ? `${value.slice(0, n)}…${value.slice(-n)}` : value;
  return (
    <span className="inline-flex items-center gap-2" style={{ whiteSpace: "nowrap" }}>
      {href ? (
        <a className="mono" href={href} target="_blank" rel="noreferrer" title={value} style={{ borderBottom: "1px dotted var(--line-strong)" }}>
          {short}
        </a>
      ) : (
        <span className="mono" title={value}>{short}</span>
      )}
      <button
        type="button"
        className="copy"
        aria-label={`Copy ${value}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setDone(true);
            setTimeout(() => setDone(false), 1200);
          } catch {
            setDone(false);
          }
        }}
      >
        {done ? "copied" : "copy"}
      </button>
    </span>
  );
}

export function Logo({ src, symbol, size = "" }: { src?: string | null; symbol: string; size?: "" | "sm" | "lg" }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <span className={`logo ${size}`}>{symbol.replace(/[^A-Z0-9]/gi, "").slice(0, 3).toUpperCase()}</span>;
  const px = size === "lg" ? 52 : size === "sm" ? 24 : 36;
  return <Image className={`logo ${size}`} src={src} alt="" width={px} height={px} unoptimized onError={() => setBroken(true)} />;
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode }[] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((it) => (
        <button key={it.id} role="tab" aria-selected={value === it.id} onClick={() => onChange(it.id)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ title, action, cta }: { title: string; action?: string; cta?: ReactNode }) {
  return (
    <div className="card pad" style={{ borderStyle: "dashed" }}>
      <div className="h6">{title}</div>
      {action ? <p className="body-sm" style={{ margin: "6px 0 0" }}>{action}</p> : null}
      {cta ? <div className="btnrow mt-4">{cta}</div> : null}
    </div>
  );
}

export function ErrorState({ message, next }: { message: string; next?: React.ReactNode }) {
  return (
    <div className="card pad" role="alert" style={{ borderColor: "rgba(255,99,88,0.35)" }}>
      <div className="msg red">{message}</div>
      {next ? <div className="msg mt-1">{next}</div> : null}
    </div>
  );
}

/** The wait, in the middle of the page: the mark turns while the data loads, with one quiet line under it. */
export function Loading({ what }: { what: string }) {
  const reduce = useReducedMotion();
  return (
    <div className="loading" role="status" aria-live="polite">
      {reduce ? <i className="mark" aria-hidden /> : <motion.i className="mark" aria-hidden animate={{ scale: [1, 0.82, 1], rotate: [0, 90, 90, 180, 180] }} transition={{ duration: 1.6, repeat: Infinity, ease: [0.2, 0, 0, 1], times: [0, 0.5, 0.55, 1, 1] }} />}
      <span>Reading {what}</span>
    </div>
  );
}

export const fmtUsd = (v: number | null | undefined, digits = 2) => (v == null ? "n/a" : `$${v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits })}`);
export const fmtUsd0 = (v: number | null | undefined) => (v == null ? "n/a" : `$${Math.round(v).toLocaleString("en-US")}`);
export const fmtCompact = (v: number | null | undefined) => (v == null ? "n/a" : `$${Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v)}`);
export const fmtPct = (v: number | null | undefined) => (v == null ? "n/a" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);
