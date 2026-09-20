//! Part 3: the supply-side vaults. A vault is a PDA that holds pooled collateral and acts as one more writer in the
//! book: it deposits into a series vault, posts asks through `book::post_ask`, is evicted by the same rule, and settles
//! through the same `settle_core` as any person. A manager (the quoter's key) signs for it; depositors hold Token-2022
//! shares and move in and out only at weekly rolls. `sell_to_vault` is the bid side: a holder sells position tokens
//! back to the vault, which shrinks its own short and pays from its premium account.

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::Token2022,
    token_interface::{self, Burn, Mint, MintTo, TokenAccount, TokenInterface},
};

use crate::{
    error::RosterError,
    events::{BidPosted, BoughtBack, VaultClaimed, VaultCreated, VaultDeposited, VaultHaltToggled, VaultQuoted, VaultRolled, VaultSettled, VaultWithdrawRequested},
    instructions::{
        book,
        settle::{settle_core, SettleAccounts},
        shared::{transfer_signed, vault_in, vault_in_signed, vault_out, SeriesSeeds},
    },
    math::{fold, free_lots6, raw_for_lots6, usdc_owed_ceil, usdc_paid_floor},
    state::{EpochRecord, MarketConfig, Protocol, Series, Side, Vault, VaultBid, VaultPosition, IDX_SCALE, SHARE_UNIT, VAULT_CASH_SECURED_PUT, VAULT_COVERED_CALL, VAULT_HALTED, VAULT_OPEN},
};

/// The seeds that let the vault PDA sign for its own token accounts.
pub struct VaultSeeds {
    market: Pubkey,
    kind: [u8; 1],
    bump: [u8; 1],
}
impl VaultSeeds {
    pub fn of(v: &Vault) -> Self {
        Self { market: v.market, kind: v.kind_byte(), bump: [v.bump] }
    }
    pub fn seeds(&self) -> [&[u8]; 4] {
        [Vault::SEED, self.market.as_ref(), &self.kind, &self.bump]
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct VaultParams {
    pub kind: u8,
    pub manager: Pubkey,
    pub roll_interval_secs: i64,
    pub first_roll_ts: i64,
    pub cap_per_series_lots6: u64,
    pub cap_total_lots6: u64,
    pub spread_bps: u16,
    pub mark_band_bps: u16,
}

// --------------------------------------------------------------------------------------------------------------------
// init_vault

#[derive(Accounts)]
#[instruction(params: VaultParams)]
pub struct InitVault<'info> {
    #[account(mut, address = protocol.authority @ RosterError::Unauthorized)]
    pub authority: Signer<'info>,
    #[account(seeds = [Protocol::SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    #[account(seeds = [MarketConfig::SEED, market.mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, MarketConfig>,
    #[account(init, payer = authority, space = 8 + Vault::INIT_SPACE, seeds = [Vault::SEED, market.key().as_ref(), &[params.kind]], bump)]
    pub vault: Account<'info, Vault>,
    /// The vault's collateral: the underlying for covered calls, USDC for cash-secured puts. Checked in the handler.
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    pub other_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(init, payer = authority, seeds = [Vault::SHARE_MINT, vault.key().as_ref()], bump, mint::decimals = 6, mint::authority = vault, mint::token_program = token_2022_program)]
    pub share_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(init, payer = authority, associated_token::mint = collateral_mint, associated_token::authority = vault, associated_token::token_program = collateral_token_program)]
    pub collateral_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(init, payer = authority, associated_token::mint = other_mint, associated_token::authority = vault, associated_token::token_program = other_token_program)]
    pub other_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Queued withdrawals park their shares here until the roll burns them.
    #[account(init, payer = authority, associated_token::mint = share_mint, associated_token::authority = vault, associated_token::token_program = token_2022_program)]
    pub share_escrow: Box<InterfaceAccount<'info, TokenAccount>>,
    pub collateral_token_program: Interface<'info, TokenInterface>,
    pub other_token_program: Interface<'info, TokenInterface>,
    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_init_vault(ctx: Context<InitVault>, params: VaultParams) -> Result<()> {
    require!(params.kind == VAULT_COVERED_CALL || params.kind == VAULT_CASH_SECURED_PUT, RosterError::WrongAccount);
    require!(params.roll_interval_secs >= 3600 && params.spread_bps <= 10_000 && params.mark_band_bps <= 10_000, RosterError::SizeOutOfRange);
    let m = &ctx.accounts.market;
    let (want_collateral, want_other) = if params.kind == VAULT_COVERED_CALL { (m.mint, m.quote_mint) } else { (m.quote_mint, m.mint) };
    require!(ctx.accounts.collateral_mint.key() == want_collateral, RosterError::WrongVaultMint);
    require!(ctx.accounts.other_mint.key() == want_other, RosterError::WrongVaultMint);
    let clock = Clock::get()?;
    let v = &mut ctx.accounts.vault;
    v.bump = ctx.bumps.vault;
    v.kind = params.kind;
    v.state = VAULT_OPEN;
    v.market = m.key();
    v.collateral_mint = want_collateral;
    v.other_mint = want_other;
    v.manager = params.manager;
    v.share_mint = ctx.accounts.share_mint.key();
    v.collateral_ata = ctx.accounts.collateral_ata.key();
    v.other_ata = ctx.accounts.other_ata.key();
    v.epoch = 0;
    v.epoch_start_ts = clock.unix_timestamp;
    v.next_roll_ts = params.first_roll_ts.max(clock.unix_timestamp + 60);
    v.roll_interval_secs = params.roll_interval_secs;
    v.cap_per_series_lots6 = params.cap_per_series_lots6;
    v.cap_total_lots6 = params.cap_total_lots6;
    v.spread_bps = params.spread_bps;
    v.mark_band_bps = params.mark_band_bps;
    emit!(VaultCreated { vault: v.key(), market: m.key(), kind: params.kind, share_mint: v.share_mint, manager: v.manager });
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct VaultUpdate {
    pub manager: Option<Pubkey>,
    pub cap_per_series_lots6: Option<u64>,
    pub cap_total_lots6: Option<u64>,
    pub spread_bps: Option<u16>,
    pub mark_band_bps: Option<u16>,
    pub roll_interval_secs: Option<i64>,
    /// Bring the next roll forward or push it back. Never earlier than now; the roll itself still needs `locked_raw` to be zero.
    pub next_roll_ts: Option<i64>,
}

#[derive(Accounts)]
pub struct SetVaultParams<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [Protocol::SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    #[account(mut)]
    pub vault: Account<'info, Vault>,
}

/// The protocol authority or the vault's manager adjusts its parameters. Caps only ever bound new writing.
pub fn handle_set_vault_params(ctx: Context<SetVaultParams>, u: VaultUpdate) -> Result<()> {
    let signer = ctx.accounts.authority.key();
    let v = &mut ctx.accounts.vault;
    require!(signer == ctx.accounts.protocol.authority || signer == v.manager, RosterError::Unauthorized);
    let clock = Clock::get()?;
    if let Some(m) = u.manager { require!(signer == ctx.accounts.protocol.authority, RosterError::Unauthorized); v.manager = m; }
    if let Some(c) = u.cap_per_series_lots6 { v.cap_per_series_lots6 = c; }
    if let Some(c) = u.cap_total_lots6 { v.cap_total_lots6 = c; }
    if let Some(b) = u.spread_bps { require!(b <= 10_000, RosterError::SizeOutOfRange); v.spread_bps = b; }
    if let Some(b) = u.mark_band_bps { require!(b <= 10_000, RosterError::SizeOutOfRange); v.mark_band_bps = b; }
    if let Some(i) = u.roll_interval_secs { require!(i >= 3600, RosterError::SizeOutOfRange); v.roll_interval_secs = i; }
    if let Some(t) = u.next_roll_ts { v.next_roll_ts = t.max(clock.unix_timestamp); }
    Ok(())
}

// --------------------------------------------------------------------------------------------------------------------
// Depositor side: deposit, request withdraw, claim

#[derive(Accounts)]
pub struct VaultDeposit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, has_one = collateral_mint @ RosterError::WrongVaultMint, has_one = collateral_ata @ RosterError::WrongAccount)]
    pub vault: Account<'info, Vault>,
    #[account(init_if_needed, payer = owner, space = 8 + VaultPosition::INIT_SPACE, seeds = [VaultPosition::SEED, vault.key().as_ref(), owner.key().as_ref()], bump)]
    pub position: Account<'info, VaultPosition>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub collateral_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = collateral_mint, token::authority = owner, token::token_program = collateral_token_program)]
    pub owner_collateral_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub collateral_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Queue collateral for the next roll. It sits in the vault's account, earns nothing yet, and can be cancelled until
