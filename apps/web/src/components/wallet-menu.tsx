"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnect } from "@/lib/connect";
import { useCluster, explorerUrl } from "@/lib/cluster";
import { short } from "@/lib/format";
import { Icon } from "@/components/icons";

/** Ask the app to mint this wallet a set of devnet replicas and quote tokens; the reply is shown in the menu item. */
async function fund(wallet: string, say: (s: string) => void): Promise<void> {
  say("Minting…");
  const res = await fetch("/api/faucet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet }) }).catch(() => null);
  const j = (await res?.json().catch(() => null)) as { tokens?: number; quote?: number; sol?: number; error?: string } | null;
  say(res?.ok && j?.tokens ? `Funded: ${j.tokens} of each token, ${j.quote?.toLocaleString()} USDC, ${j.sol} SOL` : j?.error ?? "The faucet did not answer");
}

/** Connect button, or the active wallet with a menu: copy, view on explorer, disconnect. The app signs and submits; the wallet's network setting never matters. */
export function WalletMenu() {
  const { publicKey, disconnect, wallet } = useWallet();
  const connect = useConnect();
  const cluster = useCluster();
  const [open, setOpen] = useState(false);
  const [faucet, setFaucet] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const active = publicKey?.toBase58() ?? null;
  if (!active) {
    return (
      <div className="btnrow">
        <button className="btn primary sm" onClick={() => connect()}>
          Connect wallet
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button className="btn secondary sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="wallet" data-wallet={active}>
        <span className="inline-block w-2 h-2 rounded-full" style={{ background: "var(--green)" }} />
        {short(active, 4)}
        <Icon.Chevron width={14} height={14} />
      </button>
      {open ? (
        <div className="menu" role="menu">
          <div className="px-2.5 py-2 small">
            <div className="mono" style={{ color: "var(--ink)" }}>{short(active, 8)}</div>
            <div>{wallet?.adapter.name ?? "Browser wallet"}. Transactions are built and submitted by the app.</div>
          </div>
          <div className="sep" />
          <button role="menuitem" onClick={() => navigator.clipboard.writeText(active).catch(() => undefined)}>Copy address</button>
          {explorerUrl(cluster, "address", active) ? (
            <a role="menuitem" href={explorerUrl(cluster, "address", active) ?? "#"} target="_blank" rel="noreferrer">
              View on explorer <Icon.External width={14} height={14} />
            </a>
          ) : null}
          {cluster.cluster === "devnet" ? (
            <>
              <div className="sep" />
              {/* Devnet replicas are minted, not bought: one click funds a wallet with every listed token and the quote token. */}
              <button role="menuitem" data-testid="faucet" onClick={() => { void fund(active, setFaucet); }}>{faucet ?? "Get devnet test funds"}</button>
            </>
          ) : null}
          <div className="sep" />
          <button role="menuitem" onClick={() => { void disconnect(); setOpen(false); }}>Disconnect</button>
        </div>
      ) : null}
    </div>
  );
}
