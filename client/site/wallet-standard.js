/* Wallet discovery the Wallet Standard way, without a library (github.com/wallet-standard/wallet-standard, core/app getWallets()): listen for
   `wallet-standard:register-wallet` for the page's whole life (wallets that load late register then), and announce `wallet-standard:app-ready` once.
   Each Solana wallet is wrapped in the provider shape the site pages already speak (connect / publicKey / signMessage / signIn / signAndSendTransaction /
   disconnect), so lobby, landing, watch, admin and blink keep one code path. Legacy injected globals (window.phantom.solana, window.solflare, window.solana)
   are only a fallback for wallets that register no standard wallet – and they are what the e2e fakes install. */
import { CLUSTER, publicRpc } from './pools.js';

/** The chain every request names (anza wallet-standard chains: solana:mainnet | solana:devnet | solana:testnet | solana:localnet). */
export const CHAIN = `solana:${CLUSTER || 'mainnet'}`;
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58(bytes) {
  let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = ''; while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b) break; out = '1' + out; }
  return out;
}
const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const SIGNS = ['solana:signAndSendTransaction', 'solana:signTransaction', 'solana:signMessage', 'solana:signIn'];

/** A Solana wallet: it lists a solana:* chain, can connect, and signs at least one Solana thing. */
export const isSolanaWallet = w => !!w && Array.isArray(w.chains) && w.chains.some(c => String(c).startsWith('solana:')) && !!w.features?.['standard:connect'] && SIGNS.some(f => w.features[f]);
/** Wallet icons are data: URIs by the standard; anything else is not shown (no remote image from a wallet). */
export const safeIcon = icon => (typeof icon === 'string' && /^data:image\/(svg\+xml|webp|png|gif);base64,/.test(icon) ? icon : null);

const registered = [];
const adapters = new WeakMap();
const changed = new Set();
function register(...wallets) {
  const added = wallets.filter(w => isSolanaWallet(w) && !registered.includes(w));
  registered.push(...added);
  if (added.length) for (const f of changed) f();
  return () => { for (const w of added) { const i = registered.indexOf(w); if (i >= 0) registered.splice(i, 1); } for (const f of changed) f(); };
}
/** Runs once per page (module scope). Guarded so the node tests can import the module. */
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const api = Object.freeze({ register });
  window.addEventListener('wallet-standard:register-wallet', ({ detail }) => { try { detail(api); } catch (e) { console.warn('wallet registration failed', e); } });
  try { window.dispatchEvent(new window.CustomEvent('wallet-standard:app-ready', { detail: api })); } catch { /* no CustomEvent: nothing registers */ }
}
/** `fn` runs when a wallet registers or unregisters; returns the unsubscribe. */
export const onWalletsChanged = fn => { changed.add(fn); return () => changed.delete(fn); };

const keyOf = address => ({ toString: () => address, toBase58: () => address });