/// the roll; shares are minted at the roll's price so a late deposit never dilutes the week that carried the risk.
pub fn handle_vault_deposit(ctx: Context<VaultDeposit>, raw: u64) -> Result<()> {
    require!(raw > 0, RosterError::SizeOutOfRange);
    let v = &mut ctx.accounts.vault;
    require!(v.state != VAULT_HALTED, RosterError::VaultHalted);
    let p = &mut ctx.accounts.position;
    if p.bump == 0 {
        p.bump = ctx.bumps.position;
        p.vault = v.key();
        p.owner = ctx.accounts.owner.key();
    }
    // One queued deposit at a time: an older one that has rolled must be claimed first, so nothing is ever merged
    // across two prices.
    require!(p.queued_deposit_raw == 0 || p.queued_deposit_epoch == v.epoch, RosterError::EpochNotRolled);
    let arrived = vault_in(&ctx.accounts.collateral_token_program, &ctx.accounts.owner_collateral_ata, &ctx.accounts.collateral_mint, &mut ctx.accounts.collateral_ata, &ctx.accounts.owner, raw)?;
    p.queued_deposit_raw = p.queued_deposit_raw.checked_add(arrived).ok_or(RosterError::Overflow)?;
    p.queued_deposit_epoch = v.epoch;
    v.pending_deposit_raw = v.pending_deposit_raw.checked_add(arrived).ok_or(RosterError::Overflow)?;
    emit!(VaultDeposited { vault: v.key(), owner: p.owner, raw: arrived, epoch: v.epoch });
    Ok(())
}

#[derive(Accounts)]
pub struct VaultWithdrawRequest<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, has_one = share_mint @ RosterError::WrongAccount)]
    pub vault: Account<'info, Vault>,
    #[account(init_if_needed, payer = owner, space = 8 + VaultPosition::INIT_SPACE, seeds = [VaultPosition::SEED, vault.key().as_ref(), owner.key().as_ref()], bump)]
    pub position: Account<'info, VaultPosition>,
    #[account(mut)]
    pub share_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = share_mint, token::authority = owner, token::token_program = token_2022_program)]
    pub owner_share_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, associated_token::mint = share_mint, associated_token::authority = vault, associated_token::token_program = token_2022_program)]
    pub share_escrow: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

/// Queue shares for withdrawal at the next roll. The shares move into the vault's escrow now, so they cannot be
/// transferred while queued, and are burned at the roll against the price it publishes.
pub fn handle_vault_request_withdraw(ctx: Context<VaultWithdrawRequest>, shares: u64) -> Result<()> {
    require!(shares > 0, RosterError::SizeOutOfRange);
    let v = &mut ctx.accounts.vault;
    let p = &mut ctx.accounts.position;
    if p.bump == 0 {
        p.bump = ctx.bumps.position;
        p.vault = v.key();
        p.owner = ctx.accounts.owner.key();
    }
    require!(p.queued_withdraw_shares == 0 || p.queued_withdraw_epoch == v.epoch, RosterError::EpochNotRolled);
    token_interface::transfer_checked(
        CpiContext::new(ctx.accounts.token_2022_program.key(),
            token_interface::TransferChecked { from: ctx.accounts.owner_share_ata.to_account_info(), mint: ctx.accounts.share_mint.to_account_info(), to: ctx.accounts.share_escrow.to_account_info(), authority: ctx.accounts.owner.to_account_info() },
        ),
        shares,
        6,
    )?;
    p.queued_withdraw_shares = p.queued_withdraw_shares.checked_add(shares).ok_or(RosterError::Overflow)?;
    p.queued_withdraw_epoch = v.epoch;
    v.pending_withdraw_shares = v.pending_withdraw_shares.checked_add(shares).ok_or(RosterError::Overflow)?;
    emit!(VaultWithdrawRequested { vault: v.key(), owner: p.owner, shares, epoch: v.epoch });
    Ok(())
}

