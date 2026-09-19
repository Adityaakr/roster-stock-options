//! litesvm harness: a synthetic NVDAx replica (Token-2022 with ScaledUiAmount, Pausable and an empty TransferHook
//! slot, the extension set docs/MINT.md recorded), an SPL-Token USDC, the deployed program, and helpers that build
//! every instruction from the Anchor client types. Hermetic: no RPC.

#![allow(dead_code)]

pub mod vault;

use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{instruction::Instruction, program_pack::Pack, system_instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::{
        associated_token::{get_associated_token_address_with_program_id, spl_associated_token_account},
        token::spl_token,
        token_2022::spl_token_2022,
    },
    litesvm::LiteSVM,
    roster_finance::{state::*, CreateMarketParams, InitProtocolParams},
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    spl_token_2022::extension::{scaled_ui_amount, pausable, transfer_hook, ExtensionType},
};

pub const LOT: u64 = LOT6;
pub const DECIMALS: u8 = 8;
pub const RAW_PER_LOT6: u64 = 100; // 10^(8-6)
pub const USDC: u64 = 1_000_000;
pub const BASE_SLOT: u64 = 440_208_000;
pub const T0: i64 = 1_800_000_000;
pub const DAY: i64 = 86_400;
pub const MULTIPLIER: f64 = 1.001701196801074;

pub struct Env {
    pub svm: LiteSVM,
    pub program_id: Pubkey,
    pub authority: Keypair,
    pub issuer: Keypair,
    pub keeper: Keypair,
    pub usdc: Pubkey,
    pub mint: Pubkey,
    pub protocol: Pubkey,
    pub fee_vault: Pubkey,
    pub market: Pubkey,
    pub expiries: [i64; 4],
}

pub fn send(svm: &mut LiteSVM, payer: &Keypair, signers: &[&Keypair], ixs: &[Instruction]) -> Result<(), String> {
    svm.expire_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    match svm.send_transaction(tx) {
        Ok(_) => Ok(()),
        Err(e) => Err(e.meta.logs.join("\n")),
    }
}

/// Assert a failure carries the named Anchor error.
pub fn expect_err(r: Result<(), String>, name: &str) {
    match r {
        Ok(()) => panic!("expected {name}, got success"),
        Err(logs) => assert!(logs.contains(name), "expected {name} in logs:\n{logs}"),
    }
}

pub fn warp_to(svm: &mut LiteSVM, unix: i64) {
    let mut clock: Clock = svm.get_sysvar();
    let delta = (unix - clock.unix_timestamp).max(0) as u64;
    clock.slot += delta * 2;
    clock.unix_timestamp = unix;
    svm.set_sysvar(&clock);
}

pub fn now(svm: &LiteSVM) -> i64 {
    let clock: Clock = svm.get_sysvar();
    clock.unix_timestamp
}

pub fn create_spl_mint(svm: &mut LiteSVM, payer: &Keypair, decimals: u8) -> Pubkey {
    let mint = Keypair::new();
    let rent = svm.minimum_balance_for_rent_exemption(spl_token::state::Mint::LEN);
    let ixs = [
        system_instruction::create_account(&payer.pubkey(), &mint.pubkey(), rent, spl_token::state::Mint::LEN as u64, &spl_token::id()),
        spl_token::instruction::initialize_mint2(&spl_token::id(), &mint.pubkey(), &payer.pubkey(), None, decimals).unwrap(),
    ];
    send(svm, payer, &[payer, &mint], &ixs).unwrap();
    mint.pubkey()
}

/// The NVDAx replica: Token-2022, 8 decimals, ScaledUiAmount at the live multiplier, Pausable, TransferHook slot with
/// no program. `issuer` holds every authority, as on mainnet one key does.
pub fn create_replica_mint(svm: &mut LiteSVM, payer: &Keypair, issuer: &Keypair) -> Pubkey {
    let mint = Keypair::new();
    let exts = [ExtensionType::ScaledUiAmount, ExtensionType::Pausable, ExtensionType::TransferHook];
    let len = ExtensionType::try_calculate_account_len::<spl_token_2022::state::Mint>(&exts).unwrap();
    let rent = svm.minimum_balance_for_rent_exemption(len);
    let pid = spl_token_2022::id();
    let ixs = [
        system_instruction::create_account(&payer.pubkey(), &mint.pubkey(), rent, len as u64, &pid),
        scaled_ui_amount::instruction::initialize(&pid, &mint.pubkey(), Some(issuer.pubkey()), MULTIPLIER).unwrap(),
        pausable::instruction::initialize(&pid, &mint.pubkey(), &issuer.pubkey()).unwrap(),
        transfer_hook::instruction::initialize(&pid, &mint.pubkey(), Some(issuer.pubkey()), None).unwrap(),
        spl_token_2022::instruction::initialize_mint2(&pid, &mint.pubkey(), &issuer.pubkey(), Some(&issuer.pubkey()), DECIMALS).unwrap(),
    ];
    send(svm, payer, &[payer, &mint], &ixs).unwrap();
    mint.pubkey()
}