/** The provider shape over one Wallet Standard wallet. Cached per wallet, so a connection made on sign-in is the one paying later on the same page. */
export function adapt(w) {
  if (adapters.has(w)) return adapters.get(w);
  const f = w.features;
  const solanaAccounts = list => (list ?? []).filter(a => !a.chains?.length || a.chains.some(c => String(c).startsWith('solana:')));
  const p = {
    standard: true, name: String(w.name ?? 'Wallet'), icon: safeIcon(w.icon), account: null, publicKey: null, features: f,
    /** standard:connect; with `address` it picks that account (the signed-in one) when the wallet authorised several. */
    async connect(opts = {}) {
      const res = await f['standard:connect'].connect(opts.silent ? { silent: true } : undefined);
      const list = solanaAccounts(res?.accounts?.length ? res.accounts : w.accounts);
      p.use(list.find(a => a.address === opts.address) ?? list[0] ?? null);
      if (!p.account) throw new Error(`${p.name} did not share an account`);
      return { publicKey: p.publicKey };
    },
    use(account) { p.account = account; p.publicKey = account ? keyOf(account.address) : null; },
    /** The wallet already authorised `address` on this page (no prompt needed to use it). */
    holds: address => solanaAccounts(w.accounts).some(a => a.address === address),
    /** Make sure the wallet is connected to `address` (the session's wallet) before it signs anything for it. */
    async ensure(address) {
      if (p.account?.address !== address) {
        const known = solanaAccounts(w.accounts).find(a => a.address === address);
        if (known) p.use(known);
        else {   // a fresh page (lobby reload): ask quietly first – wallets may ignore `silent`, then this is the prompt anyway
          await p.connect({ address, silent: true }).catch(() => {});
          if (p.account?.address !== address) await p.connect({ address });
        }
      }
      if (address && p.account?.address !== address) throw Object.assign(new Error(`${p.name} is on account ${short(p.account?.address)}, but you are signed in as ${short(address)} – switch the account in the wallet, or sign out and in again.`), { code: 'wallet_account_mismatch' });
      return p.account;
    },
    async signIn(input) {
      if (!f['solana:signIn']) throw new Error(`${p.name} has no one-click sign-in`);
      const [out] = await f['solana:signIn'].signIn(input);
      if (out?.account) p.use(out.account);
      return out;
    },
    /** Same answer as Phantom's injected signMessage: `{ signature }`. A wallet that signs other bytes than asked (the standard allows a prefix) is refused here, not by the server. */
    async signMessage(message) {
      if (!f['solana:signMessage']) throw new Error(`${p.name} cannot sign messages`);
      if (!p.account) await p.connect();
      const [out] = await f['solana:signMessage'].signMessage({ account: p.account, message });
      if (out?.signedMessage && !sameBytes(out.signedMessage, message)) throw Object.assign(new Error(`${p.name} changed the message before signing it – use another wallet for this sign-in.`), { code: 'wallet_message_changed' });
      return { signature: out.signature };
    },
    /** Takes the wire bytes the server built (unsigned, the account as fee payer) – or a web3.js Transaction – and returns `{ signature }` in base58. */
    async signAndSendTransaction(tx) {
      if (!p.account) await p.connect();
      const transaction = tx instanceof Uint8Array ? tx : tx.serialize({ requireAllSignatures: false, verifySignatures: false });
      if (f['solana:signAndSendTransaction']) {
        const [out] = await f['solana:signAndSendTransaction'].signAndSendTransaction({ account: p.account, transaction, chain: CHAIN });
        return { signature: b58(out.signature) };
      }
      if (f['solana:signTransaction']) {   // sign-only wallet: we broadcast it ourselves on the public RPC of CLUSTER
        const [out] = await f['solana:signTransaction'].signTransaction({ account: p.account, transaction, chain: CHAIN });
        return { signature: await broadcast(out.signedTransaction) };
      }
      throw new Error(`${p.name} cannot send transactions`);
    },
    async disconnect() { p.use(null); await f['standard:disconnect']?.disconnect?.(); },
  };
  f['standard:events']?.on?.('change', ({ accounts } = {}) => { if (accounts && p.account && !accounts.some(a => a.address === p.account.address)) p.use(null); });
  adapters.set(w, p);
  return p;
}
const short = a => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : 'none');
async function broadcast(bytes) {
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  const r = await fetch(publicRpc(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: [btoa(s), { encoding: 'base64', preflightCommitment: 'confirmed' }] }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'the network refused the transaction');
  return j.result;
}

/** Legacy injected providers: the label a wallet goes by, so a wallet found both ways is listed once. */
const legacyName = p => (p.isPhantom ? 'Phantom' : p.isSolflare ? 'Solflare' : p.isBackpack ? 'Backpack' : p.isBraveWallet ? 'Brave Wallet' : 'Browser wallet');   // the names they register under
function legacy() {
  if (typeof window === 'undefined') return [];
  const out = [];
  for (const p of [window.phantom?.solana, window.solflare, window.solana]) if (p && !out.includes(p)) out.push(p);
  return out;
}
const nameOf = p => (p.standard ? p.name : legacyName(p));

/** Every wallet this page can use: the standard ones first, then legacy globals whose name no standard wallet has. */
export function wallets() {
  const std = registered.map(adapt);
  const names = new Set(std.map(p => p.name.toLowerCase()));
  const old = legacy().filter(p => { const n = legacyName(p).toLowerCase(); if (names.has(n)) return false; names.add(n); return true; });
  return [...std, ...old];
}
export const walletLabel = nameOf;