#[derive(Accounts)]
#[instruction(epoch: u32)]
pub struct VaultClaim<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, has_one = share_mint @ RosterError::WrongAccount, has_one = collateral_mint @ RosterError::WrongVaultMint, has_one = other_mint @ RosterError::WrongVaultMint, has_one = collateral_ata @ RosterError::WrongAccount, has_one = other_ata @ RosterError::WrongAccount)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [VaultPosition::SEED, vault.key().as_ref(), owner.key().as_ref()], bump = position.bump)]
    pub position: Account<'info, VaultPosition>,
    #[account(seeds = [EpochRecord::SEED, vault.key().as_ref(), &epoch.to_le_bytes()], bump = record.bump)]
    pub record: Account<'info, EpochRecord>,
    pub share_mint: Box<InterfaceAccount<'info, Mint>>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    pub other_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub collateral_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub other_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, associated_token::mint = share_mint, associated_token::authority = vault, associated_token::token_program = token_2022_program)]
    pub share_escrow: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(init_if_needed, payer = owner, associated_token::mint = share_mint, associated_token::authority = owner, associated_token::token_program = token_2022_program)]
    pub owner_share_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(init_if_needed, payer = owner, associated_token::mint = collateral_mint, associated_token::authority = owner, associated_token::token_program = collateral_token_program)]
    pub owner_collateral_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(init_if_needed, payer = owner, associated_token::mint = other_mint, associated_token::authority = owner, associated_token::token_program = other_token_program)]
    pub owner_other_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub collateral_token_program: Interface<'info, TokenInterface>,
    pub other_token_program: Interface<'info, TokenInterface>,
    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Collect what a roll owes this depositor: shares for a deposit queued in that epoch, and collateral plus the other
/// asset for shares withdrawn in it, at exactly the prices the record holds.
pub fn handle_vault_claim(ctx: Context<VaultClaim>, epoch: u32) -> Result<()> {
    let v = &mut ctx.accounts.vault;
    let p = &mut ctx.accounts.position;
    let r = &ctx.accounts.record;
    require!(r.epoch == epoch && epoch < v.epoch, RosterError::EpochNotRolled);
    let seeds = VaultSeeds::of(v);
    let sd = seeds.seeds();
    let signer: &[&[&[u8]]] = &[&sd];
    let vault_info = v.to_account_info();
    let mut shares_out = 0u64;
    let mut collateral_out = 0u64;
    let mut other_out = 0u64;

    if p.queued_deposit_raw > 0 && p.queued_deposit_epoch == epoch {
        shares_out = u64::try_from((p.queued_deposit_raw as u128).saturating_mul(r.shares_per_raw_1e12) / IDX_SCALE).map_err(|_| RosterError::Overflow)?;
        transfer_signed(&ctx.accounts.token_2022_program.to_account_info(), &ctx.accounts.share_escrow, &ctx.accounts.share_mint, &ctx.accounts.owner_share_ata, &vault_info, signer, shares_out)?;
        p.queued_deposit_raw = 0;
    }
    if p.queued_withdraw_shares > 0 && p.queued_withdraw_epoch == epoch {
        let s = p.queued_withdraw_shares as u128;
        // Rounded down: what a withdrawer is paid never exceeds the share the roll set aside (Part 2 addendum E).
        collateral_out = u64::try_from(s.saturating_mul(r.collateral_per_share_1e12) / IDX_SCALE).map_err(|_| RosterError::Overflow)?.min(v.reserved_collateral_raw);
        other_out = u64::try_from(s.saturating_mul(r.other_per_share_1e12) / IDX_SCALE).map_err(|_| RosterError::Overflow)?.min(v.reserved_other);
        transfer_signed(&ctx.accounts.collateral_token_program.to_account_info(), &ctx.accounts.collateral_ata, &ctx.accounts.collateral_mint, &ctx.accounts.owner_collateral_ata, &vault_info, signer, collateral_out)?;
        transfer_signed(&ctx.accounts.other_token_program.to_account_info(), &ctx.accounts.other_ata, &ctx.accounts.other_mint, &ctx.accounts.owner_other_ata, &vault_info, signer, other_out)?;
        v.reserved_collateral_raw -= collateral_out;
        v.reserved_other -= other_out;
        p.queued_withdraw_shares = 0;
    }
    require!(shares_out > 0 || collateral_out > 0 || other_out > 0, RosterError::NothingQueued);
    emit!(VaultClaimed { vault: v.key(), owner: p.owner, epoch, shares: shares_out, collateral_raw: collateral_out, other: other_out });
    Ok(())
}

// --------------------------------------------------------------------------------------------------------------------
// The roll

#[derive(Accounts)]
pub struct VaultRoll<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,
    #[account(seeds = [MarketConfig::SEED, market.mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, MarketConfig>,
    #[account(mut, has_one = market @ RosterError::WrongAccount, has_one = share_mint @ RosterError::WrongAccount, has_one = collateral_ata @ RosterError::WrongAccount, has_one = other_ata @ RosterError::WrongAccount)]
    pub vault: Account<'info, Vault>,
    #[account(init, payer = cranker, space = 8 + EpochRecord::INIT_SPACE, seeds = [EpochRecord::SEED, vault.key().as_ref(), &vault.epoch.to_le_bytes()], bump)]
    pub record: Account<'info, EpochRecord>,
    #[account(mut)]
    pub share_mint: Box<InterfaceAccount<'info, Mint>>,
    pub collateral_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub other_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, associated_token::mint = share_mint, associated_token::authority = vault, associated_token::token_program = token_2022_program)]
    pub share_escrow: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

