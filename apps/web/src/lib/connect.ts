"use client";

import { useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PRIVY_WALLET_NAME } from "./privy-adapter";

export const PRIVY_ENABLED = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const BURNER = process.env.NEXT_PUBLIC_BURNER_WALLET === "1";

/**
 * The one way the app asks for a wallet. With Privy configured it opens Privy's own modal (email, Phantom, Solflare,
 * Backpack, any detected Solana wallet, WalletConnect); the classic adapter modal is kept only where the burner is
 * switched on, so the browser journeys can pick it, and where Privy is not configured at all.
 */
export function useConnect(): () => void {
  const { select, wallets, connect } = useWallet();
  const { setVisible } = useWalletModal();
  return useCallback(() => {
    if (PRIVY_ENABLED && !BURNER) {
      const privy = wallets.find((w) => w.adapter.name === PRIVY_WALLET_NAME);
      if (privy) {
        select(privy.adapter.name);
        // select() takes effect on the next render; connecting the adapter directly avoids waiting for it.
        void privy.adapter.connect().catch(() => undefined);
        return;
      }
      void connect;
    }
    setVisible(true);
  }, [wallets, select, connect, setVisible]);
}
