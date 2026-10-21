/* Minigame catalog shared by the client and the server. Constants only: no answers, no generators.
   Layout objects carry permutations, opaque ids and asset ids. The expected value never rides along. */

export const MG_RULES = 'mg:1';
/** Aliases the server domain imports. Same values, two names, so the wire version cannot drift. */
export const MG_RULES_VERSION = MG_RULES;
export const MG_SALT_VERSION = 'mg:v1';

export const MG_KINDS = Object.freeze([
  'phone-sms', 'seed-words', 'buy-shitcoin', 'address-check', 'sign-or-reject', 'fuel-rugpull', 'gas-priority',
]);
export const MINIGAME_KINDS = MG_KINDS;

/** Issued on a live ride. Everything else can be generated in tests and must not be armed. */
export const MG_ACCEPTED = Object.freeze(['phone-sms']);
export const MINIGAME_ACCEPTED = MG_ACCEPTED;

/** Home-grid ids, length 12. Null is an empty slot. Dock (calls, web, music) is not part of the permutation. */
export const MG_GRID = Object.freeze(['maps', 'wallet', 'radio', 'weather', 'truck', 'chat', 'cam', 'cog', 'swap', 'gulp', 'pike', null]);

/** Which launcher icon wears the badge for a kind. */
export const MG_BADGE_APP = Object.freeze({
  'phone-sms': 'chat',
  'seed-words': 'chat',
  'buy-shitcoin': 'swap',
  'address-check': 'wallet',
  'sign-or-reject': 'wallet',
  'fuel-rugpull': 'wallet',
  'gas-priority': 'wallet',
});

/* phone-sms layout: { threads:[{id, role, previewAsset}], dispatchId, smsAsset, keys:string[10], sendSlot:0|1|2, iconOrder:(string|null)[12], cabAssets:[{id, slot}] }
   seed-words: { mode:'unlock'|'phish', indexes:[n,n,n], options?:[{id, asset}], phraseAsset, noteAsset }
   buy-shitcoin: { trap:boolean, taskAsset, rows:[{id, asset}], amountHintAsset }
   address-check: { taskAsset, pastedAsset, options:[{id, asset}], exact:boolean }  exact is NOT included — the client must not learn it. Options are opaque.
   sign-or-reject: { cardAsset, harmfulLook: omitted }
   fuel-rugpull: { limitAsset, frames:[{id, atMs}] }
   gas-priority: { tableAsset, queueAsset, options:[{id}] }
   The words exact / harmful / answer are comments for the server author. Do not add those fields to a payload. */
