# Roster Finance project model (Prism code-truth layer)

## Architecture
pnpm workspace. `apps/web` (Next 16.3.5, React 19, Tailwind v4, motion 13.2.0, lenis) is the only package so far. Landing at `/` (route group `(marketing)`), product screens under `(app)` behind `AppShell`. One server read, `lib/roster-data.ts` -> `/api/roster`, feeds every screen; `lib/model.ts` holds the display arithmetic. Design is the Lookthrough/Aoutive system copied verbatim (`docs/DESIGN.md`, `tokens.css`, `apps/web/src/app/globals.css`).

## Invariants (cited)
- A contract is two integers, `raw_qty` and `total_strike`; the multiplier is display and pricing only, never settlement (CLAUDE.md 4.1; `apps/web/src/lib/model.ts` header comment).
- No id, address, feed id, signature or URL is invented: fields render `null` as "linked at deploy" / "no signature on this cluster" / "link pending verification" (`lib/roster-data.ts`, `components/landing/sources.ts`, `app/(app)/roster/page.tsx`).
- Copy lint: no em-dash, no "demo", figures in mono; enforced by `apps/web/e2e/shots.spec.ts` (em-dash check) and by convention.
- The cluster is shown on every product screen (`components/app-shell.tsx`, CLAUDE.md 4.4).

## Danger zones
- `sessionAt()` and `nextFridays()` in `lib/model.ts` use the New York clock but not NYSE holidays.
- Fixture figures (mark 182.30, premiums, reserves) exist only to make CLAUDE.md 6's worked examples hold; do not let them leak past the `fixture` cluster.
- `.kv dd` is `white-space: nowrap` above 640px; long values must wrap or the layout widens.

## Decision log
- 2026-09-17 Design port before P0 at Aditya's request: copy Lookthrough's landing and product design exactly, swap content. Landing owns `/`; Discover screen at `/trade`; hero embeds the nearest-expiry Discover table. Fixture cluster with honest disabled actions rather than mocked signatures. Sources without verified URLs are null, not guessed.

## Lessons
- Playwright `fullPage` capture never scrolls, so `whileInView` reveals do not fire; walk the page with `window.scrollTo` first (`e2e/shots.spec.ts`).
- On the mobile shell, a flex nav inside a grid column needs `min-width: 0` or it widens the page instead of scrolling.
- `eslint-config-next` 16 flags `setState` inside `useEffect` (react-hooks/set-state-in-effect); use promise callbacks or RAF.
