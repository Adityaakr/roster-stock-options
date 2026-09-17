"use client";

import { useState } from "react";

/** One-click copy that confirms in place. */
export function CopyButton({ value, label = "copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="tag"
      aria-label={`${label} ${value}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? "copied" : label}
    </button>
  );
}

export function Hash({ value, n = 6 }: { value: string; n?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="mono" title={value}>
        {value.length > n * 2 + 1 ? `${value.slice(0, n)}…${value.slice(-n)}` : value}
      </span>
      <CopyButton value={value} />
    </span>
  );
}