pub fn ata(owner: &Pubkey, mint: &Pubkey, program: &Pubkey) -> Pubkey {
    get_associated_token_address_with_program_id(owner, mint, program)
}

pub fn create_ata(svm: &mut LiteSVM, payer: &Keypair, owner: &Pubkey, mint: &Pubkey, program: &Pubkey) -> Pubkey {
    let ix = spl_associated_token_account::instruction::create_associated_token_account_idempotent(&payer.pubkey(), owner, mint, program);
    send(svm, payer, &[payer], &[ix]).unwrap();
    ata(owner, mint, program)
}

pub fn balance(svm: &LiteSVM, account: &Pubkey) -> u64 {
    match svm.get_account(account) {
        Some(a) if a.data.len() >= 72 => u64::from_le_bytes(a.data[64..72].try_into().unwrap()),
        _ => 0,
    }
}

pub fn mint_supply(svm: &LiteSVM, mint: &Pubkey) -> u64 {
    let data = svm.get_account(mint).unwrap().data;
    u64::from_le_bytes(data[36..44].try_into().unwrap())
}

pub fn load_series(svm: &LiteSVM, series: &Pubkey) -> Series {
    let data = svm.get_account(series).unwrap().data;
    *bytemuck::from_bytes::<Series>(&data[8..8 + core::mem::size_of::<Series>()])
}

pub fn load_market(svm: &LiteSVM, market: &Pubkey) -> MarketConfig {
    let data = svm.get_account(market).unwrap().data;
    MarketConfig::try_deserialize(&mut data.as_slice()).unwrap()
}

impl Env {
    pub fn new() -> Env {
        let program_id = roster_finance::id();
        let mut svm = LiteSVM::default().with_builtins().with_lamports(10_000_000_000_000_000).with_sysvars().with_default_programs();
        let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/roster_finance.so"));
        svm.add_program(program_id, bytes).unwrap();
        warp_to(&mut svm, T0);
        let authority = Keypair::new();
        let issuer = Keypair::new();
        let keeper = Keypair::new();
        for k in [&authority, &issuer, &keeper] {
            svm.airdrop(&k.pubkey(), 1_000_000_000_000).unwrap();
        }
        let usdc = create_spl_mint(&mut svm, &authority, 6);
        let mint = create_replica_mint(&mut svm, &authority, &issuer);
        let protocol = Pubkey::find_program_address(&[Protocol::SEED], &program_id).0;
        let fee_vault = ata(&protocol, &usdc, &spl_token::id());
        let market = Pubkey::find_program_address(&[MarketConfig::SEED, mint.as_ref()], &program_id).0;
        let expiries = [T0 + 7 * DAY, T0 + 14 * DAY, 0, 0];
        let mut env = Env { svm, program_id, authority, issuer, keeper, usdc, mint, protocol, fee_vault, market, expiries };
        env.init_protocol();
        env.create_market();
        env
    }

    pub fn wallet(&mut self, lots: u64, usdc: u64) -> Keypair {
        let kp = Keypair::new();
        self.svm.airdrop(&kp.pubkey(), 100_000_000_000).unwrap();
        let nv = create_ata(&mut self.svm, &kp, &kp.pubkey(), &self.mint, &spl_token_2022::id());
        let us = create_ata(&mut self.svm, &kp, &kp.pubkey(), &self.usdc, &spl_token::id());
        let issuer = self.issuer.insecure_clone();
        let authority = self.authority.insecure_clone();
        if lots > 0 {
            let ix = spl_token_2022::instruction::mint_to(&spl_token_2022::id(), &self.mint, &nv, &issuer.pubkey(), &[], lots * LOT * RAW_PER_LOT6).unwrap();
            send(&mut self.svm, &issuer, &[&issuer], &[ix]).unwrap();
        }
        if usdc > 0 {
            let ix = spl_token::instruction::mint_to(&spl_token::id(), &self.usdc, &us, &authority.pubkey(), &[], usdc * USDC).unwrap();
            send(&mut self.svm, &authority, &[&authority], &[ix]).unwrap();
        }
        kp
    }

