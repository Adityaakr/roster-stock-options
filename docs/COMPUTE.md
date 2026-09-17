# Compute budget

Measured on litesvm 0.16 (spl_token_2022 11.0.0) on 2026-09-17, `programs/roster_finance/tests/compute.rs`, against the NVDAx replica mint (ScaledUiAmount, Pausable, empty hook slot). Default per-transaction budget is 200,000 CU; a transaction may request up to 1,400,000.

| Instruction | CU | Notes |
| --- | --- | --- |
| `create_series` | 76,083 | Token-2022 mint with MetadataPointer + MintCloseAuthority + on-mint metadata, three vaults, 4,960-byte zero-copy series |
| `quote` (deposit + sorted insert) | 17,231 | one `transfer_checked` into the vault |
| `buy` walking **8 asks** | 74,149 | eight slot folds, two USDC transfers, one `mint_to`; well inside the default budget, so the walk bound stays at 8 (addendum D) |
| `exercise` (call) | 46,275 | burn, USDC in, underlying out |

Not yet measured on a transfer-hook mint (no launch-set mint has a live hook; `docs/MINT.md`) or with `#[event_cpi]` (plain `emit!` is used; an 8-fill buy emits 8 `Fill` events plus one `Bought`, within the log budget on litesvm). `auto_exercise` adds the Pyth receiver `post_update_atomic` in the same transaction; measured on the fork in M3 once a key exists.
