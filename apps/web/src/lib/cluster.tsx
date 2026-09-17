"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/** The active cluster, shown in the header on every screen (CLAUDE.md 4.4). The wallet's own network setting never matters. */
export interface ClusterInfo {
  cluster: "fixture" | "fork" | "devnet" | "mainnet";
  label: string;
  programDeployed: boolean;
  rpcReachable: boolean;
  explorer: string | null;
}

const Ctx = createContext<ClusterInfo | null>(null);
const fallback: ClusterInfo = { cluster: "fixture", label: "Fixture", programDeployed: false, rpcReachable: true, explorer: null };

export function ClusterProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<ClusterInfo>(fallback);
  useEffect(() => {
    fetch("/api/cluster")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: ClusterInfo | null) => j && setInfo(j))
      .catch(() => undefined);
  }, []);
  return <Ctx.Provider value={info}>{children}</Ctx.Provider>;
}

export function useCluster(): ClusterInfo {
  return useContext(Ctx) ?? fallback;
}

export function explorerUrl(info: ClusterInfo, kind: "address" | "tx", value: string): string | null {
  return info.explorer ? info.explorer.replace("{path}", `${kind}/${value}`) : null;
}
