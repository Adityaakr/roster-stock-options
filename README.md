# Roster Finance

Stock leverage without margin liquidation. Fully paid contracts on NVDAx, on Solana: choose an expiry, see the premium and break-even, know the maximum loss before you buy. No borrowing, no funding payments, no margin calls.

The standing brief is `CLAUDE.md`. The design authority is `docs/DESIGN.md` and `tokens.css`. Phases are logged in `docs/BUILD_LOG.md`.

## Run

```
pnpm install
pnpm dev            # apps/web on http://localhost:3000
pnpm typecheck && pnpm lint
pnpm shots          # 1280 and 390 screenshots of every page, against the running dev server
```

## Layout

```
apps/web        Next 16 app: landing page (/) and the product screens (/trade, /positions, /underwrite, /roster, /buy, /pre-ipo)
programs/       roster_finance Anchor program (P1)
packages/       oracle, quoter, keeper, indexer (P0 to P2)
scripts/        fork, seed, probes
docs/           DESIGN.md, BUILD_LOG.md, PLAN.md (P0)
```

Contracts can expire worthless. Nothing here is an offer of any security.
