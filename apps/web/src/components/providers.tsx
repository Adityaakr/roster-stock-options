"use client";

import { useMemo, type ReactNode } from "react";
import { Buffer } from "buffer";

// web3.js expects a global Buffer in the browser.
if (typeof window !== "undefined" && !(window as unknown as { Buffer?: unknown }).Buffer) {
  (window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { UnsafeBurnerWalletAdapter } from "@solana/wallet-adapter-unsafe-burner";
import { ClusterProvider } from "@/lib/cluster";

/**
 * Wallet adapter wiring. The RPC endpoint is the app's, never the wallet's; wallets are auto-discovered (Wallet
 * Standard). On the test clusters a throwaway burner wallet can be switched on for the browser journeys, so the flow
 * can be driven end to end without an extension; it never appears on mainnet or on a deployment that leaves it off.
 */
export function Providers({ children }: { children: ReactNode }) {
  // The app's own RPC, never the wallet's, and never a provider URL in a page: with no public endpoint configured the
  // browser reads through `/api/rpc`, which relays reads and keeps the provider key on the server.
  const endpoint = useMemo(() => process.env.NEXT_PUBLIC_RPC_URL ?? (typeof window === "undefined" ? "http://127.0.0.1:8899" : `${window.location.origin}/api/rpc`), []);
  // A throwaway burner is offered only where NEXT_PUBLIC_BURNER_WALLET=1 on a test cluster: the browser journeys drive
  // the whole flow through it without an extension. A public deployment leaves it unset, so the adapter's own warning
  // never reaches a visitor's console. Never on mainnet: the key lives in the page.
  const testCluster = process.env.NEXT_PUBLIC_CLUSTER === "fork" || process.env.NEXT_PUBLIC_CLUSTER === "devnet";
  const burner = testCluster && process.env.NEXT_PUBLIC_BURNER_WALLET === "1";
  const wallets = useMemo(() => (burner ? [new UnsafeBurnerWalletAdapter()] : []), [burner]);
  return (
    <ConnectionProvider endpoint={endpoint} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <ClusterProvider>{children}</ClusterProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
