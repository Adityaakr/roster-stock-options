# Rent budget

Measured after `anchor build` on 2026-09-17 (`programs/roster_finance/tests/sizes.rs`). Rent exemption is
(bytes + 128) x 6,960 lamports (2 years at 3,480 lamports per byte-year).

| Account | Bytes | SOL |
| --- | --- | --- |
| `Series` (32 asks x 32 B, 32 writer slots x 112 B, header, reserve) | 4,960 | 0.0354 |
| Position mint (Token-2022, MetadataPointer + MintCloseAuthority + TokenMetadata for the term) | ~350 | ~0.0033 |
| Three vaults (Token-2022 with required account extensions, or SPL Token) | 165 to 179 each | ~0.0021 each |
| **Per series** | | **~0.045** |
| `MarketConfig` | 370 | 0.0035 |
| `Protocol` + fee vault | 222 + 165 | 0.0045 |

Tier caps (addendum C): Tier 1 `max_live_series` 12 x 3 markets = 36 series = **1.6 SOL**; Tier 2 at 6 x 8 = 48 series = 2.2 SOL. All of it is reclaimed by `close_series` after expiry plus grace except the position mint when unexercised tokens are still outstanding (~0.0033 SOL per abandoned mint; the mint is closed when supply reaches zero).

The Series is zero-copy (`AccountLoader`), so its 4,960 bytes are never deserialized onto the 4 KB BPF stack; `anchor build` reports no frame overflows.
