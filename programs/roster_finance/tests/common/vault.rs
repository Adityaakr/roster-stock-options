//! Vault helpers for the litesvm harness (Part 3). Every instruction is built from the Anchor client types, as the
//! rest of the harness does; the vault PDA is derived here and nowhere else.

use {
    super::*,
    anchor_lang::solana_program::instruction::Instruction,
    roster_finance::{state::*, VaultParams},
};

pub fn load_vault(svm: &LiteSVM, vault: &Pubkey) -> Vault {
    let data = svm.get_account(vault).unwrap().data;
    Vault::try_deserialize(&mut data.as_slice()).unwrap()
}

pub fn load_epoch(svm: &LiteSVM, record: &Pubkey) -> EpochRecord {
    let data = svm.get_account(record).unwrap().data;
    EpochRecord::try_deserialize(&mut data.as_slice()).unwrap()
}

pub fn load_vpos(svm: &LiteSVM, pos: &Pubkey) -> VaultPosition {
    let data = svm.get_account(pos).unwrap().data;
    VaultPosition::try_deserialize(&mut data.as_slice()).unwrap()
}

impl Env {
    pub fn vault_pda(&self, kind: u8) -> Pubkey {
        Pubkey::find_program_address(&[Vault::SEED, self.market.as_ref(), &[kind]], &self.program_id).0
    }
    pub fn share_mint(&self, vault: &Pubkey) -> Pubkey {
        Pubkey::find_program_address(&[Vault::SHARE_MINT, vault.as_ref()], &self.program_id).0
    }
    pub fn vpos(&self, vault: &Pubkey, owner: &Pubkey) -> Pubkey {
        Pubkey::find_program_address(&[VaultPosition::SEED, vault.as_ref(), owner.as_ref()], &self.program_id).0
    }
    pub fn epoch_record(&self, vault: &Pubkey, epoch: u32) -> Pubkey {
        Pubkey::find_program_address(&[EpochRecord::SEED, vault.as_ref(), &epoch.to_le_bytes()], &self.program_id).0
    }
    pub fn vbid(&self, vault: &Pubkey, series: &Pubkey) -> Pubkey {
        Pubkey::find_program_address(&[VaultBid::SEED, vault.as_ref(), series.as_ref()], &self.program_id).0
    }
    /// (collateral mint, other mint, collateral program, other program) for a vault kind.
    fn vault_mints(&self, kind: u8) -> (Pubkey, Pubkey, Pubkey, Pubkey) {
        if kind == VAULT_COVERED_CALL { (self.mint, self.usdc, spl_token_2022::id(), spl_token::id()) } else { (self.usdc, self.mint, spl_token::id(), spl_token_2022::id()) }
    }
    pub fn shares_of(&self, vault: &Pubkey, owner: &Pubkey) -> u64 {
        balance(&self.svm, &ata(owner, &self.share_mint(vault), &spl_token_2022::id()))
    }

