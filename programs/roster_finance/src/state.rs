use anchor_lang::prelude::*;

/// Fixed capacity of the on-chain ask list per series (addendum D).
pub const MAX_ASKS: usize = 32;
/// Writer slots per series; every writer's accounting lives inside the series so `buy` touches a fixed account set.
pub const MAX_WRITERS: usize = 32;
/// Asks walked by one `buy` (addendum D).
pub const MAX_WALK: usize = 8;
/// The most one writer may hold open in a series, 1e7 lots: at the product's floor precision (1e-9) a writer's
/// rounding claim is then at most 0.01 lot per exercise, one minimum size, whoever settles after it.
pub const MAX_WRITER_LOTS6: u64 = 10_000_000 * 1_000_000;
/// One position token (6 decimals) is one lot; amounts of lots carry six decimals.
pub const LOT6: u64 = 1_000_000;
/// The assignment product `P` is a fixed-point number with this many units per 1.0.
pub const P_ONE: u128 = 1_000_000_000_000_000_000;
/// When `P` drops below this after an exercise it is rescaled up by `P_SCALE` and `scale` increments (Liquity pattern).
pub const P_FLOOR: u128 = 1_000_000_000;
pub const P_SCALE: u128 = 1_000_000_000;

/// Protocol-wide configuration. `authority` is the Squads vault; `pause_authority` can pause and nothing else.
#[account]
#[derive(InitSpace)]
pub struct Protocol {
    pub bump: u8,
    pub authority: Pubkey,
    pub pause_authority: Pubkey,
    pub treasury: Pubkey,
    pub quote_mint: Pubkey,
    pub fee_bps: u16,
    pub integrator_share_bps: u16,
    pub keeper_fee_usdc: u64,
    pub grace_secs: i64,
    pub paused_all: bool,
    /// Who may create series on Tier 1 and Tier 2 markets (the quoter); the authority always may. Tier 3 is open.
    /// Zero means "authority only", so a protocol account written before this field behaves as before.
    pub series_creator: Pubkey,
    pub _reserved: [u8; 32],
}

