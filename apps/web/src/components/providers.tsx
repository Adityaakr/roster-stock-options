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
 * Standard). On the mainnet fork a throwaway burner wallet is offered too, so the flow can be driven end to end
 * without a browser extension; it never appears on a real cluster.
 */
export function Providers({ children }: { children: ReactNode }) {
  const endpoint = useMemo(() => process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8899", []);
  const wallets = useMemo(() => (process.env.NEXT_PUBLIC_CLUSTER === "fork" ? [new UnsafeBurnerWalletAdapter()] : []), []);
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
