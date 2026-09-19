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
 * Standard). On the test clusters, the fork and devnet, a throwaway burner wallet is offered too, so the flow can be
 * driven end to end without a browser extension; it never appears on mainnet.
 */
export function Providers({ children }: { children: ReactNode }) {
  // The app's own RPC, never the wallet's, and never a provider URL in a page: with no public endpoint configured the
  // browser reads through `/api/rpc`, which relays reads and keeps the provider key on the server.
  const endpoint = useMemo(() => process.env.NEXT_PUBLIC_RPC_URL ?? (typeof window === "undefined" ? "http://127.0.0.1:8899" : `${window.location.origin}/api/rpc`), []);
  // A throwaway burner is offered on the test clusters only, so the whole flow can be driven without an extension.
  // Never on mainnet: the key lives in the page.
  const testCluster = process.env.NEXT_PUBLIC_CLUSTER === "fork" || process.env.NEXT_PUBLIC_CLUSTER === "devnet";
  const wallets = useMemo(() => (testCluster ? [new UnsafeBurnerWalletAdapter()] : []), [testCluster]);
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
