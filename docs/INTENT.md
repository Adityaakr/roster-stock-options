# The intent box

A sentence in, a priced ticket out. Where a model helps in a venue whose whole pitch is that nothing can be blocked or mispriced by something you cannot audit, and where it must not go.

## What it does

On the Ask page (`/ask`, first in the Trade group; Markets links to it), a person types what they want: "$200 of Nvidia upside through Friday", "protect my 20 NVDAx through earnings", "get paid to buy Tesla 10% lower". The box answers with a ticket (market, Gap or Floor, strike, expiry, size, total, max loss, break-even) and two plain sentences, then a **Review** button that opens the Act screen (or Underwrite, for the write side) with that term and size filled in. Nothing is signed from the box.

## Three steps, and the model is trusted with one

1. **Parse** (`parseIntent`). The model receives the sentence and the list of listed symbols with their names, and must answer with one tool call: action (`buy_gap`, `buy_floor`, `write_floor`, `write_gap`, `unclear`), market symbol or null, shares or a USDC budget, a horizon (nearest, furthest, a number of days, a date), a strike preference (at the money, cheap, tight, or a percent from the mark), and a one-line note of what it assumed. It never sees the book, a price or a premium. A market it invents fails the symbol check and the box says "which market?".
2. **Resolve** (`resolveIntent`). Code picks the expiry (the nearest one that lasts as long as asked, else the furthest with a caveat), the strike (nearest the mark on the right side of it by default; the cheapest, the tightest, or nearest a stated percent), and the size (as stated, or what the budget buys at that term's own ladder, capped at what is fillable). The price is `costOf`, the same walk of the resident asks the Act screen uses. Every decision the resolver made on its own is returned as a caveat and shown.
3. **Phrase** (`phrase`). The model receives the resolved facts as strings and writes two sentences. Every number in its text must appear verbatim among those facts; a sentence with any other number, an em-dash, or the word yield is discarded and the app's own template sentence is shown instead. The template is always computed first, so the box never waits on the model for its figures.

## Why this shape

- The oracle-free exercise path, the published pricing model and the honesty rules all rest on numbers a reader can recompute. A model that produced a premium would break that, and a model that paraphrased one could misstate it. Here the model maps words to a small enum and the app does the arithmetic.
- "Should I buy this?" is not a question the box answers. It shows the ticket, the worst case and the disclosure line, and the Act screen still asks for the signature.
- Absent, not stubbed: without `OPENROUTER_API_KEY` the `/api/intent` route reports `enabled: false` and the box does not render.

## Plumbing

- `apps/web/src/lib/intent.ts`: the three steps. OpenRouter, model `anthropic/claude-sonnet-5` (listed with tool support at `openrouter.ai/api/v1/models` on 2026-09-20), temperature 0, 15 s timeout on the parse and 12 s on the phrasing.
- `apps/web/src/app/api/intent/route.ts`: `GET` says whether the box exists; `POST {text}` (one sentence, up to 300 characters) returns the proposal, or `422` with the reason and the parsed intent, or `502` when the model cannot be reached.
- `apps/web/src/app/(app)/ask/page.tsx`: the page. Nine example sentences in three groups (upside, protection, get paid); the ticket with its four figures, the explanation, the payoff chart for a purchase and a five-price table of the result at expiry with what each one means; beside it, **what the model read** (the parsed intent, as returned, including its own note) and **what the app decided** (expiry, strike with its distance from the mark, size, how the price was formed, what is fillable, and every assumption the resolver made). A failed parse shows the reason and what was read. Test ids `intent`, `intent-text`, `intent-go`, `intent-result`, `intent-error`, `intent-review`.
- `/trade/[term]?size=` and `/underwrite?m=&t=&size=` accept the handover.
- `apps/web/e2e/intent-devnet.spec.ts`: the sentence above becomes a Gap on NVDAx and the Act screen opens on it with the same size; skipped when the key is absent.

## Cost

Two short calls per sentence, about 1,500 input tokens and under 200 output, at the model's listed price a fraction of a cent. The key is server-side and the route takes one sentence at a time; a public deployment should rate-limit it per IP like the faucet.

## Not done

Answering "what if it opens at $X" on Positions from the position's own payoff, and a docs agent grounded on this folder, are the next two uses that keep the same rule: the model phrases, the app computes.