    pub fn init_vault(&mut self, kind: u8, manager: &Pubkey, first_roll_ts: i64, cap_per_series_lots6: u64, cap_total_lots6: u64) -> Result<Pubkey, String> {
        let vault = self.vault_pda(kind);
        let share_mint = self.share_mint(&vault);
        let (cm, om, cp, op) = self.vault_mints(kind);
        let params = VaultParams { kind, manager: *manager, roll_interval_secs: 7 * DAY, first_roll_ts, cap_per_series_lots6, cap_total_lots6, spread_bps: 500, mark_band_bps: 2_000 };
        let ix = Instruction::new_with_bytes(
            self.program_id,
            &roster_finance::instruction::InitVault { params }.data(),
            roster_finance::accounts::InitVault {
                authority: self.authority.pubkey(),
                protocol: self.protocol,
                market: self.market,
                vault,
                collateral_mint: cm,
                other_mint: om,
                share_mint,
                collateral_ata: ata(&vault, &cm, &cp),
                other_ata: ata(&vault, &om, &op),
                share_escrow: ata(&vault, &share_mint, &spl_token_2022::id()),
                collateral_token_program: cp,
                other_token_program: op,
                token_2022_program: spl_token_2022::id(),
                associated_token_program: spl_associated_token_account::program::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        let a = self.authority.insecure_clone();
        send(&mut self.svm, &a, &[&a], &[ix])?;
        Ok(vault)
    }

    pub fn vault_deposit(&mut self, owner: &Keypair, kind: u8, raw: u64) -> Result<(), String> {
        let vault = self.vault_pda(kind);
        let (cm, _, cp, _) = self.vault_mints(kind);
        let ix = Instruction::new_with_bytes(
            self.program_id,
            &roster_finance::instruction::VaultDeposit { raw }.data(),
            roster_finance::accounts::VaultDeposit {
                owner: owner.pubkey(),
                vault,
                position: self.vpos(&vault, &owner.pubkey()),
                collateral_mint: cm,
                collateral_ata: ata(&vault, &cm, &cp),
                owner_collateral_ata: ata(&owner.pubkey(), &cm, &cp),
                collateral_token_program: cp,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        send(&mut self.svm, owner, &[owner], &[ix])
    }

    pub fn vault_request_withdraw(&mut self, owner: &Keypair, kind: u8, shares: u64) -> Result<(), String> {
        let vault = self.vault_pda(kind);
        let sm = self.share_mint(&vault);
        let ix = Instruction::new_with_bytes(
            self.program_id,
            &roster_finance::instruction::VaultRequestWithdraw { shares }.data(),
            roster_finance::accounts::VaultWithdrawRequest {
                owner: owner.pubkey(),
                vault,
                position: self.vpos(&vault, &owner.pubkey()),
                share_mint: sm,
                owner_share_ata: ata(&owner.pubkey(), &sm, &spl_token_2022::id()),
                share_escrow: ata(&vault, &sm, &spl_token_2022::id()),
                token_2022_program: spl_token_2022::id(),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        send(&mut self.svm, owner, &[owner], &[ix])
    }

    pub fn vault_claim(&mut self, owner: &Keypair, kind: u8, epoch: u32) -> Result<(), String> {
        let vault = self.vault_pda(kind);
        let sm = self.share_mint(&vault);
        let (cm, om, cp, op) = self.vault_mints(kind);
        let ix = Instruction::new_with_bytes(
            self.program_id,
            &roster_finance::instruction::VaultClaim { epoch }.data(),
            roster_finance::accounts::VaultClaim {
                owner: owner.pubkey(),
                vault,
                position: self.vpos(&vault, &owner.pubkey()),
                record: self.epoch_record(&vault, epoch),
                share_mint: sm,
                collateral_mint: cm,
                other_mint: om,
                collateral_ata: ata(&vault, &cm, &cp),
                other_ata: ata(&vault, &om, &op),
                share_escrow: ata(&vault, &sm, &spl_token_2022::id()),
                owner_share_ata: ata(&owner.pubkey(), &sm, &spl_token_2022::id()),
                owner_collateral_ata: ata(&owner.pubkey(), &cm, &cp),
                owner_other_ata: ata(&owner.pubkey(), &om, &op),
                collateral_token_program: cp,
                other_token_program: op,
                token_2022_program: spl_token_2022::id(),
                associated_token_program: spl_associated_token_account::program::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        send(&mut self.svm, owner, &[owner], &[ix])
    }

    pub fn vault_roll(&mut self, cranker: &Keypair, kind: u8, mark_usdc_per_lot: u64) -> Result<(), String> {
        let vault = self.vault_pda(kind);
        let v = load_vault(&self.svm, &vault);
        let sm = self.share_mint(&vault);
        let (cm, om, cp, op) = self.vault_mints(kind);
        let ix = Instruction::new_with_bytes(
            self.program_id,
            &roster_finance::instruction::VaultRoll { mark_usdc_per_lot }.data(),
            roster_finance::accounts::VaultRoll {
                cranker: cranker.pubkey(),
                market: self.market,
                vault,
                record: self.epoch_record(&vault, v.epoch),
                share_mint: sm,
                collateral_ata: ata(&vault, &cm, &cp),
                other_ata: ata(&vault, &om, &op),
                share_escrow: ata(&vault, &sm, &spl_token_2022::id()),
                token_2022_program: spl_token_2022::id(),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        send(&mut self.svm, cranker, &[cranker], &[ix])
    }

    fn vault_write(&self, manager: &Keypair, kind: u8, series: &Pubkey) -> roster_finance::accounts::VaultWrite {
        let vault = self.vault_pda(kind);
        let s = load_series(&self.svm, series);
        let (cm, _, cp, _) = self.vault_mints(kind);
        roster_finance::accounts::VaultWrite {
            manager: manager.pubkey(),
            protocol: self.protocol,
            market: self.market,
            vault,
            series: *series,
            collateral_mint: cm,
            collateral_vault: s.collateral_vault,
            collateral_ata: ata(&vault, &cm, &cp),
            collateral_token_program: cp,
        }
    }

    pub fn vault_quote(&mut self, manager: &Keypair, kind: u8, series: &Pubkey, deposit_lots6: u64, ask_lots6: u64, ask_per_lot: u64) -> Result<(), String> {
        let ix = Instruction::new_with_bytes(self.program_id, &roster_finance::instruction::VaultQuote { deposit_lots6, ask_lots6, ask_per_lot }.data(), self.vault_write(manager, kind, series).to_account_metas(None));
        send(&mut self.svm, manager, &[manager], &[ix])
    }

    pub fn vault_withdraw_unsold(&mut self, manager: &Keypair, kind: u8, series: &Pubkey, lots6: u64) -> Result<(), String> {
        let ix = Instruction::new_with_bytes(self.program_id, &roster_finance::instruction::VaultWithdrawUnsold { lots6 }.data(), self.vault_write(manager, kind, series).to_account_metas(None));
        send(&mut self.svm, manager, &[manager], &[ix])
    }

    pub fn vault_cancel_ask(&mut self, manager: &Keypair, kind: u8, series: &Pubkey, seq: u64) -> Result<(), String> {
        let ix = Instruction::new_with_bytes(
            self.program_id,
            &roster_finance::instruction::VaultCancelAsk { seq }.data(),
            roster_finance::accounts::VaultBook { manager: manager.pubkey(), vault: self.vault_pda(kind), market: self.market, series: *series }.to_account_metas(None),
        );
        send(&mut self.svm, manager, &[manager], &[ix])
    }

    pub fn vault_settle(&mut self, cranker: &Keypair, kind: u8, series: &Pubkey) -> Result<(), String> {
        let vault = self.vault_pda(kind);
        let s = load_series(&self.svm, series);
        let ix = Instruction::new_with_bytes(
            self.program_id,
            &roster_finance::instruction::VaultSettle {}.data(),
            roster_finance::accounts::VaultSettle {
                cranker: cranker.pubkey(),
                market: self.market,
                vault,
                series: *series,
                underlying_mint: self.mint,
                quote_mint: self.usdc,
                collateral_vault: s.collateral_vault,
                settlement_vault: s.settlement_vault,
                quote_vault: s.quote_vault,
                vault_underlying_ata: self.nv(&vault),
                vault_quote_ata: self.us(&vault),
                underlying_token_program: spl_token_2022::id(),
                quote_token_program: spl_token::id(),
            }
            .to_account_metas(None),
        );
        send(&mut self.svm, cranker, &[cranker], &[ix])
    }

    pub fn vault_post_bid(&mut self, manager: &Keypair, kind: u8, series: &Pubkey, bid_per_lot: u64, max_lots6: u64, ttl_secs: i64) -> Result<(), String> {
        let vault = self.vault_pda(kind);
        let ix = Instruction::new_with_bytes(
            self.program_id,
            &roster_finance::instruction::VaultPostBid { bid_per_lot, max_lots6, ttl_secs }.data(),
            roster_finance::accounts::VaultPostBid { manager: manager.pubkey(), vault, market: self.market, series: *series, bid: self.vbid(&vault, series), system_program: system_program::ID }.to_account_metas(None),
        );
        send(&mut self.svm, manager, &[manager], &[ix])
    }

    pub fn sell_to_vault(&mut self, holder: &Keypair, kind: u8, series: &Pubkey, lots6: u64, min_bid_per_lot: u64) -> Result<(), String> {
        let vault = self.vault_pda(kind);
        let s = load_series(&self.svm, series);
        let ix = Instruction::new_with_bytes(
            self.program_id,
            &roster_finance::instruction::SellToVault { lots6, min_bid_per_lot }.data(),
            roster_finance::accounts::SellToVault {
                holder: holder.pubkey(),
                market: self.market,
                vault,
                series: *series,
                bid: self.vbid(&vault, series),
                position_mint: s.position_mint,
                holder_position_ata: ata(&holder.pubkey(), &s.position_mint, &spl_token_2022::id()),
                quote_mint: self.usdc,
                vault_quote_ata: self.us(&vault),
                holder_quote_ata: self.us(&holder.pubkey()),
                quote_token_program: spl_token::id(),
                token_2022_program: spl_token_2022::id(),
            }
            .to_account_metas(None),
        );
        send(&mut self.svm, holder, &[holder], &[ix])
    }
}