/// Close the epoch. Permissionless once the roll time has passed and every series the vault wrote has settled back
/// (`locked_raw` is zero). Values the vault, publishes the price, burns queued withdrawals and mints queued deposits,
/// and starts the next epoch. `mark_usdc_per_lot` values the other asset for minting only: it decides how many shares
/// a new deposit gets against the USDC or tokens the vault already holds, never what a withdrawer is paid, and must
/// stay within the band around the mark of the previous roll.
pub fn handle_vault_roll(ctx: Context<VaultRoll>, mark_usdc_per_lot: u64) -> Result<()> {
    let clock = Clock::get()?;
    let v = &mut ctx.accounts.vault;
    require!(clock.unix_timestamp >= v.next_roll_ts, RosterError::RollNotDue);
    require!(v.locked_raw == 0, RosterError::UnsettledCollateral);
    require!(mark_usdc_per_lot > 0, RosterError::SizeOutOfRange);
    if v.last_mark_usdc_per_lot > 0 && v.mark_band_bps < 10_000 {
        let last = v.last_mark_usdc_per_lot as u128;
        let band = last * v.mark_band_bps as u128 / 10_000;
        require!((mark_usdc_per_lot as u128) >= last.saturating_sub(band) && (mark_usdc_per_lot as u128) <= last + band, RosterError::MarkOutOfBand);
    }
    let raw_per_lot6 = ctx.accounts.market.raw_per_lot6() as u128;
    // One lot is LOT6 lot-units: LOT6 × raw_per_lot6 raw units of the underlying, and the mark is micro-USDC per lot.
    let raw_per_lot: u128 = (crate::state::LOT6 as u128).saturating_mul(raw_per_lot6);

    // What the vault holds that belongs to its shares: everything in its accounts less what is already reserved for
    // earlier withdrawals and less deposits still queued (they are not shares yet).
    let collateral_free = (ctx.accounts.collateral_ata.amount as u128).saturating_sub(v.reserved_collateral_raw as u128).saturating_sub(v.pending_deposit_raw as u128);
    let other_free = (ctx.accounts.other_ata.amount as u128).saturating_sub(v.reserved_other as u128);
    // The other asset in collateral units, for minting. Covered call: USDC to raw at the mark. Cash-secured put: raw to USDC at the mark.
    let other_in_collateral: u128 = if v.is_covered_call() {
        other_free.saturating_mul(raw_per_lot) / (mark_usdc_per_lot as u128).max(1)
    } else {
        other_free.saturating_mul(mark_usdc_per_lot as u128) / raw_per_lot.max(1)
    };
    let nav = collateral_free.saturating_add(other_in_collateral);
    let total = v.total_shares as u128;

    // Withdrawals first, at this epoch's price, before new money enters.
    let w = v.pending_withdraw_shares as u128;
    let (collateral_per_share, other_per_share) = if total > 0 {
        (collateral_free.saturating_mul(IDX_SCALE) / total, other_free.saturating_mul(IDX_SCALE) / total)
    } else {
        (0, 0)
    };
    let reserve_collateral = u64::try_from(w.saturating_mul(collateral_per_share) / IDX_SCALE).map_err(|_| RosterError::Overflow)?;
    let reserve_other = u64::try_from(w.saturating_mul(other_per_share) / IDX_SCALE).map_err(|_| RosterError::Overflow)?;
    let shares_burned = v.pending_withdraw_shares;
    if shares_burned > 0 {
        let seeds = VaultSeeds::of(v);
        let sd = seeds.seeds();
        token_interface::burn(
            CpiContext::new_with_signer(ctx.accounts.token_2022_program.key(),
                Burn { mint: ctx.accounts.share_mint.to_account_info(), from: ctx.accounts.share_escrow.to_account_info(), authority: v.to_account_info() },
                &[&sd],
            ),
            shares_burned,
        )?;
    }
    let total_after_burn = total - w;
    let nav_after_burn = nav.saturating_sub(reserve_collateral as u128).saturating_sub(if v.is_covered_call() { (reserve_other as u128).saturating_mul(raw_per_lot) / (mark_usdc_per_lot as u128).max(1) } else { (reserve_other as u128).saturating_mul(mark_usdc_per_lot as u128) / raw_per_lot.max(1) });

    // Deposits enter at the post-withdrawal price. The first depositor sets the unit: 1e6 shares per lot of
    // collateral, a lot being one token (LOT6 × raw_per_lot6 raw units) or one USDC (LOT6 micro-USDC).
    let unit_raw: u128 = if v.is_covered_call() { raw_per_lot } else { crate::state::LOT6 as u128 };
    let shares_per_raw = if total_after_burn == 0 || nav_after_burn == 0 {
        (SHARE_UNIT as u128).saturating_mul(IDX_SCALE) / unit_raw.max(1)
    } else {
        total_after_burn.saturating_mul(IDX_SCALE) / nav_after_burn
    };
    let shares_minted = u64::try_from((v.pending_deposit_raw as u128).saturating_mul(shares_per_raw) / IDX_SCALE).map_err(|_| RosterError::Overflow)?;
    if shares_minted > 0 {
        let seeds = VaultSeeds::of(v);
        let sd = seeds.seeds();
        token_interface::mint_to(
            CpiContext::new_with_signer(ctx.accounts.token_2022_program.key(),
                MintTo { mint: ctx.accounts.share_mint.to_account_info(), to: ctx.accounts.share_escrow.to_account_info(), authority: v.to_account_info() },
                &[&sd],
            ),
            shares_minted,
        )?;
    }

    // The epoch's result per share, in collateral units: what a share is worth now against what it was worth at the
    // last roll. Negative weeks are published like any other.
    let nav_per_share_now = if total > 0 { u64::try_from(nav.saturating_mul(SHARE_UNIT as u128) / total).unwrap_or(u64::MAX) } else { 0 };
    let pnl_per_share = if v.nav_per_share_1e6 > 0 && total > 0 { nav_per_share_now as i64 - v.nav_per_share_1e6 as i64 } else { 0 };

    let r = &mut ctx.accounts.record;
    r.bump = ctx.bumps.record;
    r.vault = v.key();
    r.epoch = v.epoch;
    r.rolled_at = clock.unix_timestamp;
    r.shares_per_raw_1e12 = shares_per_raw;
    r.collateral_per_share_1e12 = collateral_per_share;
    r.other_per_share_1e12 = other_per_share;
    r.nav_collateral_raw = u64::try_from(collateral_free).unwrap_or(u64::MAX);
    r.nav_other = u64::try_from(other_free).unwrap_or(u64::MAX);
    r.mark_usdc_per_lot = mark_usdc_per_lot;
    r.premium_in = v.epoch_premium_in;
    r.buyback_out = v.epoch_buyback_out;
    r.assigned_lots6 = v.epoch_assigned_lots6;
    r.pnl_per_share_1e6 = pnl_per_share;

    v.reserved_collateral_raw = v.reserved_collateral_raw.checked_add(reserve_collateral).ok_or(RosterError::Overflow)?;
    v.reserved_other = v.reserved_other.checked_add(reserve_other).ok_or(RosterError::Overflow)?;
    v.total_shares = u64::try_from(total_after_burn).map_err(|_| RosterError::Overflow)?.checked_add(shares_minted).ok_or(RosterError::Overflow)?;
    r.total_shares_after = v.total_shares;
    v.pending_withdraw_shares = 0;
    v.pending_deposit_raw = 0;
    v.last_mark_usdc_per_lot = mark_usdc_per_lot;
    // The published price after the roll: what one share is worth going into the new epoch.
    v.nav_per_share_1e6 = if v.total_shares > 0 { u64::try_from(nav_after_burn.saturating_add(shares_minted as u128 * IDX_SCALE / shares_per_raw.max(1)).saturating_mul(SHARE_UNIT as u128) / v.total_shares as u128).unwrap_or(u64::MAX) } else { 0 };
    v.epoch_pnl_per_share_1e6 = pnl_per_share;
    v.epoch_premium_in = 0;
    v.epoch_buyback_out = 0;
    v.epoch_assigned_lots6 = 0;
    let epoch = v.epoch;
    v.epoch = v.epoch.checked_add(1).ok_or(RosterError::Overflow)?;
    v.epoch_start_ts = clock.unix_timestamp;
    v.next_roll_ts = v.next_roll_ts.checked_add(v.roll_interval_secs).ok_or(RosterError::Overflow)?;
    while v.next_roll_ts <= clock.unix_timestamp {
        v.next_roll_ts += v.roll_interval_secs;
    }
    emit!(VaultRolled { vault: v.key(), epoch, nav_collateral_raw: r.nav_collateral_raw, nav_other: r.nav_other, mark_usdc_per_lot, shares_minted, shares_burned, total_shares: v.total_shares, premium_in: r.premium_in, buyback_out: r.buyback_out, assigned_lots6: r.assigned_lots6, pnl_per_share_1e6: pnl_per_share });
    Ok(())
}

