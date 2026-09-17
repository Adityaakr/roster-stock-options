# Roster Finance design system

The visual authority CLAUDE.md refers to. Ported on 2026-09-17 from Lookthrough (`/Users/adityakrx/lookthrough/apps/web`), itself a port of the Aoutive Framer reference. Structure, tokens, components and motion are copied byte for byte; only the content changed. `apps/web/src/app/globals.css` is the file the app loads; `tokens.css` at the repo root is the extracted token block.

## 1. Identity

Paper and ink. A 1224px frame bounded by two vertical hairlines, 11px crosshair ticks at section corners, hairline-divided cells, rectangular 4px buttons with a text-roll hover, no shadows, light only. Headlines colour in from slate to ink as they scroll; the hero reveals word by word with a blur; instruments and images reveal through a 24-cell pixel mask.

## 2. Tokens (`:root`, globals.css)

| Token | Value | Use |
| --- | --- | --- |
| `--paper` | `#fcfcfc` | page background, cards |
| `--surface` | `#f7f7f7` | inset panels, table heads, active tabs |
| `--ink` | `#1a1a1a` | text, primary buttons, rules |
| `--ink-2` | `#4d4d4d` | secondary text |
| `--slate` | `#737373` | captions, labels, headline start colour |
| `--line` | `#e2e2e2` | every hairline |
| `--line-strong` | `#cacccc` | secondary button border, dotted leaders |
| `--accent` | `= --ink` | active rail in the sidebar |
| `--green` | `#1f6f4a` | up, settled, in the money, the "with Roster" column |
| `--amber` | `#9a6b14` | down, declined, warnings, max loss. Also aliased as `--red` and `--yellow`: the palette has no red |
| `--ease` | `cubic-bezier(0.2, 0, 0, 1)` | every CSS transition |
| `--frame` | `1224px` | container width |

Radii are literal: 4px (buttons, cards, fields), 3px (badges, chips, tips), 16px (`.wimages`). Breakpoints: 1260 (frame hairlines and ticks drop), 1100 (`.grid-4` to two columns), 809 (phone), 640 (kv, statements stack).

## 3. Type

Fonts via `next/font/google` in `src/app/layout.tsx`: Space Grotesk 400/500 (`--font-display`), Inter 400/500/600 (`--font-sans`), IBM Plex Mono 400/500 (`--font-mono`). Body 16px/1.6 Inter, antialiased.

| Class | Spec |
| --- | --- |
| `.display` | display 500, 64px/1.02, -0.05em (phone 40px) |
| `.h-section` | display 500, 56px/1.06, -0.06em (phone 34px) |
| `.h-sub` / `.h-item` | 28/34 -0.02em / 20/26 -0.01em |
| `.h1` to `.h6` | 48, 38, 32, 24, 18, 16, display 500, tight tracking |
| `.body` | 16/1.6, -0.02em, slate |
| `.body-lg` / `.body-sm` / `.small` / `.note` | 16/25 ink-2 / 14/21 ink-2 / 13/19 slate / 13/19 slate |
| `.mono` / `.num` | IBM Plex Mono, tabular figures, no tracking. **Every figure on every page is mono.** |

Copy rules: sentence case, no em-dashes (the screenshot test fails on one), no "demo", figures in mono.

## 4. Components (`src/components/ui.tsx`, `icons.tsx`, `mono.tsx`)

- `Badge` (mono 11px, hairline, `dot`), tones green / amber / accent. `Stat` (`.card.pad.stat`: 13px label, 28px display value, 13px sub). `KV` (two-column definition list, right-aligned tabular values, stacks at 640). `Address` (mono short form with a copy button). `Logo`, `Tabs` (segmented control, `role=tablist`), `Empty` (dashed card), `ErrorState` (`role=alert`), `Loading` (a sentence, never a skeleton).
- Buttons: `.btn` 14px/22px 500, 8px 23px padding. `.primary` ink on paper, `.secondary` hairline, `.wide` full width, `[disabled]` 40% opacity. Marketing buttons wrap the label in `<Roll>` for the text-roll hover.
- Fields: `.field` 40px, hairline, focus border ink-2. `.lbl` 12px slate.
- Tables: `.table` 14px, 12px slate heads, hairline rows, `.num` right-aligned tabular, `tr.row-link` hover surface. Wrap in `.card.scroll-x`.
- Cards: `.card` (paper, hairline, 4px), `.pad` 24px, `.inset` for nested boxes. Card header pattern: `padding 16px 20px; border-bottom hairline` with `.h6` + `.small`.
- Landing primitives: `.asec` / `.acontainer` / `.tick`, `.wcards` / `.wcard`, `.wimages` / `.artline`, `.fctable` / `.fc-stack`, `.ba*` (before and after), `.ucrow` / `.ucard`, `.ibox` / `.counters`, `.strip` / `.seg` / `.fill-*`, `.atab` / `.acards` / `.evcard`, `.stmt*` (statements), `.plans` / `.plan`, `.fcard` (FAQ), `.ctabox`, `.diptych`, `.wc*` (the instrument card), `.pixel`.
- App shell: `.shell` 240px sidebar + main, `.sidebar nav a` 36px rows with `aria-current=page` rail, `.topbar` 60px sticky translucent, `.main` 28px padding max 1180, `.page-head` (h1 `.h3` + `.body-sm`, actions right), `.grid-2/3/4`.