    pub fn nv(&self, owner: &Pubkey) -> Pubkey {
        ata(owner, &self.mint, &spl_token_2022::id())
    }
    pub fn us(&self, owner: &Pubkey) -> Pubkey {
        ata(owner, &self.usdc, &spl_token::id())
    }

    fn init_protocol(&mut self) {
        let ix = Instruction::new_with_bytes(
            self.program_id,
            &roster_finance::instruction::InitProtocol { params: InitProtocolParams { pause_authority: self.keeper.pubkey(), treasury: self.authority.pubkey(), fee_bps: 10, integrator_share_bps: 3000, keeper_fee_usdc: 2 * USDC, grace_secs: 3600 } }.data(),
            roster_finance::accounts::InitProtocol {
                authority: self.authority.pubkey(),
                protocol: self.protocol,
                quote_mint: self.usdc,
                fee_vault: self.fee_vault,
                quote_token_program: spl_token::id(),
                associated_token_program: spl_associated_token_account::program::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        let a = self.authority.insecure_clone();
        send(&mut self.svm, &a, &[&a], &[ix]).unwrap();
    }

    fn create_market(&mut self) {
        let params = CreateMarketParams {
            token_feed_id: TOKEN_FEED,
            equity_feed_id: [2; 32],
            allowed_expiries: self.expiries,
            strike_step: USDC,
            min_strike: 100 * USDC,
            max_strike: 300 * USDC,
            max_live_series: 12,
            min_lots6: LOT / 100,
            max_lots6: 10_000 * LOT,
            max_writer_lots6: 5_000 * LOT,
            tier: 1,
            max_price_age_secs: 60,
            max_conf_bps: 100,
            symbol: *b"NVDAx\0\0\0",
            feed_prices_ui_share: true,
        };
        let ix = Instruction::new_with_bytes(
            self.program_id,
            &roster_finance::instruction::CreateMarket { params }.data(),
            roster_finance::accounts::CreateMarket { authority: self.authority.pubkey(), protocol: self.protocol, market: self.market, mint: self.mint, system_program: system_program::ID }.to_account_metas(None),
        );
        let a = self.authority.insecure_clone();
        send(&mut self.svm, &a, &[&a], &[ix]).unwrap();
    }

    pub fn series_pda(&self, side: Side, strike: u64, expiry: i64) -> Pubkey {
        Pubkey::find_program_address(&[Series::SEED, self.market.as_ref(), &[side.as_u8()], &strike.to_le_bytes(), &expiry.to_le_bytes()], &self.program_id).0
    }
    pub fn pmint(&self, series: &Pubkey) -> Pubkey {
        Pubkey::find_program_address(&[Series::PMINT, series.as_ref()], &self.program_id).0
    }
    pub fn vaults(&self, series: &Pubkey) -> (Pubkey, Pubkey, Pubkey) {
        (
            Pubkey::find_program_address(&[Series::CVAULT, series.as_ref()], &self.program_id).0,
            Pubkey::find_program_address(&[Series::SVAULT, series.as_ref()], &self.program_id).0,
            Pubkey::find_program_address(&[Series::QVAULT, series.as_ref()], &self.program_id).0,
        )
    }

    pub fn create_series(&mut self, payer: &Keypair, side: Side, strike: u64, expiry: i64) -> Result<Pubkey, String> {
        let series = self.series_pda(side, strike, expiry);
        let (cv, sv, qv) = self.vaults(&series);
        let (cmint, smint, cprog, sprog) = match side {
            Side::Call => (self.mint, self.usdc, spl_token_2022::id(), spl_token::id()),
            Side::Put => (self.usdc, self.mint, spl_token::id(), spl_token_2022::id()),
        };
        let ix = Instruction::new_with_bytes(
            self.program_id,
            &roster_finance::instruction::CreateSeries { side, strike_usdc_per_lot: strike, expiry_ts: expiry }.data(),
            roster_finance::accounts::CreateSeries {
                payer: payer.pubkey(),
                protocol: self.protocol,
                market: self.market,
                underlying_mint: self.mint,
                quote_mint: self.usdc,
                collateral_mint: cmint,
                settlement_mint: smint,
                series,
                position_mint: self.pmint(&series),
                collateral_vault: cv,
                settlement_vault: sv,
                quote_vault: qv,
                collateral_token_program: cprog,
                settlement_token_program: sprog,
                quote_token_program: spl_token::id(),
                token_2022_program: spl_token_2022::id(),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        send(&mut self.svm, payer, &[payer], &[ix]).map(|_| series)
    }

    fn writer_collateral(&self, writer: &Keypair, series: &Pubkey) -> roster_finance::accounts::WriterCollateral {
        let s = load_series(&self.svm, series);
        let (cmint, cprog) = match s.side() { Side::Call => (self.mint, spl_token_2022::id()), Side::Put => (self.usdc, spl_token::id()) };
        roster_finance::accounts::WriterCollateral {
            writer: writer.pubkey(),
            protocol: self.protocol,
            market: self.market,
            series: *series,
            collateral_mint: cmint,
            collateral_vault: s.collateral_vault,
            writer_collateral_ata: ata(&writer.pubkey(), &cmint, &cprog),
            collateral_token_program: cprog,
        }
    }

    pub fn quote(&mut self, writer: &Keypair, series: &Pubkey, deposit_lots6: u64, ask_lots6: u64, ask_per_lot: u64) -> Result<(), String> {
        let ix = Instruction::new_with_bytes(self.program_id, &roster_finance::instruction::Quote { deposit_lots6, ask_lots6, ask_per_lot }.data(), self.writer_collateral(writer, series).to_account_metas(None));
        send(&mut self.svm, writer, &[writer], &[ix])
    }

    pub fn withdraw_unsold(&mut self, writer: &Keypair, series: &Pubkey, lots6: u64) -> Result<(), String> {
        let ix = Instruction::new_with_bytes(self.program_id, &roster_finance::instruction::WithdrawUnsold { lots6 }.data(), self.writer_collateral(writer, series).to_account_metas(None));
        send(&mut self.svm, writer, &[writer], &[ix])
    }

    pub fn cancel_ask(&mut self, writer: &Keypair, series: &Pubkey, seq: u64) -> Result<(), String> {
        let ix = Instruction::new_with_bytes(self.program_id, &roster_finance::instruction::CancelAsk { seq }.data(), roster_finance::accounts::WriterOnly { writer: writer.pubkey(), series: *series }.to_account_metas(None));
        send(&mut self.svm, writer, &[writer], &[ix])
    }

    pub fn claim_premium(&mut self, writer: &Keypair, series: &Pubkey) -> Result<(), String> {
        let s = load_series(&self.svm, series);
        let ix = Instruction::new_with_bytes(
            self.program_id,
            &roster_finance::instruction::ClaimPremium {}.data(),
            roster_finance::accounts::ClaimPremium { writer: writer.pubkey(), market: self.market, series: *series, quote_mint: self.usdc, quote_vault: s.quote_vault, writer_quote_ata: self.us(&writer.pubkey()), quote_token_program: spl_token::id() }.to_account_metas(None),
        );
        send(&mut self.svm, writer, &[writer], &[ix])
    }

    pub fn buy(&mut self, buyer: &Keypair, series: &Pubkey, lots6: u64, max_premium_per_lot: u64) -> Result<(), String> {
        let s = load_series(&self.svm, series);
        let pm = s.position_mint;
        let ix = Instruction::new_with_bytes(
            self.program_id,
            &roster_finance::instruction::Buy { lots6, max_premium_per_lot, referrer: None }.data(),
            roster_finance::accounts::Buy {
                buyer: buyer.pubkey(),
                protocol: self.protocol,
                market: self.market,
                series: *series,
                quote_mint: self.usdc,
                quote_vault: s.quote_vault,
                fee_vault: self.fee_vault,
                buyer_quote_ata: self.us(&buyer.pubkey()),
                position_mint: pm,
                buyer_position_ata: ata(&buyer.pubkey(), &pm, &spl_token_2022::id()),
                quote_token_program: spl_token::id(),
                token_2022_program: spl_token_2022::id(),
                associated_token_program: spl_associated_token_account::program::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        send(&mut self.svm, buyer, &[buyer], &[ix])
    }

    pub fn exercise(&mut self, holder: &Keypair, series: &Pubkey, lots6: u64) -> Result<(), String> {
        let s = load_series(&self.svm, series);
        let pm = s.position_mint;
        let ix = Instruction::new_with_bytes(
            self.program_id,
            &roster_finance::instruction::Exercise { lots6 }.data(),
            roster_finance::accounts::Exercise {
                holder: holder.pubkey(),
                market: self.market,
                series: *series,
                underlying_mint: self.mint,
                quote_mint: self.usdc,
                position_mint: pm,
                holder_position_ata: ata(&holder.pubkey(), &pm, &spl_token_2022::id()),
                collateral_vault: s.collateral_vault,
                settlement_vault: s.settlement_vault,
                holder_underlying_ata: self.nv(&holder.pubkey()),
                holder_quote_ata: self.us(&holder.pubkey()),
                underlying_token_program: spl_token_2022::id(),
                quote_token_program: spl_token::id(),
                token_2022_program: spl_token_2022::id(),
                associated_token_program: spl_associated_token_account::program::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        send(&mut self.svm, holder, &[holder], &[ix])
    }

    pub fn settle_writer(&mut self, writer: &Pubkey, series: &Pubkey) -> Result<(), String> {
        let s = load_series(&self.svm, series);
        let k = self.keeper.insecure_clone();
        let ix = Instruction::new_with_bytes(
            self.program_id,
            &roster_finance::instruction::SettleWriter {}.data(),
            roster_finance::accounts::SettleWriter {
                cranker: k.pubkey(),
                market: self.market,
                series: *series,
                writer: *writer,
                underlying_mint: self.mint,
                quote_mint: self.usdc,
                collateral_vault: s.collateral_vault,
                settlement_vault: s.settlement_vault,
                quote_vault: s.quote_vault,
                writer_underlying_ata: self.nv(writer),
                writer_quote_ata: self.us(writer),
                underlying_token_program: spl_token_2022::id(),
                quote_token_program: spl_token::id(),
                associated_token_program: spl_associated_token_account::program::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        send(&mut self.svm, &k, &[&k], &[ix])
    }

    pub fn close_series(&mut self, series: &Pubkey) -> Result<(), String> {
        let s = load_series(&self.svm, series);
        let k = self.keeper.insecure_clone();
        let ix = Instruction::new_with_bytes(
            self.program_id,
            &roster_finance::instruction::CloseSeries {}.data(),
            roster_finance::accounts::CloseSeries {
                cranker: k.pubkey(),
                protocol: self.protocol,
                market: self.market,
                series: *series,
                rent_receiver: s.rent_payer,
                underlying_mint: self.mint,
                quote_mint: self.usdc,
                position_mint: s.position_mint,
                collateral_vault: s.collateral_vault,
                settlement_vault: s.settlement_vault,
                quote_vault: s.quote_vault,
                fee_vault: self.fee_vault,
                treasury: self.authority.pubkey(),
                treasury_underlying_ata: self.nv(&self.authority.pubkey()),
                underlying_token_program: spl_token_2022::id(),
                quote_token_program: spl_token::id(),
                token_2022_program: spl_token_2022::id(),
                associated_token_program: spl_associated_token_account::program::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        send(&mut self.svm, &k, &[&k], &[ix])
    }

    /// Issuer-side multiplier change on the replica, as an xStocks activation would do.
    pub fn update_multiplier(&mut self, multiplier: f64, effective: i64) {
        let issuer = self.issuer.insecure_clone();
        let ix = scaled_ui_amount::instruction::update_multiplier(&spl_token_2022::id(), &self.mint, &issuer.pubkey(), &[], multiplier, effective).unwrap();
        send(&mut self.svm, &issuer, &[&issuer], &[ix]).unwrap();
    }

    pub fn pause_mint(&mut self, paused: bool) {
        let issuer = self.issuer.insecure_clone();
        let ix = if paused { pausable::instruction::pause(&spl_token_2022::id(), &self.mint, &issuer.pubkey(), &[]).unwrap() } else { pausable::instruction::resume(&spl_token_2022::id(), &self.mint, &issuer.pubkey(), &[]).unwrap() };
        send(&mut self.svm, &issuer, &[&issuer], &[ix]).unwrap();
    }
}

// ---------- M2 helpers: admin, auto-exercise, Pyth fixtures ----------

use {
    anchor_lang::AccountSerialize,
    pyth_solana_receiver_sdk::price_update::{PriceFeedMessage, PriceUpdateV2, VerificationLevel},
    solana_account::Account,
};

pub const TOKEN_FEED: [u8; 32] = [1; 32];

impl Env {
    pub fn update_protocol(&mut self, signer: &Keypair, params: roster_finance::UpdateProtocolParams) -> Result<(), String> {
        let ix = Instruction::new_with_bytes(self.program_id, &roster_finance::instruction::UpdateProtocol { params }.data(), roster_finance::accounts::UpdateProtocol { signer: signer.pubkey(), protocol: self.protocol }.to_account_metas(None));
        send(&mut self.svm, signer, &[signer], &[ix])
    }

    pub fn update_market(&mut self, signer: &Keypair, params: roster_finance::UpdateMarketParams) -> Result<(), String> {
        let ix = Instruction::new_with_bytes(self.program_id, &roster_finance::instruction::UpdateMarket { params }.data(), roster_finance::accounts::UpdateMarket { signer: signer.pubkey(), protocol: self.protocol, market: self.market }.to_account_metas(None));
        send(&mut self.svm, signer, &[signer], &[ix])
    }

    pub fn withdraw_fees(&mut self, amount: u64) -> Result<(), String> {
        let a = self.authority.insecure_clone();
        create_ata(&mut self.svm, &a, &a.pubkey(), &self.usdc, &spl_token::id());
        let ix = Instruction::new_with_bytes(
            self.program_id,
            &roster_finance::instruction::WithdrawFees { amount }.data(),
            roster_finance::accounts::WithdrawFees { authority: a.pubkey(), protocol: self.protocol, quote_mint: self.usdc, fee_vault: self.fee_vault, treasury: a.pubkey(), treasury_quote_ata: self.us(&a.pubkey()), quote_token_program: spl_token::id() }.to_account_metas(None),
        );
        send(&mut self.svm, &a, &[&a], &[ix])
    }

    pub fn delegate_pda(&self) -> Pubkey {
        Pubkey::find_program_address(&[AutoExercise::AUTHORITY_SEED], &self.program_id).0
    }
    pub fn autoex_pda(&self, holder: &Pubkey, series: &Pubkey) -> Pubkey {
        Pubkey::find_program_address(&[AutoExercise::SEED, holder.as_ref(), series.as_ref()], &self.program_id).0
    }

    fn set_auto_exercise_accounts(&self, holder: &Keypair, series: &Pubkey) -> roster_finance::accounts::SetAutoExercise {
        let s = load_series(&self.svm, series);
        let (pay_mint, pay_prog) = match s.side() { Side::Call => (self.usdc, spl_token::id()), Side::Put => (self.mint, spl_token_2022::id()) };
        roster_finance::accounts::SetAutoExercise {
            holder: holder.pubkey(),
            market: self.market,
            series: *series,
            auto_exercise: self.autoex_pda(&holder.pubkey(), series),
            delegate: self.delegate_pda(),
            position_mint: s.position_mint,
            holder_position_ata: ata(&holder.pubkey(), &s.position_mint, &spl_token_2022::id()),
            pay_mint,
            holder_pay_ata: ata(&holder.pubkey(), &pay_mint, &pay_prog),
            pay_token_program: pay_prog,
            token_2022_program: spl_token_2022::id(),
            system_program: system_program::ID,
        }
    }

    pub fn enable_auto_exercise(&mut self, holder: &Keypair, series: &Pubkey, min_itm_bps: u16) -> Result<(), String> {
        let ix = Instruction::new_with_bytes(self.program_id, &roster_finance::instruction::EnableAutoExercise { min_itm_bps }.data(), self.set_auto_exercise_accounts(holder, series).to_account_metas(None));
        send(&mut self.svm, holder, &[holder], &[ix])
    }

    pub fn disable_auto_exercise(&mut self, holder: &Keypair, series: &Pubkey) -> Result<(), String> {
        let ix = Instruction::new_with_bytes(self.program_id, &roster_finance::instruction::DisableAutoExercise {}.data(), self.set_auto_exercise_accounts(holder, series).to_account_metas(None));
        send(&mut self.svm, holder, &[holder], &[ix])
    }

    /// Write a PriceUpdateV2 account owned by the receiver program, as the crank would post in the same transaction.
    pub fn price_update(&mut self, feed_id: [u8; 32], price_usd: f64, conf_usd: f64, publish_time: i64, full: bool) -> Pubkey {
        let key = Keypair::new().pubkey();
        let expo = -8i32;
        let msg = PriceFeedMessage { feed_id, price: (price_usd * 1e8) as i64, conf: (conf_usd * 1e8) as u64, exponent: expo, publish_time, prev_publish_time: publish_time - 1, ema_price: (price_usd * 1e8) as i64, ema_conf: (conf_usd * 1e8) as u64 };
        let update = PriceUpdateV2 { write_authority: Pubkey::default(), verification_level: if full { VerificationLevel::Full } else { VerificationLevel::Partial { num_signatures: 1 } }, price_message: msg, posted_slot: 1 };
        let mut data = Vec::new();
        update.try_serialize(&mut data).unwrap();
        self.svm.set_account(key, Account { lamports: 10_000_000, data, owner: pyth_solana_receiver_sdk::ID, executable: false, rent_epoch: 0 }).unwrap();
        key
    }

    pub fn auto_exercise(&mut self, holder: &Pubkey, series: &Pubkey, lots6: u64, price_update: Pubkey) -> Result<(), String> {
        let k = self.keeper.insecure_clone();
        self.auto_exercise_as(&k, holder, series, lots6, price_update)
    }

    /// The crank signed by any keypair: only the registered keeper (the pause authority) is paid.
    pub fn auto_exercise_as(&mut self, k: &Keypair, holder: &Pubkey, series: &Pubkey, lots6: u64, price_update: Pubkey) -> Result<(), String> {
        let s = load_series(&self.svm, series);
        self.svm.airdrop(&k.pubkey(), 10_000_000_000).ok();
        create_ata(&mut self.svm, &k, &k.pubkey(), &self.usdc, &spl_token::id());
        let ix = Instruction::new_with_bytes(
            self.program_id,
            &roster_finance::instruction::AutoExercise { lots6 }.data(),
            roster_finance::accounts::AutoExerciseCrank {
                keeper: k.pubkey(),
                protocol: self.protocol,
                market: self.market,
                series: *series,
                holder: *holder,
                auto_exercise: self.autoex_pda(holder, series),
                delegate: self.delegate_pda(),
                underlying_mint: self.mint,
                quote_mint: self.usdc,
                position_mint: s.position_mint,
                holder_position_ata: ata(holder, &s.position_mint, &spl_token_2022::id()),
                collateral_vault: s.collateral_vault,
                settlement_vault: s.settlement_vault,
                holder_underlying_ata: self.nv(holder),
                holder_quote_ata: self.us(holder),
                fee_vault: self.fee_vault,
                keeper_quote_ata: self.us(&k.pubkey()),
                price_update,
                underlying_token_program: spl_token_2022::id(),
                quote_token_program: spl_token::id(),
                token_2022_program: spl_token_2022::id(),
            }
            .to_account_metas(None),
        );
        send(&mut self.svm, &k, &[&k], &[ix])
    }
}

impl Env {
    pub fn observe_halt(&mut self, series: &Pubkey) -> Result<(), String> {
        let s = load_series(&self.svm, series);
        let k = self.keeper.insecure_clone();
        let ix = Instruction::new_with_bytes(self.program_id, &roster_finance::instruction::ObserveHalt {}.data(), roster_finance::accounts::ObserveHalt { market: self.market, series: *series, underlying_mint: self.mint, collateral_vault: s.collateral_vault, settlement_vault: s.settlement_vault }.to_account_metas(None));
        send(&mut self.svm, &k, &[&k], &[ix])
    }
}

/// Send and return compute units consumed (for docs/COMPUTE.md).
pub fn send_cu(svm: &mut LiteSVM, payer: &Keypair, signers: &[&Keypair], ixs: &[Instruction]) -> Result<u64, String> {
    svm.expire_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    match svm.send_transaction(tx) {
        Ok(m) => Ok(m.compute_units_consumed),
        Err(e) => Err(e.meta.logs.join("\n")),
    }
}