// --------------------------------------------------------------------------------------------------------------------
// The manager writes for the vault: the same book, a PDA as the writer

#[derive(Accounts)]
pub struct VaultWrite<'info> {
    #[account(mut, address = vault.manager @ RosterError::Unauthorized)]
    pub manager: Signer<'info>,
    #[account(seeds = [Protocol::SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    #[account(seeds = [MarketConfig::SEED, market.mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, MarketConfig>,
    #[account(mut, has_one = market @ RosterError::WrongAccount, has_one = collateral_mint @ RosterError::WrongVaultMint, has_one = collateral_ata @ RosterError::WrongAccount)]
    pub vault: Account<'info, Vault>,
    #[account(mut, has_one = market @ RosterError::WrongAccount, has_one = collateral_vault @ RosterError::WrongAccount)]
    pub series: AccountLoader<'info, Series>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub collateral_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub collateral_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub collateral_token_program: Interface<'info, TokenInterface>,
}

fn collateral_amount(series: &Series, market: &MarketConfig, lots6: u64, ceil: bool) -> Result<u64> {
    match series.side() {
        Side::Call => raw_for_lots6(lots6, market.raw_per_lot6()).ok_or(RosterError::Overflow.into()),
        Side::Put => (if ceil { usdc_owed_ceil(lots6, series.strike_usdc_per_lot) } else { usdc_paid_floor(lots6, series.strike_usdc_per_lot) }).ok_or(RosterError::Overflow.into()),
    }
}