## 5. Motion (`src/components/motion.tsx`, `smooth-scroll.tsx`)

`motion@13.2.0` via `motion/react`, `lenis@1.3.26` (`lerp 0.1`, anchor clicks scroll with a -80 offset, off under reduced motion). No keyframes in CSS; no scroll pinning.

| Primitive | Behaviour |
| --- | --- |
| `Reveal` | opacity 0→1, y 24→0 on first view, spring 150/40, `viewport.margin "60% 0px 0px 0px"` |
| `MountReveal` | same, on mount, with a delay (hero buttons at 2.0 s and 2.1 s, hero instrument at 2.8 s) |
| `WordReveal` | per word: opacity, y 10, blur 10px→0, spring 400/100, 0.05 s per word after 0.6 s (sub: 0.03 s after 1 s) |
| `ScrollColorText` | per character slate→ink, `useScroll` offset `["start 0.75", "start 0.15"]` |
| `CountUp` | 0.9 s ease-out cubic, keeps prefix, commas, decimals and suffix |
| `PixelReveal` / `PixelMask` | 24 x 13 cell grid cleared bottom to top over 3 s with seeded jitter; `PixelMask` wraps live children (the hero table) |
| `Roll` | two-copy label, 0.4 s linear translateY on hover |
| `Stagger` | children fade up 0.22 s, 0.08 s apart, `viewport.margin "100% 0px 0px 0px"` |
| `Ticker` | RAF marquee at 50 px/s, 40% on hover, children duplicated, gradient mask on `.brandwrap` |
| `SlideIn` | x ±290 spring 300/100 (the two large product cards converge) |
| Accordions | `AnimatePresence` height auto, 0.6 s ease [0.2,0,0,1] (Said out loud, cycles every 6 s) or 0.3 s linear (What this is not) |
| Image swap | `AnimatePresence mode="wait"`, 0.3 s linear crossfade (Workflow) |

Every primitive reads `useReducedMotion()` and renders the final state under reduce; CSS kills transitions under `prefers-reduced-motion`.

## 6. Page templates

- **Landing** (`app/(marketing)/page.tsx`): nav, hero with the live Discover table under the pixel mask, brand ticker, the weekend before/after, the three worked examples with the payoff chart, workflow tabs with product frames, the difference table and 2x2, the five product cards, counters, the hours strip, the roster ledgers, sources accordion, First Print columns, what-this-is-not FAQ, risk diptych, CTA, footer.
- **App** (`app/(app)/*`): `page-head`, then `grid-4` stats, then cards and tables. Detail pages open with a breadcrumb `.small` line. Every screen shows the cluster badge in the sidebar and topbar.

## 7. What changed in the port

- Added `PixelMask` (motion.tsx) so the hero can pixel-reveal a live table, not only an image.
- Defined `--red`, `--yellow`, `--text`, `--text-2`, `--text-4` as aliases; the reference referenced them without defining them.
- Mobile shell: `.sidebar nav` gets `min-width: 0` so the horizontal nav strip scrolls instead of widening the page; the leading crumbs hide under 809px.
- Added `Sketch` (`components/landing/sketches.tsx`): per-product payoff sketches in the Quadrant's SVG style, replacing the template illustrations on the product cards.
- Added `PayoffChart` (`components/payoff-chart.tsx`) in the `LineChart` style: hairlines, one green line, gradient under it, amber dashed floor for the max loss.
- Everything else is the reference, unchanged.
