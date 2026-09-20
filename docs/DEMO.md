# The three-minute walkthrough

The click path for the video, in the order the product is meant to be understood: Discover, Act, Manage, Commit, then
the roster. Every number on screen is live; nothing is staged. Record at 1280 wide with the header visible so the
cluster label is in every frame.

**0:00 · The problem, one sentence, over the landing page.** "Tokenized stocks trade all weekend; the shares behind
them do not. Every way to lever them today can liquidate you on a Saturday wick the market never confirms. This can't."
Scroll once to the hours strip: 168, 32.5, 75, 63%.

**0:20 · Discover.** Markets. Point at executable depth and the best ask. Click NVDAx. The mark, the change, the
session badge ("Equity market closed" on a weekend: say why the price still moves). The **Trade now** panel: the
cheapest Gap and Floor each with a Buy button.

**0:45 · Act.** Buy a Gap. Drag the expected price: profit moves, break-even and max loss stay pinned. Say the max
loss out loud: "this is the most this can lose, and it is already paid." Size 1. Buy. Sign. The signature with its
explorer link.

**1:15 · Manage.** Positions. The contract, what it is worth now, exactly what exercising requires in words. Then the
line most venues do not have: **the vault's bid**. Click Sell. Sign. "I took a winning position off without paying the
strike, because the vault that wrote it bought it back."

**1:45 · Commit, two ways.** Underwrite: write one Floor directly, the collateral locks, the ask appears on the roster.
Then Vaults: deposit 1 NVDAx, and read the screen: it enters at the next roll, at that time, at that roll's published
price; three adverse scenarios in dollars beside the box; "paid risk, not yield" at the top. Say: "This is the part
PsyOptions never solved and Ribbon did: the vault is the maker."

**2:30 · The roster.** Quotes at three sizes, reserved collateral with the account addresses (click one through to the
explorer), the exercise history with signatures, and the vaults epoch by epoch, losses included. "A venue that
publishes whether its promises are funded is a venue that expects to be checked."

**2:50 · Close.** The what-is-live table in the README, one line: "Everything you saw runs on devnet against the
program at that address; the same code round-trips on a mainnet fork against the real NVDAx mint. Mainnet is a
funding decision, not a build."

## Before recording

- Services and app running on devnet; `GET /api/cluster` says devnet and the header agrees.
- The vault has rolled at least once (`/vaults` shows an epoch table) and is quoting (`[vault] post` in the log).
- A wallet with test funds already connected, or use the burner and the faucet on camera (adds twenty seconds).
- Treasury SOL above 3, so nothing stalls mid-take.