/// Deposit vault collateral into a series and post an ask, as any writer does. Refused when the series is the wrong
/// side for this vault, expires after the next roll, or would take the vault past its per-series or total cap.
pub fn handle_vault_quote(ctx: Context<VaultWrite>, deposit_lots6: u64, ask_lots6: u64, ask_per_lot: u64) -> Result<()> {
    let clock = Clock::get()?;
    let market = &ctx.accounts.market;
    require!(market.listed, RosterError::NotListed);
    require!(!market.paused && !ctx.accounts.protocol.paused_all, RosterError::Paused);
    let v = &mut ctx.accounts.vault;
    require!(v.state != VAULT_HALTED, RosterError::VaultHalted);
    let series_key = ctx.accounts.series.key();
    let mut series = ctx.accounts.series.load_mut()?;
    require!(series.side() == v.side(), RosterError::WrongVaultMint);
    require!(ctx.accounts.collateral_mint.key() == book::collateral_mint_for(&series, market), RosterError::WrongVaultMint);
    require!(series.expiry_ts > clock.unix_timestamp, RosterError::Expired);
    require!(series.expiry_ts <= v.next_roll_ts, RosterError::ExpiryPastRoll);
    let halted = crate::instructions::shared::observe_halt(&mut series, &ctx.accounts.collateral_mint.to_account_info(), &ctx.accounts.collateral_vault, clock.unix_timestamp);
    require!(!halted, RosterError::Halted);

    let vault_key = v.key();
    let slot = book::find_or_claim_slot(&mut series, &vault_key)?;
    let held = series.writers[slot].deposited_lots6 - series.writers[slot].withdrawn_lots6;
    require!(held + deposit_lots6 <= v.cap_per_series_lots6, RosterError::VaultCapReached);

    if deposit_lots6 > 0 {
        let amount = collateral_amount(&series, market, deposit_lots6, true)?;
        // Every deposit is bounded by what is not queued and not reserved: that money belongs to someone else already.
        let spendable = ctx.accounts.collateral_ata.amount.saturating_sub(v.reserved_collateral_raw).saturating_sub(v.pending_deposit_raw);
        require!(amount <= spendable, RosterError::InsufficientFreeCollateral);
        let seeds = VaultSeeds::of(v);
        let sd = seeds.seeds();
        let vault_info = v.to_account_info();
        let arrived = vault_in_signed(&ctx.accounts.collateral_token_program.to_account_info(), &ctx.accounts.collateral_ata, &ctx.accounts.collateral_mint, &mut ctx.accounts.collateral_vault, &vault_info, &[&sd], amount)?;
        book::credit_deposit(&mut series, market, slot, arrived, deposit_lots6, amount)?;
        v.locked_raw = v.locked_raw.checked_add(amount).ok_or(RosterError::Overflow)?;
        let total_locked_lots6 = v.locked_raw / if v.is_covered_call() { market.raw_per_lot6() } else { 1 };
        check_total_cap(total_locked_lots6, v.cap_total_lots6)?;
    }
    let seq = book::post_ask(&mut series, series_key, market, slot, ask_lots6, ask_per_lot)?;
    emit!(VaultQuoted { vault: vault_key, series: series_key, deposit_lots6, ask_lots6, ask_per_lot, seq });
    Ok(())
}

/// The total cap is in lots for a covered call and in micro-USDC for a cash-secured put; both are `cap_total_lots6`'s unit.
fn check_total_cap(locked: u64, cap: u64) -> Result<()> {
    require!(cap == 0 || locked <= cap, RosterError::VaultCapReached);
    Ok(())
}

#[derive(Accounts)]
pub struct VaultBook<'info> {
    #[account(address = vault.manager @ RosterError::Unauthorized)]
    pub manager: Signer<'info>,
    #[account(has_one = market @ RosterError::WrongAccount)]
    pub vault: Account<'info, Vault>,
    #[account(seeds = [MarketConfig::SEED, market.mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, MarketConfig>,
    #[account(mut, has_one = market @ RosterError::WrongAccount)]
    pub series: AccountLoader<'info, Series>,
}

pub fn handle_vault_cancel_ask(ctx: Context<VaultBook>, seq: u64) -> Result<()> {
    let series_key = ctx.accounts.series.key();
    let mut series = ctx.accounts.series.load_mut()?;
    book::cancel_ask(&mut series, series_key, &ctx.accounts.vault.key(), seq)
}

/// Pull never-sold collateral back from a series into the vault, as a writer's `withdraw_unsold` does.
pub fn handle_vault_withdraw_unsold(ctx: Context<VaultWrite>, lots6: u64) -> Result<()> {
    let market = &ctx.accounts.market;
    let v = &mut ctx.accounts.vault;
    let series_info = ctx.accounts.series.to_account_info();
    let series = ctx.accounts.series.load()?;
    require!(ctx.accounts.collateral_mint.key() == book::collateral_mint_for(&series, market), RosterError::WrongVaultMint);
    let vault_key = v.key();
    let slot = series.writer_slot(&vault_key).ok_or(RosterError::NoWriterSlot)?;
    require!(lots6 > 0 && free_lots6(&series, slot) >= lots6, RosterError::InsufficientFreeCollateral);
    let amount = collateral_amount(&series, market, lots6, false)?;
    let seeds = SeriesSeeds::of(&series);
    drop(series);
    vault_out(&series_info, &seeds, &ctx.accounts.collateral_token_program, &ctx.accounts.collateral_vault, &ctx.accounts.collateral_mint, &ctx.accounts.collateral_ata, amount)?;
    let mut series = ctx.accounts.series.load_mut()?;
    let w = &mut series.writers[slot];
    w.withdrawn_lots6 = w.withdrawn_lots6.checked_add(lots6).ok_or(RosterError::Overflow)?;
    v.locked_raw = v.locked_raw.saturating_sub(amount);
    Ok(())
}

// --------------------------------------------------------------------------------------------------------------------
// Settlement and premium for the vault: permissionless, the same core as a person's

#[derive(Accounts)]
pub struct VaultSettle<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,
    #[account(seeds = [MarketConfig::SEED, market.mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, MarketConfig>,
    #[account(mut, has_one = market @ RosterError::WrongAccount)]
    pub vault: Account<'info, Vault>,
    #[account(mut, has_one = market @ RosterError::WrongAccount, has_one = collateral_vault @ RosterError::WrongAccount, has_one = settlement_vault @ RosterError::WrongAccount, has_one = quote_vault @ RosterError::WrongAccount)]
    pub series: AccountLoader<'info, Series>,
    #[account(address = market.mint @ RosterError::WrongAccount)]
    pub underlying_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = market.quote_mint @ RosterError::WrongQuoteMint)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub collateral_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub settlement_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub quote_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, associated_token::mint = underlying_mint, associated_token::authority = vault, associated_token::token_program = underlying_token_program)]
    pub vault_underlying_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, associated_token::mint = quote_mint, associated_token::authority = vault, associated_token::token_program = quote_token_program)]
    pub vault_quote_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub underlying_token_program: Interface<'info, TokenInterface>,
    pub quote_token_program: Interface<'info, TokenInterface>,
}

