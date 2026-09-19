use anchor_lang::prelude::*;

use crate::state::Side;

#[event]
pub struct MarketCreated { pub market: Pubkey, pub mint: Pubkey, pub tier: u8 }
#[event]
pub struct MarketUpdated { pub market: Pubkey, pub paused: bool, pub listed: bool }
#[event]
pub struct SeriesCreated { pub series: Pubkey, pub market: Pubkey, pub side: Side, pub strike_usdc_per_lot: u64, pub expiry_ts: i64, pub position_mint: Pubkey }
#[event]
pub struct AskPosted { pub series: Pubkey, pub writer: Pubkey, pub lots6: u64, pub ask_per_lot: u64, pub seq: u64, pub evicted_seq: u64 }
#[event]
pub struct AskCancelled { pub series: Pubkey, pub writer: Pubkey, pub seq: u64 }
#[event]
pub struct Fill { pub series: Pubkey, pub buyer: Pubkey, pub writer: Pubkey, pub lots6: u64, pub ask_per_lot: u64, pub premium: u64, pub seq: u64 }
#[event]
pub struct Bought { pub series: Pubkey, pub buyer: Pubkey, pub lots6_filled: u64, pub lots6_requested: u64, pub premium_paid: u64, pub fee: u64, pub asks_walked: u8 }
#[event]
pub struct Exercised { pub series: Pubkey, pub holder: Pubkey, pub lots6: u64, pub usdc: u64, pub raw: u64, pub auto: bool }
#[event]
pub struct WriterSettled { pub series: Pubkey, pub writer: Pubkey, pub free_lots6: u64, pub unassigned_lots6: u64, pub assigned_lots6: u64, pub collateral_out: u64, pub settlement_out: u64, pub premium_out: u64 }
#[event]
pub struct CollateralWithdrawn { pub series: Pubkey, pub writer: Pubkey, pub lots6: u64 }
#[event]
pub struct PremiumClaimed { pub series: Pubkey, pub writer: Pubkey, pub amount: u64 }
#[event]
pub struct SeriesClosed { pub series: Pubkey, pub dust_collateral: u64, pub dust_settlement: u64, pub mint_closed: bool }
#[event]
pub struct FeesWithdrawn { pub amount: u64, pub to: Pubkey }
#[event]
pub struct PauseToggled { pub market: Option<Pubkey>, pub paused: bool }

// Part 3: the vaults.
#[event]
pub struct VaultCreated { pub vault: Pubkey, pub market: Pubkey, pub kind: u8, pub share_mint: Pubkey, pub manager: Pubkey }
#[event]
pub struct VaultDeposited { pub vault: Pubkey, pub owner: Pubkey, pub raw: u64, pub epoch: u32 }
#[event]
pub struct VaultWithdrawRequested { pub vault: Pubkey, pub owner: Pubkey, pub shares: u64, pub epoch: u32 }
#[event]
pub struct VaultRolled { pub vault: Pubkey, pub epoch: u32, pub nav_collateral_raw: u64, pub nav_other: u64, pub mark_usdc_per_lot: u64, pub shares_minted: u64, pub shares_burned: u64, pub total_shares: u64, pub premium_in: u64, pub buyback_out: u64, pub assigned_lots6: u64, pub pnl_per_share_1e6: i64 }
#[event]
pub struct VaultClaimed { pub vault: Pubkey, pub owner: Pubkey, pub epoch: u32, pub shares: u64, pub collateral_raw: u64, pub other: u64 }
#[event]
pub struct VaultQuoted { pub vault: Pubkey, pub series: Pubkey, pub deposit_lots6: u64, pub ask_lots6: u64, pub ask_per_lot: u64, pub seq: u64 }
#[event]
pub struct VaultSettled { pub vault: Pubkey, pub series: Pubkey, pub collateral_out: u64, pub settlement_out: u64, pub premium_out: u64, pub assigned_lots6: u64 }
#[event]
pub struct BidPosted { pub vault: Pubkey, pub series: Pubkey, pub bid_per_lot: u64, pub max_lots6: u64, pub expires_at: i64 }
#[event]
pub struct BoughtBack { pub vault: Pubkey, pub series: Pubkey, pub holder: Pubkey, pub lots6: u64, pub requested_lots6: u64, pub premium: u64 }
#[event]
pub struct VaultHaltToggled { pub vault: Pubkey, pub halted: bool, pub reason: u8 }
