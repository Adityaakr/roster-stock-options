"use client";

import { useMemo, type ReactNode } from "react";
import { Buffer } from "buffer";

// web3.js expects a global Buffer in the browser.
if (typeof window !== "undefined" && !(window as unknown as { Buffer?: unknown }).Buffer) {
  (window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { UnsafeBurnerWalletAdapter } from "@solana/wallet-adapter-unsafe-burner";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { toSolanaWalletConnectors, useWallets as usePrivySolanaWallets } from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { ClusterProvider } from "@/lib/cluster";
import { PrivyWalletAdapter, PRIVY_WALLET_NAME } from "@/lib/privy-adapter";
import { useEffect } from "react";

/**
 * Wallet adapter wiring. The RPC endpoint is the app's, never the wallet's; wallets are auto-discovered (Wallet
 * Standard). On the test clusters a throwaway burner wallet can be switched on for the browser journeys, so the flow
 * can be driven end to end without an extension; it never appears on mainnet or on a deployment that leaves it off.
 */
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const CLUSTER = process.env.NEXT_PUBLIC_CLUSTER;
/** Privy names the chain the way wallet-standard does; the fork carries mainnet's genesis, so it signs as mainnet. */
const PRIVY_CHAIN: "solana:devnet" | "solana:mainnet" = CLUSTER === "devnet" ? "solana:devnet" : "solana:mainnet";

/**
 * Feeds Privy's state into the adapter the rest of the app reads through `useWallet()`: the connected Solana wallet
 * (external, or the embedded one an email login creates), and login and logout. Selects the adapter as soon as a
 * wallet exists, so a returning session is connected without a click.
 */
function PrivyBridge({ adapter }: { adapter: PrivyWalletAdapter }) {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets, ready: walletsReady } = usePrivySolanaWallets();
  const { select, wallet: selected } = useWallet();
  const wallet = authenticated && walletsReady ? wallets[0] ?? null : null;
  useEffect(() => {
    if (!ready) return;
    adapter.attach({ wallet, chain: PRIVY_CHAIN, login: () => login(), logout });
    if (wallet && selected?.adapter.name !== PRIVY_WALLET_NAME) select(PRIVY_WALLET_NAME);
  }, [adapter, ready, wallet, login, logout, select, selected]);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  // The app's own RPC, never the wallet's, and never a provider URL in a page: with no public endpoint configured the
  // browser reads through `/api/rpc`, which relays reads and keeps the provider key on the server.
  const endpoint = useMemo(() => process.env.NEXT_PUBLIC_RPC_URL ?? (typeof window === "undefined" ? "http://127.0.0.1:8899" : `${window.location.origin}/api/rpc`), []);
  // A throwaway burner is offered only where NEXT_PUBLIC_BURNER_WALLET=1 on a test cluster: the browser journeys drive
  // the whole flow through it without an extension. A public deployment leaves it unset, so the adapter's own warning
  // never reaches a visitor's console. Never on mainnet: the key lives in the page.
  const testCluster = process.env.NEXT_PUBLIC_CLUSTER === "fork" || process.env.NEXT_PUBLIC_CLUSTER === "devnet";
  const burner = testCluster && process.env.NEXT_PUBLIC_BURNER_WALLET === "1";
  const privyAdapter = useMemo(() => (PRIVY_APP_ID ? new PrivyWalletAdapter() : null), []);
  const wallets = useMemo(() => [...(privyAdapter ? [privyAdapter] : []), ...(burner ? [new UnsafeBurnerWalletAdapter()] : [])], [privyAdapter, burner]);
  const tree = (
    <ConnectionProvider endpoint={endpoint} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {privyAdapter ? <PrivyBridge adapter={privyAdapter} /> : null}
          <ClusterProvider>{children}</ClusterProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
  if (!PRIVY_APP_ID) return tree;
  // Email (one-time code) and Solana wallets only: Phantom, Solflare, Backpack, whatever else is installed (MetaMask
  // with Solana enabled shows up here), and WalletConnect by QR. No social logins. An email login gets an embedded
  // Solana wallet; the RPC Privy's own confirmation UI reads is the app's relay, so no provider key reaches a page.
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "wallet"],
        appearance: {
          theme: "light",
          accentColor: "#111111",
          walletChainType: "solana-only",
          walletList: ["phantom", "solflare", "backpack", "detected_solana_wallets", "wallet_connect_qr_solana"],
          showWalletLoginFirst: false,
          landingHeader: "Roster Finance",
          loginMessage: "Sign in with email or connect a Solana wallet"
        },
        embeddedWallets: { solana: { createOnLogin: "users-without-wallets" }, ethereum: { createOnLogin: "off" } },
        externalWallets: { solana: { connectors: toSolanaWalletConnectors() } },
        solana: {
          rpcs: {
            [PRIVY_CHAIN]: {
              rpc: createSolanaRpc(endpoint),
              rpcSubscriptions: createSolanaRpcSubscriptions(CLUSTER === "devnet" ? "wss://api.devnet.solana.com" : "wss://api.mainnet-beta.solana.com")
            }
          }
        }
      }}
    >
      {tree}
    </PrivyProvider>
  );
}
