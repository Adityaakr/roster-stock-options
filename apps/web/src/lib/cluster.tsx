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
const LABEL: Record<ClusterInfo["cluster"], string> = { fixture: "Fixture", fork: "Mainnet fork", devnet: "Devnet", mainnet: "Mainnet" };
/*
 * The first paint knows the cluster from the build, so the header never flashes "Fixture" and "program not deployed"
 * on a live deployment while `/api/cluster` is still in flight. What the server reports then replaces it.
 */
const built = (process.env.NEXT_PUBLIC_CLUSTER as ClusterInfo["cluster"] | undefined) ?? "fixture";
const fallback: ClusterInfo = { cluster: built, label: LABEL[built] ?? "Fixture", programDeployed: built !== "fixture", rpcReachable: true, explorer: null };

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
