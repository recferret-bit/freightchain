import { AuthChallenge } from '../auth/auth-challenge.entity.js';
import { PromoCode } from '../economy/promo-code.entity.js';
import { describeEffect } from '../economy/promo.dto.js';
import type { PromoCreateInput } from '../economy/promo.types.js';
import type { SettingKey } from '../settings/game-settings.js';

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

/* The ENTITY EDITOR (the storybook model viewer): its own sign-in message and key, so an editor sign-in never replaces an admin or rider sign-in. */
export const editorSignInKey = (wallet: string): string => `editor:${wallet}`;
export const EDITOR_SIGNIN_STATEMENT = 'EDITOR sign-in to Freight Chain (the 3D model editor). This request will not trigger a transaction or cost any fees.';

/** The editor sign-in message (Sign-In-With-Solana format, the storybook host as its domain), stored under the editor key. */
export function editorSignInChallenge(input: AdminSignInInput): AuthChallenge {
  const c = AuthChallenge.issue({ ...input, statement: EDITOR_SIGNIN_STATEMENT });
  return new AuthChallenge(editorSignInKey(input.wallet), c.message, c.expiresAt);
}

/** 1-click editor sign-in, before the wallet is known. Its own key, so it can never be consumed as a rider sign-in (`nonce:`). */
export const editorNonceKey = (nonce: string): string => `editor-nonce:${nonce}`;
export function editorAnonymousChallenge(input: Omit<AdminSignInInput, 'wallet'>): AuthChallenge {
  const c = AuthChallenge.issue({ ...input, statement: EDITOR_SIGNIN_STATEMENT, version: '1', chainId: 'solana:devnet' });
  return new AuthChallenge(editorNonceKey(input.nonce), c.message, c.expiresAt);
}

/* ───────── signed actions: every change on the admin page is signed by the admin's wallet, for exactly that change ─────────
   The server builds the text (what, which ride, which decision, the note), the wallet signs it, the action presents the signature; the server consumes the
   stored text, checks it describes THIS request and verifies the signature over it. A stolen admin session alone cannot change a verdict, and the audit
   row keeps the signed text + signature: proof of who decided what. */
export const adminActionKey = (wallet: string): string => `action:${wallet}`;
/** the editor's pending signed action – its own key, so an editor's publish and an admin's change never consume each other's text */
export const editorActionKey = (wallet: string): string => `editor-action:${wallet}`;
/** which signed surface: the admin page (admin.<apex>) or the entity editor (storybook.<apex>) – each names its own host and keeps its own pending text */
export type ProofSurface = 'admin' | 'editor';

export type AdminIntent =
  | { action: 'override'; rideId: string; decision: 'verified' | 'rejected'; note: string | null }
  | { action: 'rejudge'; rideId: string }
  | { action: 'promo_create'; promo: PromoCreateInput }
  | { action: 'promo_disable'; code: string }
  | { action: 'free_rides_adjust'; wallet: string; delta: number }
  | { action: 'setting_update'; key: SettingKey | string; value: number }
  | { action: 'pool_hold'; poolId: number; hold: boolean; note: string | null }
  | { action: 'entity_publish'; entityId: string; revisionId: string; seq: number };

/** EVERY field of a new promo code as one JSON line, keys in a fixed order, dates as ISO strings – the signature binds the whole code, not a summary of it. */
export const promoJson = (p: PromoCreateInput): string => JSON.stringify({
  code: PromoCode.normalize(p.code), effect: p.effect, description: p.description, maxRedemptions: p.maxRedemptions, perWallet: p.perWallet,
  startsAt: p.startsAt?.toISOString() ?? null, expiresAt: p.expiresAt?.toISOString() ?? null, note: p.note,
});

/** What the action does, one fact per line; free text (a note, a description) only ever appears JSON-quoted (it may hold newlines or look like another line). */
export function intentLines(intent: AdminIntent): string[] {
  switch (intent.action) {
    case 'override': return [`Action: set the verdict to ${intent.decision.toUpperCase()}`, `Ride: ${intent.rideId}`, `Note: ${intent.note === null ? '(none)' : JSON.stringify(intent.note)}`];
    case 'rejudge': return ['Action: RE-JUDGE at the current rules (replaces any decision)', `Ride: ${intent.rideId}`];
    case 'promo_create': return [`Action: CREATE promo code ${PromoCode.normalize(intent.promo.code)}`, `Gives: ${describeEffect(intent.promo.effect)}`, `Promo: ${promoJson(intent.promo)}`];
    case 'promo_disable': return [`Action: DISABLE promo code ${PromoCode.normalize(intent.code)}`];
    case 'free_rides_adjust': return [`Action: ADJUST free rides by ${intent.delta}`, `Player: ${intent.wallet}`];
    case 'setting_update': return [`Action: SET setting ${intent.key}`, `Value: ${intent.value}`];
    case 'entity_publish': return [`Action: PUBLISH 3D model ${intent.entityId} – every player draws it from now on`, `Revision: #${intent.seq} (${intent.revisionId})`];
    case 'pool_hold': return [`Action: ${intent.hold ? 'HOLD the payout of' : 'RELEASE the payout hold of'} pool ${intent.poolId}`, `Note: ${intent.note === null ? '(none)' : JSON.stringify(intent.note)}`];
  }
}

/** Everything up to the nonce: if a stored message starts with this, it was issued for exactly this admin, host and change. */
const intentHead = (domain: string, wallet: string, intent: AdminIntent, surface: ProofSurface = 'admin'): string =>
  [`${domain} – Freight Chain ${surface === 'editor' ? 'model editor' : 'admin'} action`, '', ...intentLines(intent), '', `Wallet: ${wallet}`, ''].join('\n');

export interface AdminActionInput {
  wallet: string;
  domain: string;
  intent: AdminIntent;
  nonce: string;
  now: Date;
  ttlMs: number;
  surface?: ProofSurface;
}

export function adminActionChallenge(input: AdminActionInput): AuthChallenge {
  const expiresAt = new Date(input.now.getTime() + input.ttlMs), surface = input.surface ?? 'admin';
  const message = intentHead(input.domain, input.wallet, input.intent, surface)
    + [`Nonce: ${input.nonce}`, `Issued At: ${input.now.toISOString()}`, `Expiration Time: ${expiresAt.toISOString()}`].join('\n');
  return new AuthChallenge(surface === 'editor' ? editorActionKey(input.wallet) : adminActionKey(input.wallet), message, expiresAt);
}

/** Was this stored message issued for exactly this change (same admin, host, action, ride, decision and note)? */
export const describesIntent = (message: string, domain: string, wallet: string, intent: AdminIntent, surface: ProofSurface = 'admin'): boolean => message.startsWith(intentHead(domain, wallet, intent, surface));

/** What the audit keeps of a signed action. */
export interface AdminProof {
  message: string;
  signature: string;
}
