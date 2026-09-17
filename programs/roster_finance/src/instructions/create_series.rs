use anchor_lang::{prelude::*, system_program};
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{spl_token_metadata_interface, token_metadata_initialize, Mint, TokenAccount, TokenInterface, TokenMetadataInitialize},
};

use crate::{
    error::RosterError,
    events::SeriesCreated,
    instructions::shared::SeriesSeeds,
    state::{Ask, MarketConfig, Protocol, Series, Side, WriterSlot, MAX_ASKS, MAX_WRITERS, P_ONE, SERIES_OPEN},
};

/// Permissionless within the market grid (addendum C). The strike is micro-USDC per lot and is stored as given: the
/// program reads no multiplier. Creates the pooled vaults and a Token-2022 position mint with on-mint metadata.
#[derive(Accounts)]
#[instruction(side: Side, strike_usdc_per_lot: u64, expiry_ts: i64)]
pub struct CreateSeries<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [Protocol::SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    #[account(mut, seeds = [MarketConfig::SEED, market.mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, MarketConfig>,
    #[account(address = market.mint @ RosterError::WrongAccount)]
    pub underlying_mint: InterfaceAccount<'info, Mint>,
    #[account(address = market.quote_mint @ RosterError::WrongQuoteMint)]
    pub quote_mint: InterfaceAccount<'info, Mint>,
    /// Underlying for a call, USDC for a put; checked in the handler against `side`.
    pub collateral_mint: InterfaceAccount<'info, Mint>,
    /// The other leg.
    pub settlement_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init, payer = payer, space = Series::LEN,
        seeds = [Series::SEED, market.key().as_ref(), &[side.as_u8()], &strike_usdc_per_lot.to_le_bytes(), &expiry_ts.to_le_bytes()], bump
    )]
    pub series: AccountLoader<'info, Series>,
    #[account(
        init, payer = payer, seeds = [Series::PMINT, series.key().as_ref()], bump,
        mint::decimals = 6, mint::authority = series, mint::freeze_authority = series, mint::token_program = token_2022_program,
        extensions::metadata_pointer::authority = series,
        extensions::metadata_pointer::metadata_address = position_mint,
        extensions::close_authority::authority = series,
    )]
    pub position_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(init, payer = payer, seeds = [Series::CVAULT, series.key().as_ref()], bump, token::mint = collateral_mint, token::authority = series, token::token_program = collateral_token_program)]
    pub collateral_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(init, payer = payer, seeds = [Series::SVAULT, series.key().as_ref()], bump, token::mint = settlement_mint, token::authority = series, token::token_program = settlement_token_program)]
    pub settlement_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(init, payer = payer, seeds = [Series::QVAULT, series.key().as_ref()], bump, token::mint = quote_mint, token::authority = series, token::token_program = quote_token_program)]
    pub quote_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub collateral_token_program: Interface<'info, TokenInterface>,
    pub settlement_token_program: Interface<'info, TokenInterface>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub token_2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_series(ctx: Context<CreateSeries>, side: Side, strike_usdc_per_lot: u64, expiry_ts: i64) -> Result<()> {
    let clock = Clock::get()?;
    let market = &mut ctx.accounts.market;
    require!(market.listed, RosterError::NotListed);
    require!(!market.paused && !ctx.accounts.protocol.paused_all, RosterError::Paused);
    require!(market.allowed_expiries.contains(&expiry_ts) && expiry_ts > clock.unix_timestamp, RosterError::ExpiryOffGrid);
    require!(
        strike_usdc_per_lot >= market.min_strike && strike_usdc_per_lot <= market.max_strike && strike_usdc_per_lot % market.strike_step == 0,
        RosterError::StrikeOffGrid
    );
    require!(market.live_series < market.max_live_series, RosterError::SeriesCapReached);
    // Creation is free of any deposit and rent comes back only after expiry plus grace, so on the tiers where the
    // treasury keeps a grid it is limited to the authority and the series creator; a stranger could otherwise fill
    // the cap with empty terms for the price of rent. Tier 3 markets are permissionless.
    require!(ctx.accounts.protocol.may_create_series(&ctx.accounts.payer.key(), market.tier), RosterError::Unauthorized);
    let (want_collateral, want_settlement) = match side {
        Side::Call => (market.mint, market.quote_mint),
        Side::Put => (market.quote_mint, market.mint),
    };
    require!(ctx.accounts.collateral_mint.key() == want_collateral && ctx.accounts.settlement_mint.key() == want_settlement, RosterError::WrongVaultMint);
    // Fee-inclusive put settlement lands with First Print (M7); until then transfer-fee mints list calls only.
    require!(!(market.has_transfer_fee && side == Side::Put), RosterError::WrongVaultMint);
    let symbol = market.symbol_str();
    market.live_series += 1;

    let series_key = ctx.accounts.series.key();
    let series_info = ctx.accounts.series.to_account_info();
    let mut s = ctx.accounts.series.load_init()?;
    s.bump = ctx.bumps.series;
    s.market = market.key();
    s.side = side.as_u8();
    s.strike_usdc_per_lot = strike_usdc_per_lot;
    s.expiry_ts = expiry_ts;
    s.collateral_vault = ctx.accounts.collateral_vault.key();
    s.settlement_vault = ctx.accounts.settlement_vault.key();
    s.quote_vault = ctx.accounts.quote_vault.key();
    s.position_mint = ctx.accounts.position_mint.key();
    s.total_sold_lots6 = 0;
    s.total_exercised_lots6 = 0;
    s.unassigned_lots6 = 0;
    s.set_p(P_ONE);
    s.scale = 0;
    s.epoch = 0;
    s.state = SERIES_OPEN;
    s.halted_at = 0;
    s.resumed_at = 0;
    s.rent_payer = ctx.accounts.payer.key();
    s.seq = 0;
    s.asks_len = 0;
    s.asks = [Ask::default(); MAX_ASKS];
    s.writers = [WriterSlot::default(); MAX_WRITERS];
    let seeds = SeriesSeeds::of(&s);
    let market_key = s.market;
    let position_mint_key = s.position_mint;
    // Release the zero-copy borrow before any CPI that passes the series account.
    drop(s);

    // On-mint metadata: fund the extra rent, then initialise. Name and symbol carry the term so wallets read it.
    let name = format!("Roster {} {} {}", symbol, if side == Side::Call { "Gap" } else { "Floor" }, expiry_ts);
    let sym = format!("R{}{}", if side == Side::Call { "C" } else { "P" }, strike_usdc_per_lot / 1_000_000);
    let uri = String::from("https://roster.finance/series");
    let meta = spl_token_metadata_interface::state::TokenMetadata {
        update_authority: Option::<Pubkey>::Some(series_key).try_into().unwrap(),
        mint: ctx.accounts.position_mint.key(),
        name: name.clone(),
        symbol: sym.clone(),
        uri: uri.clone(),
        additional_metadata: vec![],
    };
    let extra = meta.tlv_size_of().map_err(|_| RosterError::Overflow)?;
    let mint_info = ctx.accounts.position_mint.to_account_info();
    let needed = Rent::get()?.minimum_balance(mint_info.data_len() + extra);
    let have = mint_info.lamports();
    if needed > have {
        system_program::transfer(
            CpiContext::new(ctx.accounts.system_program.key(), system_program::Transfer { from: ctx.accounts.payer.to_account_info(), to: mint_info.clone() }),
            needed - have,
        )?;
    }
    let sd = seeds.seeds();
    let signer: &[&[&[u8]]] = &[&sd];
    token_metadata_initialize(
        CpiContext::new_with_signer(ctx.accounts.token_2022_program.key(),
            TokenMetadataInitialize {
                program_id: ctx.accounts.token_2022_program.to_account_info(),
                metadata: mint_info.clone(),
                update_authority: series_info.clone(),
                mint_authority: series_info.clone(),
                mint: mint_info,
            },
            signer,
        ),
        name,
        sym,
        uri,
    )?;

    emit!(SeriesCreated { series: series_key, market: market_key, side, strike_usdc_per_lot, expiry_ts, position_mint: position_mint_key });
    Ok(())
}
