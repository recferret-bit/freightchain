import { AuthChallenge } from '../auth/auth-challenge.entity.js';

/* What an admin's wallet signs. Pending challenges share the rider sign-in's store (one per key), under their own keys so an admin sign-in never
   replaces a rider sign-in of the same wallet, and a message of one kind can never be consumed as the other. */
export const adminSignInKey = (wallet: string): string => `admin:${wallet}`;

export const ADMIN_SIGNIN_STATEMENT = 'ADMIN sign-in to Freight Chain (the admin page). This request will not trigger a transaction or cost any fees.';

export interface AdminSignInInput {
  wallet: string;
  /** the admin page's host / origin (admin.<apex>): wallets compare the message's domain with the page that asks */
  domain: string;
  origin: string;
  nonce: string;
  now: Date;
  ttlMs: number;
}

/** The admin sign-in message (Sign-In-With-Solana format, the admin host as its domain), stored under the admin key. */
export function adminSignInChallenge(input: AdminSignInInput): AuthChallenge {
  const c = AuthChallenge.issue({ ...input, statement: ADMIN_SIGNIN_STATEMENT });
  return new AuthChallenge(adminSignInKey(input.wallet), c.message, c.expiresAt);
}

/* ───────── signed actions: every change on the admin page is signed by the admin's wallet, for exactly that change ─────────
   The server builds the text (what, which ride, which decision, the note), the wallet signs it, the action presents the signature; the server consumes the
   stored text, checks it describes THIS request and verifies the signature over it. A stolen admin session alone cannot change a verdict, and the audit
   row keeps the signed text + signature: proof of who decided what. */
export const adminActionKey = (wallet: string): string => `action:${wallet}`;

export type AdminIntent =
  | { action: 'override'; rideId: string; decision: 'verified' | 'rejected'; note: string | null }
  | { action: 'rejudge'; rideId: string };

/** What the action does, one fact per line; the note is JSON-quoted (it may hold newlines or look like another line). */
export function intentLines(intent: AdminIntent): string[] {
  return intent.action === 'override'
    ? [`Action: set the verdict to ${intent.decision.toUpperCase()}`, `Ride: ${intent.rideId}`, `Note: ${intent.note === null ? '(none)' : JSON.stringify(intent.note)}`]
    : ['Action: RE-JUDGE at the current rules (replaces any decision)', `Ride: ${intent.rideId}`];
}

/** Everything up to the nonce: if a stored message starts with this, it was issued for exactly this admin, host and change. */
const intentHead = (domain: string, wallet: string, intent: AdminIntent): string =>
  [`${domain} – Freight Chain admin action`, '', ...intentLines(intent), '', `Wallet: ${wallet}`, ''].join('\n');

export interface AdminActionInput {
  wallet: string;
  domain: string;
  intent: AdminIntent;
  nonce: string;
  now: Date;
  ttlMs: number;
}

export function adminActionChallenge(input: AdminActionInput): AuthChallenge {
  const expiresAt = new Date(input.now.getTime() + input.ttlMs);
  const message = intentHead(input.domain, input.wallet, input.intent)
    + [`Nonce: ${input.nonce}`, `Issued At: ${input.now.toISOString()}`, `Expiration Time: ${expiresAt.toISOString()}`].join('\n');
  return new AuthChallenge(adminActionKey(input.wallet), message, expiresAt);
}

/** Was this stored message issued for exactly this change (same admin, host, action, ride, decision and note)? */
export const describesIntent = (message: string, domain: string, wallet: string, intent: AdminIntent): boolean => message.startsWith(intentHead(domain, wallet, intent));

/** What the audit keeps of a signed action. */
export interface AdminProof {
  message: string;
  signature: string;
}