/// Settle the vault's slot in an expired series and account for it: collateral that came back is no longer locked,
/// assigned lots and premium go into this epoch's P&L.
pub fn handle_vault_settle(ctx: Context<VaultSettle>) -> Result<()> {
    let a = &ctx.accounts;
    let vault_key = a.vault.key();
    let before = {
        let s = a.series.load()?;
        let slot = s.writer_slot(&vault_key).ok_or(RosterError::NoWriterSlot)?;
        s.writers[slot].deposited_lots6 - s.writers[slot].withdrawn_lots6
    };
    let out = settle_core(SettleAccounts {
        market: &a.market, series: &a.series, writer: vault_key, underlying_mint: &a.underlying_mint, quote_mint: &a.quote_mint,
        collateral_vault: &a.collateral_vault, settlement_vault: &a.settlement_vault, quote_vault: &a.quote_vault,
        writer_underlying_ata: &a.vault_underlying_ata, writer_quote_ata: &a.vault_quote_ata,
        underlying_token_program: &a.underlying_token_program, quote_token_program: &a.quote_token_program,
    })?;
    let v = &mut ctx.accounts.vault;
    let locked_units = if v.is_covered_call() { raw_for_lots6(before, ctx.accounts.market.raw_per_lot6()).unwrap_or(u64::MAX) } else { usdc_owed_ceil(before, ctx.accounts.series.load()?.strike_usdc_per_lot).unwrap_or(u64::MAX) };
    v.locked_raw = v.locked_raw.saturating_sub(locked_units);
    v.epoch_assigned_lots6 = v.epoch_assigned_lots6.saturating_add(out.assigned_lots6);
    v.epoch_premium_in = v.epoch_premium_in.saturating_add(out.premium_out);
    emit!(VaultSettled { vault: vault_key, series: ctx.accounts.series.key(), collateral_out: out.collateral_out, settlement_out: out.settlement_out, premium_out: out.premium_out, assigned_lots6: out.assigned_lots6 });
    Ok(())
}

#[derive(Accounts)]
pub struct VaultClaimPremium<'info> {
    pub cranker: Signer<'info>,
    #[account(seeds = [MarketConfig::SEED, market.mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, MarketConfig>,
    #[account(mut, has_one = market @ RosterError::WrongAccount)]
    pub vault: Account<'info, Vault>,
    #[account(mut, has_one = market @ RosterError::WrongAccount, has_one = quote_vault @ RosterError::WrongAccount)]
    pub series: AccountLoader<'info, Series>,
    #[account(address = market.quote_mint @ RosterError::WrongQuoteMint)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub quote_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, associated_token::mint = quote_mint, associated_token::authority = vault, associated_token::token_program = quote_token_program)]
    pub vault_quote_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub quote_token_program: Interface<'info, TokenInterface>,
}

/// Move the premium the vault's fills have earned in a series into the vault's USDC account, as a writer's
/// `claim_premium` does. Permissionless: it is also what funds the bid side before the first settlement.
pub fn handle_vault_claim_premium(ctx: Context<VaultClaimPremium>) -> Result<()> {
    let vault_key = ctx.accounts.vault.key();
    let series_key = ctx.accounts.series.key();
    let series_info = ctx.accounts.series.to_account_info();
    let series = ctx.accounts.series.load()?;
    let slot = series.writer_slot(&vault_key).ok_or(RosterError::NoWriterSlot)?;
    let amount = series.writers[slot].premium_claimable;
    let seeds = SeriesSeeds::of(&series);
    drop(series);
    if amount > 0 {
        vault_out(&series_info, &seeds, &ctx.accounts.quote_token_program, &ctx.accounts.quote_vault, &ctx.accounts.quote_mint, &ctx.accounts.vault_quote_ata, amount)?;
        ctx.accounts.series.load_mut()?.writers[slot].premium_claimable = 0;
        let v = &mut ctx.accounts.vault;
        v.epoch_premium_in = v.epoch_premium_in.saturating_add(amount);
    }
    emit!(crate::events::PremiumClaimed { series: series_key, writer: vault_key, amount });
    Ok(())
}

// --------------------------------------------------------------------------------------------------------------------
// The bid side

#[derive(Accounts)]
pub struct VaultPostBid<'info> {
    #[account(mut, address = vault.manager @ RosterError::Unauthorized)]
    pub manager: Signer<'info>,
    #[account(has_one = market @ RosterError::WrongAccount)]
    pub vault: Account<'info, Vault>,
    #[account(seeds = [MarketConfig::SEED, market.mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, MarketConfig>,
    #[account(has_one = market @ RosterError::WrongAccount)]
    pub series: AccountLoader<'info, Series>,
    #[account(init_if_needed, payer = manager, space = 8 + VaultBid::INIT_SPACE, seeds = [VaultBid::SEED, vault.key().as_ref(), series.key().as_ref()], bump)]
    pub bid: Account<'info, VaultBid>,
    pub system_program: Program<'info, System>,
}

/// Post or refresh the vault's standing bid on a series. A bid of zero withdraws it.
pub fn handle_vault_post_bid(ctx: Context<VaultPostBid>, bid_per_lot: u64, max_lots6: u64, ttl_secs: i64) -> Result<()> {
    let clock = Clock::get()?;
    let b = &mut ctx.accounts.bid;
    b.bump = ctx.bumps.bid;
    b.vault = ctx.accounts.vault.key();
    b.series = ctx.accounts.series.key();
    b.bid_per_lot = bid_per_lot;
    b.max_lots6 = max_lots6;
    b.posted_at = clock.unix_timestamp;
    b.expires_at = clock.unix_timestamp.saturating_add(ttl_secs.max(0));
    emit!(BidPosted { vault: b.vault, series: b.series, bid_per_lot, max_lots6, expires_at: b.expires_at });
    Ok(())
}

