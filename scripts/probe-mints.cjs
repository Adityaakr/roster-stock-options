// Roster Finance grounding probe: read Token-2022 mint accounts from mainnet.
// Run: node probe_mints.cjs  (NODE_PATH points at lookthrough node_modules)
const NM = '/Users/adityakrx/lookthrough/node_modules';
const { Connection, PublicKey } = require(NM + '/@solana/web3.js');
const spl = require(NM + '/@solana/spl-token');
const fs = require('fs');

const RPC = process.env.RPC || 'https://api.mainnet-beta.solana.com';
const conn = new Connection(RPC, 'confirmed');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Every address below is sourced from an API response captured in this scratch dir, or from CLAUDE.md (flagged).
const MINTS = [
  { sym: 'NVDAx', addr: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh', src: 'https://api.xstocks.fi/api/v2/public/assets/NVDAx' },
  { sym: 'TSLAx', addr: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB', src: 'https://api.xstocks.fi/api/v2/public/assets/TSLAx' },
  { sym: 'SPYx', addr: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W', src: 'https://api.xstocks.fi/api/v2/public/assets/SPYx' },
  { sym: 'SPYx(CLAUDE.md 2.1)', addr: 'XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL', src: 'CLAUDE.md section 2.1 (not from API)' },
  { sym: 'AAPLx', addr: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp', src: 'https://api.xstocks.fi/api/v2/public/assets/AAPLx' },
  { sym: 'MSFTx', addr: 'XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX', src: 'https://api.xstocks.fi/api/v2/public/assets/MSFTx' },
  { sym: 'GOOGLx', addr: 'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN', src: 'https://api.xstocks.fi/api/v2/public/assets/GOOGLx' },
  { sym: 'AMZNx', addr: 'Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg', src: 'https://api.xstocks.fi/api/v2/public/assets/AMZNx' },
  { sym: 'METAx', addr: 'Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu', src: 'https://api.xstocks.fi/api/v2/public/assets/METAx' },
  { sym: 'CRCLx', addr: 'XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1', src: 'https://api.xstocks.fi/api/v2/public/assets/CRCLx' },
  { sym: 'MSTRx', addr: 'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ', src: 'https://api.xstocks.fi/api/v2/public/assets/MSTRx' },
  { sym: 'QQQx', addr: 'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ', src: 'https://api.xstocks.fi/api/v2/public/assets/QQQx' },
  { sym: 'tOpenAI', addr: 'oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ', src: 'https://rest-api.tessera.pe/v1/public/tokens (+CLAUDE.md 2.4)' },
  { sym: 'tKalshi', addr: 'TKLSidmLVt3cqGaaodG8tyRzoANfQwoh67AccjmubeZ', src: 'https://rest-api.tessera.pe/v1/public/tokens (+CLAUDE.md 2.4)' },
  { sym: 'tSpaceX', addr: 'TSPXcLV76s6V2zDiZQ18kBfcbnjaE2ZzNT3ga2Pd99v', src: 'https://rest-api.tessera.pe/v1/public/tokens (+CLAUDE.md 2.4)' },
  { sym: 'OPENAI(PreStocks)', addr: 'PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF', src: 'https://prestocks.com/api/prestocks (+CLAUDE.md 2.5)' },
  { sym: 'SPACEX(PreStocks)', addr: 'PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh', src: 'https://prestocks.com/api/prestocks (+CLAUDE.md 2.5)' },
];

const TOKEN_2022 = spl.TOKEN_2022_PROGRAM_ID.toBase58();
const TOKEN_LEGACY = spl.TOKEN_PROGRAM_ID.toBase58();

// Manual TLV walk so unknown/unsupported extension type numbers are still listed.
function walkTlv(tlv) {
  const out = [];
  let i = 0;
  while (i + 4 <= tlv.length) {
    const type = tlv.readUInt16LE(i);
    const len = tlv.readUInt16LE(i + 2);
    if (type === 0) break; // Uninitialized padding
    out.push({ type, name: spl.ExtensionType[type] ?? 'UNKNOWN', len });
    i += 4 + len;
  }
  return out;
}

const pk = (x) => (x ? x.toBase58() : null);

function unpackTokenMetadata(buf) {
  // spl-token-metadata layout: update_authority(32) mint(32) name(borsh string) symbol uri additional_metadata(vec<(string,string)>)
  let o = 0;
  const key = () => { const k = new PublicKey(buf.subarray(o, o + 32)); o += 32; return k.toBase58(); };
  const str = () => { const l = buf.readUInt32LE(o); o += 4; const s = buf.subarray(o, o + l).toString('utf8'); o += l; return s; };
  const updateAuthority = key(); const mint = key(); const name = str(); const symbol = str(); const uri = str();
  const n = buf.readUInt32LE(o); o += 4; const additional = [];
  for (let k = 0; k < n; k++) additional.push([str(), str()]);
  return { updateAuthority, mint, name, symbol, uri, additionalMetadata: additional };
}

async function main() {
  const results = [];
  const keys = MINTS.map((m) => new PublicKey(m.addr));
  const infos = [];
  for (let i = 0; i < keys.length; i += 6) {
    const chunk = keys.slice(i, i + 6);
    const r = await conn.getMultipleAccountsInfo(chunk, 'confirmed');
    infos.push(...r);
    await sleep(1500);
  }
  const slot = await conn.getSlot('confirmed');
  const epochInfo = await conn.getEpochInfo('confirmed');
  await sleep(1000);

  const hookPdas = []; // {idx, pda}
  for (let i = 0; i < MINTS.length; i++) {
    const m = MINTS[i]; const info = infos[i];
    const rec = { symbol: m.sym, mint: m.addr, source: m.src };
    if (!info) { rec.error = 'ACCOUNT NOT FOUND on mainnet'; results.push(rec); continue; }
    rec.owner = info.owner.toBase58();
    rec.ownerName = rec.owner === TOKEN_2022 ? 'Token-2022' : rec.owner === TOKEN_LEGACY ? 'Token (legacy)' : 'OTHER';
    rec.dataLen = info.data.length;
    rec.lamports = info.lamports;
    try {
      const mint = spl.unpackMint(keys[i], info, info.owner);
      rec.decimals = mint.decimals;
      rec.supplyRaw = mint.supply.toString();
      rec.supplyUi = (Number(mint.supply) / 10 ** mint.decimals).toString();
      rec.mintAuthority = pk(mint.mintAuthority);
      rec.freezeAuthority = pk(mint.freezeAuthority);
      rec.isInitialized = mint.isInitialized;
      rec.extensions = walkTlv(mint.tlvData);
      rec.extensionsLib = spl.getExtensionTypes(mint.tlvData).map((t) => spl.ExtensionType[t] ?? t);
      const cfg = {};
      const th = spl.getTransferHook(mint);
      if (th) {
        cfg.transferHook = { authority: pk(th.authority), programId: pk(th.programId) };
        if (th.programId && th.programId.toBase58() !== PublicKey.default.toBase58()) {
          const pda = spl.getExtraAccountMetaAddress(keys[i], th.programId);
          cfg.transferHook.extraAccountMetaListPda = pda.toBase58();
          hookPdas.push({ idx: i, pda });
        }
      }
      const tf = spl.getTransferFeeConfig(mint);
      if (tf) cfg.transferFee = {
        transferFeeConfigAuthority: pk(tf.transferFeeConfigAuthority), withdrawWithheldAuthority: pk(tf.withdrawWithheldAuthority),
        withheldAmount: tf.withheldAmount.toString(),
        older: { epoch: tf.olderTransferFee.epoch.toString(), bps: tf.olderTransferFee.transferFeeBasisPoints, maxFee: tf.olderTransferFee.maximumFee.toString() },
        newer: { epoch: tf.newerTransferFee.epoch.toString(), bps: tf.newerTransferFee.transferFeeBasisPoints, maxFee: tf.newerTransferFee.maximumFee.toString() },
        currentEpoch: epochInfo.epoch,
        effectiveNow: (() => { const f = spl.getEpochFee(tf, BigInt(epochInfo.epoch)); return { bps: f.transferFeeBasisPoints, maxFee: f.maximumFee.toString() }; })(),
      };
      const pd = spl.getPermanentDelegate(mint);
      if (pd) cfg.permanentDelegate = pk(pd.delegate);
      const pz = spl.getPausableConfig(mint);
      if (pz) cfg.pausable = { authority: pk(pz.authority), paused: pz.paused };
      const su = spl.getScaledUiAmountConfig(mint);
      if (su) cfg.scaledUiAmount = { authority: pk(su.authority), multiplier: su.multiplier, newMultiplierEffectiveTimestamp: su.newMultiplierEffectiveTimestamp.toString(), newMultiplier: su.newMultiplier };
      const mp = spl.getMetadataPointerState(mint);
      if (mp) cfg.metadataPointer = { authority: pk(mp.authority), metadataAddress: pk(mp.metadataAddress) };
      const das = spl.getDefaultAccountState(mint);
      if (das) cfg.defaultAccountState = { state: das.state, stateName: spl.AccountState[das.state] };
      const pb = spl.getPermissionedBurn ? spl.getPermissionedBurn(mint) : null;
      if (pb) cfg.permissionedBurn = { authority: pk(pb.authority) };
      const mca = spl.getMintCloseAuthority ? spl.getMintCloseAuthority(mint) : null;
      if (mca) cfg.mintCloseAuthority = pk(mca.closeAuthority);
      const ib = spl.getInterestBearingMintConfigState ? spl.getInterestBearingMintConfigState(mint) : null;
      if (ib) cfg.interestBearing = { rateAuthority: pk(ib.rateAuthority), currentRate: ib.currentRate };
      const tmd = spl.getExtensionData(spl.ExtensionType.TokenMetadata, mint.tlvData);
      if (tmd) { try { cfg.tokenMetadata = unpackTokenMetadata(tmd); } catch (e) { cfg.tokenMetadata = 'unpack failed: ' + e.message; } }
      const ctm = spl.getExtensionData(spl.ExtensionType.ConfidentialTransferMint, mint.tlvData);
      if (ctm) cfg.confidentialTransferMint = { rawHex: ctm.toString('hex') };
      rec.config = cfg;
    } catch (e) { rec.unpackError = e.message; }
    results.push(rec);
  }

  if (hookPdas.length) {
    const r = await conn.getMultipleAccountsInfo(hookPdas.map((h) => h.pda), 'confirmed');
    hookPdas.forEach((h, j) => {
      const info = r[j];
      const th = results[h.idx].config.transferHook;
      th.extraAccountMetaListExists = !!info;
      if (info) {
        th.extraAccountMetaListOwner = info.owner.toBase58();
        th.extraAccountMetaListDataLen = info.data.length;
        try { th.extraAccountMetas = spl.getExtraAccountMetas(info).map((x) => ({ discriminator: x.discriminator, addressConfigHex: Buffer.from(x.addressConfig).toString('hex'), isSigner: x.isSigner, isWritable: x.isWritable })); } catch (e) { th.extraAccountMetasError = e.message; }
      }
    });
    await sleep(1000);
    // Also fetch the hook program accounts to learn if they are executable / who owns them
    const progs = [...new Set(hookPdas.map((h) => results[h.idx].config.transferHook.programId))];
    const pr = await conn.getMultipleAccountsInfo(progs.map((p) => new PublicKey(p)), 'confirmed');
    progs.forEach((p, j) => { const info = pr[j]; results.forEach((rec) => { if (rec.config && rec.config.transferHook && rec.config.transferHook.programId === p) rec.config.transferHook.program = info ? { executable: info.executable, owner: info.owner.toBase58(), dataLen: info.data.length } : 'NOT FOUND'; }); });
  }

  const out = { rpc: RPC, slot, epoch: epochInfo.epoch, fetchedAt: new Date().toISOString(), results };
  fs.writeFileSync(__dirname + '/mint_probe_results.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