impl Protocol {
    pub const SEED: &'static [u8] = b"protocol";
    pub fn may_create_series(&self, signer: &Pubkey, tier: u8) -> bool {
        tier >= 3 || *signer == self.authority || (self.series_creator != Pubkey::default() && *signer == self.series_creator)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum Side {
    Call,
    Put,
}

/// One listed underlying. Created from a registry entry; token program, decimals and extension flags are derived from
/// the mint account on-chain, never taken from the entry.
#[account]
#[derive(InitSpace)]
pub struct MarketConfig {
    pub bump: u8,
    pub mint: Pubkey,
    pub quote_mint: Pubkey,
    pub token_program: Pubkey,
    pub decimals: u8,
    pub has_transfer_fee: bool,
    pub has_permanent_delegate: bool,
    pub pausable: bool,
    /// Pubkey::default when the hook slot is empty; a non-default value means every vault transfer needs extra accounts.
    pub hook_program: Pubkey,
    pub token_feed_id: [u8; 32],
    pub equity_feed_id: [u8; 32],
    /// Expiries the keeper keeps rolled (16:00 New York); zero means unused.
    pub allowed_expiries: [i64; 4],
    /// Strikes are micro-USDC per lot and must be multiples of this inside [min_strike, max_strike].
    pub strike_step: u64,
    pub min_strike: u64,
    pub max_strike: u64,
    pub max_live_series: u16,
    pub live_series: u16,
    pub min_lots6: u64,
    pub max_lots6: u64,
    pub max_writer_lots6: u64,
    pub tier: u8,
    pub listed: bool,
    pub paused: bool,
    pub issuer_paused_at: i64,
    pub max_price_age_secs: u32,
    pub max_conf_bps: u16,
    /// Ticker used in position-token metadata, set at listing; never caller-supplied.
    pub symbol: [u8; 8],
    /// The token feed prices one UI share-equivalent (true) or one raw token (false); decides the multiplier factor in auto-exercise.
    pub feed_prices_ui_share: bool,
    pub _reserved: [u8; 55],
}

impl MarketConfig {
    pub const SEED: &'static [u8] = b"market";

    /// Raw units in one six-decimal lot unit: 10^(decimals - 6).
    pub fn raw_per_lot6(&self) -> u64 {
        10u64.pow(u32::from(self.decimals) - 6)
    }
    pub fn symbol_str(&self) -> String {
        String::from_utf8_lossy(&self.symbol).trim_end_matches('\0').to_string()
    }
}

pub const SERIES_OPEN: u8 = 0;
pub const SERIES_HALTED: u8 = 1;
pub const SIDE_CALL: u8 = 0;
pub const SIDE_PUT: u8 = 1;

impl Side {
    pub fn from_u8(v: u8) -> Side {
        if v == SIDE_PUT { Side::Put } else { Side::Call }
    }
    pub fn as_u8(self) -> u8 {
        match self { Side::Call => SIDE_CALL, Side::Put => SIDE_PUT }
    }
}

/// A resident ask: `writer_slot` indexes `Series::writers`. Plain-old-data, 32 bytes.
#[zero_copy]
#[repr(C)]
#[derive(Default, Debug)]
pub struct Ask {
    pub remaining_lots6: u64,
    pub ask_per_lot: u64,
    pub seq: u64,
    pub writer_slot: u8,
    pub _pad: [u8; 7],
}

/// A writer's accounting inside the series. Lots are six-decimal. `open` is the writer's unassigned sold lots at the
/// last fold; the fold brings it to the present through `P`, `scale` and `epoch` (see `math`). 112 bytes.
#[zero_copy]
#[repr(C)]
#[derive(Default, Debug)]
pub struct WriterSlot {
    pub writer: Pubkey,
    pub p_snap: [u64; 2],
    pub deposited_lots6: u64,
    pub withdrawn_lots6: u64,
    pub sold_lots6: u64,
    pub open_lots6: u64,
    pub assigned_lots6: u64,
    pub premium_claimable: u64,
    pub epoch_snap: u32,
    pub scale_snap: u8,
    pub settled: u8,
    pub _pad: [u8; 10],
}

impl WriterSlot {
    pub fn is_empty(&self) -> bool {
        self.writer == Pubkey::default()
    }
    /// A slot that can be handed to a new writer: nothing deposited that is not withdrawn, nothing sold, nothing owed.
    pub fn is_recyclable(&self) -> bool {
        self.is_empty() || (self.deposited_lots6 == self.withdrawn_lots6 && self.sold_lots6 == 0 && self.premium_claimable == 0)
    }
    pub fn p_snap(&self) -> u128 {
        ((self.p_snap[1] as u128) << 64) | self.p_snap[0] as u128
    }
    pub fn set_p_snap(&mut self, v: u128) {
        self.p_snap = [v as u64, (v >> 64) as u64];
    }
    pub fn is_settled(&self) -> bool {
        self.settled != 0
    }
}

/// One term: pooled collateral, pooled settlement, a bounded ask list and every writer's slot. Zero-copy: the
/// account is about 4.9 KB and is read in place, never deserialized onto the stack.
#[account(zero_copy)]
#[repr(C)]
pub struct Series {
    pub market: Pubkey,
    pub collateral_vault: Pubkey,
    pub settlement_vault: Pubkey,
    pub quote_vault: Pubkey,
    pub position_mint: Pubkey,
    pub rent_payer: Pubkey,
    /// Micro-USDC exchanged per lot at exercise. Stored as given; the program never derives it from a multiplier.
    pub strike_usdc_per_lot: u64,
    pub expiry_ts: i64,
    pub total_sold_lots6: u64,
    pub total_exercised_lots6: u64,
    pub unassigned_lots6: u64,
    pub p: [u64; 2],
    pub halted_at: i64,
    /// First observation of the mint unpaused after a halt; settlement waits 24 h from here.
    pub resumed_at: i64,
    pub seq: u64,
    pub epoch: u32,
    pub scale: u8,
    pub state: u8,
    pub side: u8,
    pub bump: u8,
    pub asks_len: u8,
    pub _pad: [u8; 7],
    pub asks: [Ask; MAX_ASKS],
    pub writers: [WriterSlot; MAX_WRITERS],
    pub _reserved: [u8; 64],
}

impl Series {
    pub const SEED: &'static [u8] = b"series";
    pub const CVAULT: &'static [u8] = b"cvault";
    pub const SVAULT: &'static [u8] = b"svault";
    pub const QVAULT: &'static [u8] = b"qvault";
    pub const PMINT: &'static [u8] = b"pmint";
    pub const LEN: usize = 8 + core::mem::size_of::<Series>();

    pub fn side(&self) -> Side {
        Side::from_u8(self.side)
    }
    pub fn side_byte(&self) -> [u8; 1] {
        [self.side]
    }
    pub fn p(&self) -> u128 {
        ((self.p[1] as u128) << 64) | self.p[0] as u128
    }
    pub fn set_p(&mut self, v: u128) {
        self.p = [v as u64, (v >> 64) as u64];
    }
    pub fn is_open(&self) -> bool {
        self.state == SERIES_OPEN
    }
    /// Exercise stays open through a halt that reaches expiry: the deadline is the later of expiry and 24 h after resume.
    pub fn effective_expiry(&self, halt_grace: i64) -> i64 {
        if self.state == SERIES_HALTED {
            let from = if self.resumed_at > 0 { self.resumed_at } else { self.halted_at };
            self.expiry_ts.max(from.saturating_add(halt_grace))
        } else {
            self.expiry_ts
        }
    }

    pub fn writer_slot(&self, writer: &Pubkey) -> Option<usize> {
        self.writers.iter().position(|w| w.writer == *writer)
    }

    /// Lots a writer has resident in the ask list right now, summed from the array (never stored, so it cannot drift).
    pub fn resident_lots6(&self, slot: usize) -> u64 {
        self.asks[..self.asks_len as usize].iter().filter(|a| a.writer_slot as usize == slot).map(|a| a.remaining_lots6).sum()
    }
}

/// Per-holder opt-in for the keeper's auto-exercise crank; the delegate is a program PDA, never the keeper key.
#[account]
#[derive(InitSpace)]
pub struct AutoExercise {
    pub bump: u8,
    pub holder: Pubkey,
    pub series: Pubkey,
    pub enabled: bool,
    pub min_itm_bps: u16,
    pub _reserved: [u8; 16],
}

impl AutoExercise {
    pub const SEED: &'static [u8] = b"autoex";
    pub const AUTHORITY_SEED: &'static [u8] = b"autoex_authority";
}

// ---------------------------------------------------------------------------------------------------------------------
// Part 3: the supply-side vaults. A vault is one more writer in the book, owned by a PDA that a manager acts for.

pub const VAULT_COVERED_CALL: u8 = 0;
pub const VAULT_CASH_SECURED_PUT: u8 = 1;
pub const VAULT_OPEN: u8 = 0;
pub const VAULT_HALTED: u8 = 2;
/// Shares carry six decimals; 1e6 shares are minted per lot of collateral at the first deposit.
pub const SHARE_UNIT: u64 = 1_000_000;
pub const IDX_SCALE: u128 = 1_000_000_000_000;

/// A vault: pooled collateral that quotes into the book through the same `quote` path as any writer. Its collateral
/// asset is the underlying (covered calls) or USDC (cash-secured puts); the other asset arrives through premiums and
/// assignment and is paid out pro rata with every withdrawal. Epochs are weekly: deposits enter and withdrawals leave
/// only at a roll, so nobody dilutes a week of carried risk or runs on collateral that sits behind live contracts.
#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub bump: u8,
    pub kind: u8,
    pub state: u8,
    pub market: Pubkey,
    pub collateral_mint: Pubkey,
    pub other_mint: Pubkey,
    pub manager: Pubkey,
    pub share_mint: Pubkey,
    pub collateral_ata: Pubkey,
    pub other_ata: Pubkey,
    pub epoch: u32,
    pub epoch_start_ts: i64,
    pub next_roll_ts: i64,
    pub roll_interval_secs: i64,
    pub total_shares: u64,
    /// Collateral (raw units) the vault has deposited into series slots and not yet withdrawn or settled back.
    pub locked_raw: u64,
    /// Collateral (raw units) queued by depositors for the next roll, already in `collateral_ata`.
    pub pending_deposit_raw: u64,
    /// Shares queued for withdrawal at the next roll, held in the vault's own share account.
    pub pending_withdraw_shares: u64,
    /// Collateral and other-asset units set aside at rolls for withdrawals not yet completed.
    pub reserved_collateral_raw: u64,
    pub reserved_other: u64,
    pub cap_per_series_lots6: u64,
    pub cap_total_lots6: u64,
    pub spread_bps: u16,
    /// The mark the last roll valued the other asset at, micro-USDC per lot; the next roll must stay within `mark_band_bps` of it.
    pub last_mark_usdc_per_lot: u64,
    pub mark_band_bps: u16,
    /// This epoch so far, reset at each roll: premiums received, paid on buybacks, lots assigned.
    pub epoch_premium_in: u64,
    pub epoch_buyback_out: u64,
    pub epoch_assigned_lots6: u64,
    /// Published at the last roll: collateral per share and the epoch's P&L per share, both in raw collateral units × 1e6.
    pub nav_per_share_1e6: u64,
    pub epoch_pnl_per_share_1e6: i64,
    pub _reserved: [u8; 64],
}

impl Vault {
    pub const SEED: &'static [u8] = b"vault";
    pub const SHARE_MINT: &'static [u8] = b"vshares";
    pub fn is_covered_call(&self) -> bool {
        self.kind == VAULT_COVERED_CALL
    }
    pub fn side(&self) -> Side {
        if self.is_covered_call() { Side::Call } else { Side::Put }
    }
    pub fn kind_byte(&self) -> [u8; 1] {
        [self.kind]
    }
}

/// What one depositor has queued. Live shares are the depositor's share-token balance, never stored here.
#[account]
#[derive(InitSpace)]
pub struct VaultPosition {
    pub bump: u8,
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub queued_deposit_raw: u64,
    pub queued_deposit_epoch: u32,
    pub queued_withdraw_shares: u64,
    pub queued_withdraw_epoch: u32,
    pub _reserved: [u8; 32],
}

impl VaultPosition {
    pub const SEED: &'static [u8] = b"vpos";
}

/// The record of one roll: what a share was worth going in and coming out, so a queued deposit or withdrawal from that
/// epoch settles at exactly that price whenever its owner claims it. One small account per roll, rent reclaimable.
#[account]
#[derive(InitSpace)]
pub struct EpochRecord {
    pub bump: u8,
    pub vault: Pubkey,
    pub epoch: u32,
    pub rolled_at: i64,
    /// Shares minted per raw unit of collateral queued for this epoch, × IDX_SCALE.
    pub shares_per_raw_1e12: u128,
    /// Raw collateral and other-asset units paid per share withdrawn at this roll, × IDX_SCALE.
    pub collateral_per_share_1e12: u128,
    pub other_per_share_1e12: u128,
    pub nav_collateral_raw: u64,
    pub nav_other: u64,
    pub mark_usdc_per_lot: u64,
    pub total_shares_after: u64,
    pub premium_in: u64,
    pub buyback_out: u64,
    pub assigned_lots6: u64,
    pub pnl_per_share_1e6: i64,
}

impl EpochRecord {
    pub const SEED: &'static [u8] = b"vepoch";
}

/// The vault's standing bid on one series: what it pays a holder to take its own short back.
#[account]
#[derive(InitSpace)]
pub struct VaultBid {
    pub bump: u8,
    pub vault: Pubkey,
    pub series: Pubkey,
    pub bid_per_lot: u64,
    pub max_lots6: u64,
    pub posted_at: i64,
    pub expires_at: i64,
}

impl VaultBid {
    pub const SEED: &'static [u8] = b"vbid";
}