#[derive(Accounts)]
pub struct SellToVault<'info> {
    #[account(mut)]
    pub holder: Signer<'info>,
    #[account(seeds = [MarketConfig::SEED, market.mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, MarketConfig>,
    #[account(mut, has_one = market @ RosterError::WrongAccount)]
    pub vault: Account<'info, Vault>,
    #[account(mut, has_one = market @ RosterError::WrongAccount, has_one = position_mint @ RosterError::WrongAccount)]
    pub series: AccountLoader<'info, Series>,
    #[account(seeds = [VaultBid::SEED, vault.key().as_ref(), series.key().as_ref()], bump = bid.bump)]
    pub bid: Account<'info, VaultBid>,
    #[account(mut)]
    pub position_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = position_mint, token::authority = holder, token::token_program = token_2022_program)]
    pub holder_position_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = market.quote_mint @ RosterError::WrongQuoteMint)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    /// The vault pays premium from its USDC account: `other_ata` for a covered-call vault, `collateral_ata` for a put vault.
    #[account(mut, associated_token::mint = quote_mint, associated_token::authority = vault, associated_token::token_program = quote_token_program)]
    pub vault_quote_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = quote_mint, token::authority = holder, token::token_program = quote_token_program)]
    pub holder_quote_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub token_2022_program: Program<'info, Token2022>,
}

/// Sell position tokens back to the vault at its posted bid. The vault burns them against its own short: its slot's
/// open and sold lots fall by the fill, the series' unassigned and sold totals fall by the same, and the assignment
/// product does not move, so every other writer's share of what remains is exactly what it was. Fills only up to the
/// vault's own unassigned short and the bid's size; a partial fill is stated.
pub fn handle_sell_to_vault(ctx: Context<SellToVault>, lots6: u64, min_bid_per_lot: u64) -> Result<()> {
    let clock = Clock::get()?;
    let v = &mut ctx.accounts.vault;
    require!(v.state != VAULT_HALTED, RosterError::VaultHalted);
    let b = &ctx.accounts.bid;
    require!(b.bid_per_lot > 0 && b.expires_at > clock.unix_timestamp, RosterError::NoBid);
    require!(b.bid_per_lot >= min_bid_per_lot, RosterError::QuoteMoved);
    require!(lots6 > 0, RosterError::SizeOutOfRange);
    let series_key = ctx.accounts.series.key();
    let vault_key = v.key();
    let mut series = ctx.accounts.series.load_mut()?;
    require!(series.expiry_ts > clock.unix_timestamp, RosterError::Expired);
    let slot = series.writer_slot(&vault_key).ok_or(RosterError::NoWriterSlot)?;
    let mut w = series.writers[slot];
    fold(&series, &mut w);
    let fill = lots6.min(w.open_lots6).min(b.max_lots6);
    require!(fill > 0, RosterError::QuoteMoved);
    require!(ctx.accounts.holder_position_ata.amount >= fill, RosterError::InsufficientPosition);

    // Burn first, as exercise does: the burn is the holder's signature on the trade.
    token_interface::burn(
        CpiContext::new(ctx.accounts.token_2022_program.key(),
            Burn { mint: ctx.accounts.position_mint.to_account_info(), from: ctx.accounts.holder_position_ata.to_account_info(), authority: ctx.accounts.holder.to_account_info() },
        ),
        fill,
    )?;

    w.open_lots6 -= fill;
    w.sold_lots6 = w.sold_lots6.saturating_sub(fill);
    series.writers[slot] = w;
    series.unassigned_lots6 = series.unassigned_lots6.saturating_sub(fill);
    series.total_sold_lots6 = series.total_sold_lots6.saturating_sub(fill);
    drop(series);

    // Paid rounded down, from the vault's premium money, which is never the collateral behind a live contract.
    let premium = u64::try_from((fill as u128) * (b.bid_per_lot as u128) / crate::state::LOT6 as u128).map_err(|_| RosterError::Overflow)?;
    // For a put vault the USDC account is also its collateral account, so reserves and queued deposits are off limits.
    let spendable = if v.is_covered_call() { ctx.accounts.vault_quote_ata.amount.saturating_sub(v.reserved_other) } else { ctx.accounts.vault_quote_ata.amount.saturating_sub(v.reserved_collateral_raw).saturating_sub(v.pending_deposit_raw) };
    require!(premium <= spendable, RosterError::InsufficientFreeCollateral);
    let seeds = VaultSeeds::of(v);
    let sd = seeds.seeds();
    let vault_info = v.to_account_info();
    transfer_signed(&ctx.accounts.quote_token_program.to_account_info(), &ctx.accounts.vault_quote_ata, &ctx.accounts.quote_mint, &ctx.accounts.holder_quote_ata, &vault_info, &[&sd], premium)?;
    v.epoch_buyback_out = v.epoch_buyback_out.saturating_add(premium);
    emit!(BoughtBack { vault: vault_key, series: series_key, holder: ctx.accounts.holder.key(), lots6: fill, requested_lots6: lots6, premium });
    Ok(())
}

// --------------------------------------------------------------------------------------------------------------------
// Halt

#[derive(Accounts)]
pub struct VaultHalt<'info> {
    pub signer: Signer<'info>,
    #[account(seeds = [Protocol::SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    #[account(mut)]
    pub vault: Account<'info, Vault>,
}

/// A breaker or the pause authority stops the vault quoting; the authority can also lift it. A halted vault still
/// settles, still rolls and still honours withdrawals: the book and every exercise are untouched by it.
pub fn handle_vault_set_halt(ctx: Context<VaultHalt>, halted: bool, reason: u8) -> Result<()> {
    let s = ctx.accounts.signer.key();
    let p = &ctx.accounts.protocol;
    let v = &mut ctx.accounts.vault;
    let may_halt = s == v.manager || s == p.pause_authority || s == p.authority;
    let may_lift = s == p.authority || s == v.manager;
    require!(if halted { may_halt } else { may_lift }, RosterError::Unauthorized);
    v.state = if halted { VAULT_HALTED } else { VAULT_OPEN };
    emit!(VaultHaltToggled { vault: v.key(), halted, reason });
    Ok(())
}
