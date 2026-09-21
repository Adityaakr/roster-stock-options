/*
 * A wallet-adapter Adapter backed by Privy. The app keeps `useWallet()` everywhere (the transaction builder reads
 * `publicKey` and `signTransaction` from it); this class turns whatever Privy has connected, an external Solana
 * wallet or the embedded wallet behind an email login, into that shape. The bridge component inside PrivyProvider
 * feeds it the live wallet and the login and logout functions; it owns no Privy state of its own.
 *
 * Signing goes through Privy's connected wallet: the transaction is serialized, signed as bytes, and read back, so a
 * legacy or a versioned transaction both round-trip unchanged apart from the signature.
 */
import { BaseSignerWalletAdapter, WalletReadyState, type WalletName, type SendTransactionOptions, type TransactionOrVersionedTransaction } from "@solana/wallet-adapter-base";
import { PublicKey, Transaction, VersionedTransaction, type Connection, type TransactionSignature } from "@solana/web3.js";
import type { ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";

export const PRIVY_WALLET_NAME = "Privy" as WalletName<"Privy">;

export interface PrivyBridge {
  wallet: ConnectedStandardSolanaWallet | null;
  chain: "solana:devnet" | "solana:mainnet";
  login: () => void;
  logout: () => Promise<void>;
}

export class PrivyWalletAdapter extends BaseSignerWalletAdapter<"Privy"> {
  name = PRIVY_WALLET_NAME;
  url = "https://privy.io";
  // Privy's mark, inline so the adapter needs no asset: a rounded square in the app's ink.
  icon = "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#111"/><path d="M11 9h6.5a5.5 5.5 0 0 1 0 11H14v3h-3V9zm3 3v5h3.5a2.5 2.5 0 0 0 0-5H14z" fill="#fff"/></svg>').toString("base64");
  readyState = WalletReadyState.Installed;
  supportedTransactionVersions = new Set(["legacy", 0] as const);
  private bridge: PrivyBridge | null = null;
  private _publicKey: PublicKey | null = null;
  private _connecting = false;
  /** Set while `connect()` is waiting for a login to finish, so the bridge knows to emit `connect` when it does. */
  private wantsConnection = false;

  get publicKey(): PublicKey | null {
    return this._publicKey;
  }
  get connecting(): boolean {
    return this._connecting;
  }

  /** Called by the bridge on every change of Privy's state. */
  attach(bridge: PrivyBridge): void {
    this.bridge = bridge;
    const next = bridge.wallet ? new PublicKey(bridge.wallet.address) : null;
    const was = this._publicKey;
    if (next && (!was || !was.equals(next))) {
      this._publicKey = next;
      this._connecting = false;
      this.wantsConnection = false;
      this.emit("connect", next);
    } else if (!next && was) {
      this._publicKey = null;
      this._connecting = false;
      this.emit("disconnect");
    }
  }

  async connect(): Promise<void> {
    if (!this.bridge) throw new Error("Privy is not ready yet");
    if (this.bridge.wallet) {
      this.attach(this.bridge);
      return;
    }
    // The login modal is Privy's; the connection completes when the bridge reports the wallet it produced.
    if (this.wantsConnection) return;
    this._connecting = true;
    this.wantsConnection = true;
    this.bridge.login();
  }

  /** On page load the provider asks every adapter to reconnect silently; a Privy session is picked up, a login is never opened. */
  override async autoConnect(): Promise<void> {
    if (this.bridge?.wallet) this.attach(this.bridge);
  }

  async disconnect(): Promise<void> {
    this._connecting = false;
    this.wantsConnection = false;
    if (this._publicKey) {
      this._publicKey = null;
      this.emit("disconnect");
    }
    await this.bridge?.logout();
  }

  async signTransaction<T extends TransactionOrVersionedTransaction<this["supportedTransactionVersions"]>>(transaction: T): Promise<T> {
    const wallet = this.bridge?.wallet;
    if (!wallet) throw new Error("No wallet connected");
    const bytes = transaction instanceof VersionedTransaction ? transaction.serialize() : new Uint8Array(transaction.serialize({ requireAllSignatures: false, verifySignatures: false }));
    const { signedTransaction } = await wallet.signTransaction({ transaction: bytes, chain: this.bridge!.chain });
    return (transaction instanceof VersionedTransaction ? VersionedTransaction.deserialize(signedTransaction) : Transaction.from(signedTransaction)) as T;
  }

  async sendTransaction(transaction: TransactionOrVersionedTransaction<this["supportedTransactionVersions"]>, connection: Connection, options: SendTransactionOptions = {}): Promise<TransactionSignature> {
    const signed = await this.signTransaction(transaction);
    return connection.sendRawTransaction(signed.serialize(), options);
  }
}
