# Pyth feeds

Resolved 2026-09-17 from Hermes `GET /v2/price_feeds?query=<symbol>` on both `https://hermes.pyth.network` and `https://pyth.dourolabs.app/hermes` (identical results; the listing endpoint needs no key). Raw responses: `fixtures/probes/feeds_*.json` once copied from the probe scratch. Nothing here is from memory.

## Launch set, Tier 1

| Underlying | Token feed (Crypto, 24/7) | Equity reference feed (regular session) |
| --- | --- | --- |
| NVDAx | `Crypto.NVDAX/USD` `4244d07890e4610f46bbde67de8f43a4bf8b569eebe904f136b469f148503b7f` | `Equity.US.NVDA/USD` `b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593` |
| TSLAx | `Crypto.TSLAX/USD` `47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362` | `Equity.US.TSLA/USD` `16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1` |
| SPYx | `Crypto.SPYX/USD` `2817b78438c769357182c04346fddaad1178c82f4048828fe0997c3c64624e14` | `Equity.US.SPY/USD` `19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5` |

Tier 2 feeds are resolved by the registry job in P7 with the same query and recorded here when it runs.

Schedules, from the feed attributes: token feeds `America/New_York;O,O,O,O,O,O,O;` (open every day); equity feeds `0930-1600` Monday to Friday, closed Saturday and Sunday, NYSE holiday list embedded in the attribute.

## What moved to Pyth Pro

`.PRE`, `.POST` and `.ON` US equity session feeds were deprecated from Core on 2026-06-15 (Pyth blog, "Extended-hours US equity data moves to Pyth Pro"; Hermes `v2/price_feeds?query=NVDA.PRE` returns nothing). They require a Pro plan. Until `PYTH_PRO_API_KEY` exists the session state is derived from the published schedule (`https://docs.pyth.network/price-feeds/market-hours`: pre 04:00 to 09:30 ET, post 16:00 to 20:00 ET, overnight Sunday to Thursday 20:00 to 04:00 ET), not from a feed.

## Access

- Price reads: `GET /v2/updates/price/latest?ids[]=…` returns **HTTP 401** without a key on both hosts (tested). Header: `Authorization: Bearer $PYTH_CORE_API_KEY`. Sign up at Pyth Terminal (`https://pythdata.app/signup`).
- The upgraded Hermes is `https://pyth.dourolabs.app/hermes` (drop-in, same routes). The Core cutover date in the docs is **2026-08-26 16:00 UTC** (CLAUDE.md §2.2 says August 18; the docs win).
- Rate limit per CLAUDE.md §2.2: about 30 requests per 10 s per IP. `packages/oracle` is the only caller and caches with a short TTL.

## Solana receiver (for `auto_exercise` only)

| Item | Value | Source |
| --- | --- | --- |
| Receiver, upgraded generation | `rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp` (executable on mainnet) | docs.pyth.network upgrade/contracts; `pyth-solana-receiver-sdk` 2.0.0 `lib.rs` |
| Receiver, previous generation | `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` | docs.pyth.network contract-addresses/solana |
| Push oracle (upgraded / previous) | `pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou` / `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT` | same |
| Rust crate | `pyth-solana-receiver-sdk` 2.0.0, feature `pro-compatible`; depends on `anchor-lang ^1.0.2` | crates.io |
| TS packages | `@pythnetwork/pyth-solana-receiver` 0.16.0, `@pythnetwork/hermes-client` 3.1.0 | npm |
| On-chain check | `PriceUpdateV2::get_price_no_older_than(&Clock, max_age, &feed_id)` with `VerificationLevel::Full`; the program adds `conf · 10_000 ≤ price · max_conf_bps` itself | docs.rs 2.0.0 |

Pairing rule from the docs: an endpoint's payloads verify only on its own contract generation; endpoint and receiver id are swapped together. New code uses the upgraded pair. Whether a single transaction can post a fully verified update and consume it is the subject of the skeptic pass in `docs/01-architecture.md` §7.

## Open

- Does `Crypto.NVDAX/USD` price one UI share-equivalent or one raw unit? Decides the multiplier factor in the auto-exercise comparison. Resolve by reading one price against the xStocks API price-data endpoint before `auto_exercise` is written.
- Redemption-rate feeds exist (`Crypto.NVDAX/NVDA.RR` `b675c4e9…`); not used.
