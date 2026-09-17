import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Not available · Roster Finance" };

/** The geo gate's plain message (Part 2 section 6): what happened and why, nothing else. */
export default function UnavailablePage() {
  return (
    <main className="sec" style={{ paddingTop: 140, minHeight: "70vh" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <p className="marker"><b>Not available in your region</b></p>
        <h1 className="h1">The app is not offered where you are.</h1>
        <p className="body-lg" style={{ marginTop: 16 }}>The wrapped stocks traded here are non-US wrappers whose issuers do not offer them in your jurisdiction, so the app refuses to build transactions for requests from it. The program itself is public and permissionless; this is the interface declining, not the chain.</p>
        <p className="body" style={{ marginTop: 16 }}>You can still read <Link className="link" href="/risk">the risk page</Link>, <Link className="link" href="/fees">the fee schedule</Link> and the source.</p>
      </div>
    </main>
  );
}
