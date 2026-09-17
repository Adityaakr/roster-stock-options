//! Measures compute units per instruction on litesvm for docs/COMPUTE.md, including the full 8-ask walk.
mod common;

use {anchor_lang::{solana_program::{instruction::Instruction, system_program}, InstructionData, ToAccountMetas}, anchor_spl::{associated_token::spl_associated_token_account, token::spl_token, token_2022::spl_token_2022}, common::*, roster_finance::state::*, solana_signer::Signer};

#[test]
fn print_compute_units() {
    let mut env = Env::new();
    let payer = env.authority.insecure_clone();
    let series = env.series_pda(Side::Call, 180 * USDC, env.expiries[0]);
    let (cv, sv, qv) = env.vaults(&series);
    let ix = Instruction::new_with_bytes(
        env.program_id,
        &roster_finance::instruction::CreateSeries { side: Side::Call, strike_usdc_per_lot: 180 * USDC, expiry_ts: env.expiries[0], symbol: "NVDAx".into() }.data(),
        roster_finance::accounts::CreateSeries { payer: payer.pubkey(), protocol: env.protocol, market: env.market, underlying_mint: env.mint, quote_mint: env.usdc, collateral_mint: env.mint, settlement_mint: env.usdc, series, position_mint: env.pmint(&series), collateral_vault: cv, settlement_vault: sv, quote_vault: qv, collateral_token_program: spl_token_2022::id(), settlement_token_program: spl_token::id(), quote_token_program: spl_token::id(), token_2022_program: spl_token_2022::id(), system_program: system_program::ID }.to_account_metas(None),
    );
    let cu_create = send_cu(&mut env.svm, &payer, &[&payer], &[ix]).unwrap();
    // Eight writers, one ask each, so a buy walks eight.
    let mut cu_quote = 0;
    for i in 0..8u64 {
        let w = env.wallet(50, 0);
        let s = load_series(&env.svm, &series);
        let accts = roster_finance::accounts::WriterCollateral { writer: w.pubkey(), protocol: env.protocol, market: env.market, series, collateral_mint: env.mint, collateral_vault: s.collateral_vault, writer_collateral_ata: env.nv(&w.pubkey()), collateral_token_program: spl_token_2022::id() };
        let ix = Instruction::new_with_bytes(env.program_id, &roster_finance::instruction::Quote { deposit_lots6: 10 * LOT, ask_lots6: 10 * LOT, ask_per_lot: 5_000_000 + i * 10_000 }.data(), accts.to_account_metas(None));
        cu_quote = send_cu(&mut env.svm, &w, &[&w], &[ix]).unwrap();
    }
    let h = env.wallet(0, 100_000);
    let s = load_series(&env.svm, &series);
    let pm = s.position_mint;
    let buy_accts = roster_finance::accounts::Buy { buyer: h.pubkey(), protocol: env.protocol, market: env.market, series, quote_mint: env.usdc, quote_vault: s.quote_vault, fee_vault: env.fee_vault, buyer_quote_ata: env.us(&h.pubkey()), position_mint: pm, buyer_position_ata: common::ata(&h.pubkey(), &pm, &spl_token_2022::id()), quote_token_program: spl_token::id(), token_2022_program: spl_token_2022::id(), associated_token_program: spl_associated_token_account::program::ID, system_program: system_program::ID };
    let ix = Instruction::new_with_bytes(env.program_id, &roster_finance::instruction::Buy { lots6: 80 * LOT, max_premium_per_lot: 6_000_000, referrer: None }.data(), buy_accts.to_account_metas(None));
    let cu_buy8 = send_cu(&mut env.svm, &h, &[&h], &[ix]).unwrap();
    let s = load_series(&env.svm, &series);
    let ex_accts = roster_finance::accounts::Exercise { holder: h.pubkey(), market: env.market, series, underlying_mint: env.mint, quote_mint: env.usdc, position_mint: pm, holder_position_ata: common::ata(&h.pubkey(), &pm, &spl_token_2022::id()), collateral_vault: s.collateral_vault, settlement_vault: s.settlement_vault, holder_underlying_ata: env.nv(&h.pubkey()), holder_quote_ata: env.us(&h.pubkey()), underlying_token_program: spl_token_2022::id(), quote_token_program: spl_token::id(), token_2022_program: spl_token_2022::id(), associated_token_program: spl_associated_token_account::program::ID, system_program: system_program::ID };
    let ix = Instruction::new_with_bytes(env.program_id, &roster_finance::instruction::Exercise { lots6: 10 * LOT }.data(), ex_accts.to_account_metas(None));
    let cu_exercise = send_cu(&mut env.svm, &h, &[&h], &[ix]).unwrap();
    println!("COMPUTE create_series={cu_create} quote={cu_quote} buy_8_asks={cu_buy8} exercise={cu_exercise}");
}
