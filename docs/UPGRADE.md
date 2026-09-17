# Upgrade runbook

The program's upgrade authority is the multisig from the moment of the first mainnet deploy (`docs/SEEDING.md` step 2). No single key can change the program after that.

## Before an upgrade

1. `cargo test --release -p roster_finance` green; `pnpm test:fork` green on a fresh fork with the **current mainnet accounts**: `pnpm fork` forks mainnet, `pnpm anchor:deploy` upgrades the forked program in place, so every existing series is exercised through the new code before mainnet sees it.
2. Account layouts: `Series`, `MarketConfig`, `Protocol`, `AutoExercise` are `#[repr(C)]` zero-copy or fixed-size Anchor accounts with `_reserved` tails. A change that alters an existing field's offset is a **migration, not an upgrade**: it needs a new program id or a per-account migration instruction and is out of scope for a runbook. Adding a field inside `_reserved` (and shrinking `_reserved` by the same size) is an upgrade.
3. `docs/COMPUTE.md` re-measured if an instruction's CU changed by more than 10%.
4. `pnpm idl:sync` and the app rebuilt against the new IDL; the indexer's event names are the IDL's.

## The upgrade

1. `anchor build --arch v0`; `solana program write-buffer target/deploy/roster_finance.so` from any funded key; `solana program set-buffer-authority <buffer> --new-buffer-authority $MULTISIG`.
2. The multisig executes `solana program deploy --program-id FJUd… --buffer <buffer>` (or its own upgrade instruction). Two signers minimum.
3. Verify: `solana program show FJUd…` reports the new slot; `pnpm test:fork` against a fresh fork of post-upgrade mainnet; the services restarted.

## Pausing instead of upgrading

The pause authority (`KEEPER_KEYPAIR`) can `pause_market` or `pause_all` at any time and cannot do anything else; only the authority can unpause. A pause stops `create_series`, `quote` and `buy`; `exercise` and `settle_writer` keep working, so holders are never locked out by the protocol's own pause (an issuer pause of the mint is the halt rule instead).

## Rolling back

An upgrade is rolled back by deploying the previous buffer the same way. Keep the last three `.so` builds and their git commits in the release notes.
