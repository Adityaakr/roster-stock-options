"use client";

import Link from "next/link";
import type { TxState } from "@/lib/tx";
import { useCluster, explorerUrl } from "@/lib/cluster";
import { CopyButton } from "@/components/copy-button";

/** The state of one transaction: building, signing, sending, done with the signature, or failed with what happened and the next action. */
export function TxStatus({ state, onRetry, doneHref, doneLabel }: { state: TxState; onRetry?: () => void; doneHref?: string; doneLabel?: string }) {
  const cluster = useCluster();
  if (state.status === "idle") return null;
  if (state.status === "building") return <div className="msg" role="status" style={{ marginTop: 10 }}>Building the transaction on the app's RPC…</div>;
  if (state.status === "signing") return <div className="msg" role="status" style={{ marginTop: 10 }}>Waiting for the wallet to sign. Nothing is sent until it does.</div>;
  if (state.status === "sending") return <div className="msg" role="status" style={{ marginTop: 10 }}>Sent. Waiting for confirmation…</div>;
  if (state.status === "done") {
    const href = explorerUrl(cluster, "tx", state.signature);
    return (
      <div className="msg green" role="status" style={{ marginTop: 10 }} data-testid="tx-done">
        <div>Confirmed. Signature <span className="mono" data-testid="tx-signature">{state.signature.slice(0, 8)}…{state.signature.slice(-8)}</span> <CopyButton value={state.signature} /> {href ? <a className="link" href={href} target="_blank" rel="noreferrer">explorer</a> : null}</div>
        {doneHref ? <div style={{ marginTop: 6 }}><Link className="link" href={doneHref}>{doneLabel ?? "Continue"}</Link></div> : null}
      </div>
    );
  }
  return (
    <div className="msg red" role="alert" style={{ marginTop: 10 }} data-testid="tx-failed" data-code={state.failure.code}>
      <div><b>{state.failure.what}</b></div>
      <div style={{ marginTop: 4 }}>{state.failure.next}</div>
      {onRetry ? <button className="btn secondary sm" style={{ marginTop: 8 }} onClick={onRetry}>Try again</button> : null}
    </div>
  );
}
