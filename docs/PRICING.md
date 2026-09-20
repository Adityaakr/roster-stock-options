# Pricing

How the treasury and the vaults price what they post. Every decision line in the services log carries these inputs.

## The mark

Per market, in order: an issuer that publishes a mark for its own token (Tessera, PreStocks); the Tokens API snapshot;
Jupiter's routed price; the xStocks quote. Routed and snapshot prices are per token and are divided by the on-chain
multiplier to give a per-share price. A devnet replica takes the price of the mainnet mint it stands in for. Pyth Core
is used when the key's grant covers the feed and is absent otherwise; the app prints which source priced every mark.

## The reference model

Black-Scholes on the per-lot forward (`price × multiplier`, or the pending dividend multiplier when one is scheduled),
the strike per lot, time to expiry in years, and a realised volatility blended over 7 and 30 day windows with a
configured floor (35% annualised). Realised volatility comes from Pyth Benchmarks when the key allows, else from the
marks the services record themselves every tick; a floor-bound volatility is reported as `floor` and the app says so.

**The known mismatch.** The token trades 168 hours a week; the share behind it trades about 32.5, a fifth of the week.
A volatility measured on the token's 24/7 series prices the weekend the way the token moves, not the way the share
will open. The session multiplier below is the model's answer; it is a spread, not a forecast.

## The ask

`ask = theoretical × (1 + spread) × skew`, floored at a minimum per lot so a deep out-of-the-money contract never quotes
for dust.

- `spread` is the base half-spread (12% of theoretical) times the **session multiplier**: 1.0 regular, 1.4 pre and post,
  1.8 overnight, 2.2 fully closed, from Pyth's published market hours; 3.0 inside the fifteen minutes either side of a
  multiplier activation.
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
vault halted by its manager or the pause authority. A halted vault still settles, rolls and pays withdrawals.
