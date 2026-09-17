use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::Token2022,
    token_interface::{self, Mint, MintTo, TokenAccount, TokenInterface},
};

use crate::{
    error::RosterError,
    events::{Bought, Fill},
    instructions::shared::{vault_in, SeriesSeeds},
    math::{add_open, fee_ceil, premium_for},
    state::{MarketConfig, Protocol, Series, MAX_WALK},
};

/// Walk at most eight asks from the best, fill greedily at or below the limit, take the taker fee once, accrue each
/// writer's premium on its slot, mint position tokens. The account set does not depend on which writers fill.
#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(seeds = [Protocol::SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    #[account(seeds = [MarketConfig::SEED, market.mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, MarketConfig>,
    #[account(mut, has_one = market @ RosterError::WrongAccount, has_one = quote_vault @ RosterError::WrongAccount, has_one = position_mint @ RosterError::WrongAccount)]
    pub series: AccountLoader<'info, Series>,
    #[account(address = market.quote_mint @ RosterError::WrongQuoteMint)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub quote_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, associated_token::mint = quote_mint, associated_token::authority = protocol, associated_token::token_program = quote_token_program)]
    pub fee_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = quote_mint, token::authority = buyer, token::token_program = quote_token_program)]
    pub buyer_quote_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub position_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(init_if_needed, payer = buyer, associated_token::mint = position_mint, associated_token::authority = buyer, associated_token::token_program = token_2022_program)]
    pub buyer_position_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_buy(ctx: Context<Buy>, lots6: u64, max_premium_per_lot: u64, referrer: Option<Pubkey>) -> Result<()> {
    let clock = Clock::get()?;
    let market = &ctx.accounts.market;
    let protocol = &ctx.accounts.protocol;
    require!(market.listed, RosterError::NotListed);
    require!(!market.paused && !protocol.paused_all, RosterError::Paused);
    let series_key = ctx.accounts.series.key();
    let series_info = ctx.accounts.series.to_account_info();
    let mut series = ctx.accounts.series.load_mut()?;
    require!(series.expiry_ts > clock.unix_timestamp, RosterError::Expired);
    require!(series.is_open(), RosterError::Halted);
    require!(lots6 >= market.min_lots6 && lots6 <= market.max_lots6, RosterError::SizeOutOfRange);
    require!(referrer.is_none(), RosterError::IntegratorNotRegistered);

    let buyer = ctx.accounts.buyer.key();
    let mut filled = 0u64;
    let mut premium_total = 0u64;
    let mut fee_total = 0u64;
    let mut walked = 0usize;
    let mut i = 0usize;
    while i < series.asks_len as usize && walked < MAX_WALK && filled < lots6 {
        let ask = series.asks[i];
        if ask.ask_per_lot > max_premium_per_lot {
            break;
        }
        let take = ask.remaining_lots6.min(lots6 - filled);
        let premium = premium_for(take, ask.ask_per_lot).ok_or(RosterError::Overflow)?;
        let fee = fee_ceil(premium, protocol.fee_bps);
        let writer_gets = premium.checked_sub(fee).ok_or(RosterError::Overflow)?;
        let slot = ask.writer_slot as usize;
        let mut w = series.writers[slot];
        add_open(&series, &mut w, take);
        w.premium_claimable = w.premium_claimable.checked_add(writer_gets).ok_or(RosterError::Overflow)?;
        series.writers[slot] = w;
        filled += take;
        premium_total = premium_total.checked_add(premium).ok_or(RosterError::Overflow)?;
        fee_total = fee_total.checked_add(fee).ok_or(RosterError::Overflow)?;
        walked += 1;
        emit!(Fill { series: series_key, buyer, writer: w.writer, lots6: take, ask_per_lot: ask.ask_per_lot, premium, seq: ask.seq });
        if take == ask.remaining_lots6 {
            let len = series.asks_len as usize;
            for j in i..len - 1 {
                series.asks[j] = series.asks[j + 1];
            }
            series.asks[len - 1] = Default::default();
            series.asks_len = (len - 1) as u8;
        } else {
            series.asks[i].remaining_lots6 -= take;
            i += 1;
        }
    }
    require!(filled > 0, RosterError::QuoteMoved);
    series.total_sold_lots6 = series.total_sold_lots6.checked_add(filled).ok_or(RosterError::Overflow)?;
    series.unassigned_lots6 = series.unassigned_lots6.checked_add(filled).ok_or(RosterError::Overflow)?;

    // Premium net of fee into the series quote vault, the fee into the protocol fee vault. Fees are taken here only.
    let net = premium_total - fee_total;
    let arrived = vault_in(&ctx.accounts.quote_token_program, &ctx.accounts.buyer_quote_ata, &ctx.accounts.quote_mint, &mut ctx.accounts.quote_vault, &ctx.accounts.buyer, net)?;
    require!(arrived == net, RosterError::WrongAccount);
    if fee_total > 0 {
        let arrived_fee = vault_in(&ctx.accounts.quote_token_program, &ctx.accounts.buyer_quote_ata, &ctx.accounts.quote_mint, &mut ctx.accounts.fee_vault, &ctx.accounts.buyer, fee_total)?;
        require!(arrived_fee == fee_total, RosterError::WrongAccount);
    }

    let seeds = SeriesSeeds::of(&series);
    drop(series);
    let sd = seeds.seeds();
    let signer: &[&[&[u8]]] = &[&sd];
    token_interface::mint_to(
        CpiContext::new_with_signer(ctx.accounts.token_2022_program.key(),
            MintTo { mint: ctx.accounts.position_mint.to_account_info(), to: ctx.accounts.buyer_position_ata.to_account_info(), authority: series_info },
            signer,
        ),
        filled,
    )?;

    emit!(Bought { series: series_key, buyer, lots6_filled: filled, lots6_requested: lots6, premium_paid: premium_total, fee: fee_total, asks_walked: walked as u8 });
    Ok(())
}
