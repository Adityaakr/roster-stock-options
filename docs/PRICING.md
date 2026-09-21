# Pricing

How the treasury and the vaults price what they post. Every decision line in the services log carries these inputs.

## The mark

Per market, in order: for a PreStocks token, the price where the token trades (`tokenPrice` from the issuer's API),
never the issuer's mark; the Tokens API snapshot; Jupiter's routed price; the xStocks quote. Routed and snapshot prices are per token and are divided by the on-chain
multiplier to give a per-share price. A devnet replica takes the price of the mainnet mint it stands in for. Pyth Core
is used when the key's grant covers the feed and is absent otherwise; the app prints which source priced every mark.

## The reference model

Black-Scholes on the per-lot forward (`price × multiplier`, or the pending dividend multiplier when one is scheduled),
the strike per lot, time to expiry in years, and a realised volatility blended over 7, 30 and 90 day windows with a
configured floor (35% annualised). Realised volatility comes from Pyth Benchmarks when the key allows; a floor-bound
volatility is reported as `floor` and the app says so.

**Pre-IPO tokens** have no Benchmarks symbol. Their volatility is measured from the real daily closes of the token's
deepest USDC pool on mainnet (GeckoTerminal's public OHLCV, kept in the indexer under `gt_day:<mint>`), the same
7/30/90 blend, once seven days exist; before that from the token prices the services record themselves, and is a stated
floor of 90% annualised until either exists (`PREIPO_VOL_FLOOR`; the recorded SPACEX ticks ranged 8% in six hours on
2026-09-20, which a 35% floor would have sold for a third of fair value). The source is reported as `recorded` or
`preipo_floor` and the token page prints which.

**Transfer fees are in the price.** On a mint with a transfer fee `f`, a Gap delivers the tokens less the fee, so its
value is `(1 − f) × call(S, K / (1 − f))`; a Floor has the holder deliver gross so the writers receive exactly the raw
amount, so its value is `put(S / (1 − f), K)`. The vault's bid floors at the same fee-aware intrinsic. Both make the fee
the holder's cost, priced, rather than the writer's surprise.

**The known mismatch.** The token trades 168 hours a week; the share behind it trades about 32.5, a fifth of the week.
A volatility measured on the token's 24/7 series prices the weekend the way the token moves, not the way the share
will open. The session multiplier below is the model's answer; it is a spread, not a forecast.

## The ask

`ask = theoretical × (1 + spread) × skew`, floored at a minimum per lot so a deep out-of-the-money contract never quotes
for dust.

- `spread` is the base half-spread (12% of theoretical) times the **session multiplier**: 1.0 regular, 1.4 pre and post,
  1.8 overnight, 2.2 fully closed, from Pyth's published market hours; 3.0 inside the fifteen minutes either side of a
  multiplier activation. A pre-IPO token has no exchange session, so it takes one constant multiplier of 1.6 instead of
  the clock: there are no regular hours to be cheap in and no close to be wide in, only a thin on-chain book.
- `skew` is the **utilisation skew** for the vault: `1 + 3u²` where `u` is the vault's own sold lots in this series
  over its per-series cap. 1.03 at a tenth sold, 1.75 at half, 3.4 at nine tenths; at the cap the vault stops asking and
  the app shows it at capacity. External writers can still fill the book above it. This is what Hegic lacked: a pool
  that sells at one implied volatility whatever the flow gets sold into every volatility spike.
- The treasury's own asks use a milder inventory skew, `1 + 0.002 × lots sold`.

## The bid

`bid = max(intrinsic, theoretical × (1 − bidSpread × sessionMultiplier))`, `bidSpread` 8%. Never below intrinsic, so the
vault never bids below what the contract is worth exercised now. Sized to the vault's own unassigned short in the
series and to the USDC it holds, which is premium it has claimed from its fills; posted with a fifteen-minute expiry
and refreshed every tick.

## Breakers

Each stops quoting on a market and logs its trigger; none touches the book or an exercise: price older than 60
seconds; token-versus-share basis beyond 300 bps in the regular session; the market paused or the mint frozen; the
vault halted by its manager or the pause authority. A halted vault still settles, rolls and pays withdrawals. A
pre-IPO token's spread to the issuer's mark is recorded and shown but is not a basis and never feeds this breaker:
nothing converts the token into the share before a listing, so the spread is a premium or a discount, not an error.
