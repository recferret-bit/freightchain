/* English strings for the lobby, the replay panel, receipts and the error codes the server sends. */
import { store } from '../js/util.js';

const en = {
  "consent.title": "REVIEW THE RULES",
  "consent.intro": "Before paid shifts, prizes or rewards, review the Pre-season rules and privacy notice. Training and EASY remain available without acceptance.",
  "consent.draft": "Local devnet preview: these repository texts are drafts with publication details still to be completed.",
  "consent.rules": "Pre-season rules / terms",
  "consent.privacy": "Privacy notice",
  "consent.age": "I am 18 or older",
  "consent.accept": "ACCEPT THESE VERSIONS",
  "consent.decline": "CONTINUE WITHOUT ACCEPTING",
  "consent.saving": "Saving acceptance…",
  "consent.error": "Acceptance could not be saved. Try again.",
  "consent.retry": "Accepted. Repeat your action to continue.",
  "offer.title": "BEFORE A PAID SHIFT",
  "offer.off": "Tick both before a paid shift. A paid button sends you here until they are on.",
  "offer.on": "Both boxes are on. SOL spent on a paid shift can be lost. A prize is not guaranteed.",
  "offer.age": "I AM 18 OR OLDER",
  "offer.ageHint": "Required before any shift that spends SOL.",
  "offer.loss": "SOL SPENT ON A SHIFT CAN BE LOST",
  "offer.lossHint": "A prize is not guaranteed. This is not a deposit or an investment. This build is Solana devnet.",
  'lang.en': 'EN',
  'lobby.tab.new': 'NEW RIDE',
  'lobby.tab.live': 'LIVE',
  'lobby.tab.replays': 'REPLAYS',
  'lobby.tab.board': 'LEADERBOARD',
  'lobby.tab.achievements': 'ACHIEVEMENTS',
  'lobby.tab.garage': 'GARAGE',
  'event.title': 'EVENT TOP-20',
  'event.final': 'EVENT RESULTS',
  'event.pending': 'The table is published after the review: ',
  'event.notScheduled': 'not scheduled',
  'event.finalNote': 'Final list. Prizes are paid manually in USDC; the transaction is linked once recorded.',
  'event.prelimNote': 'Preliminary table, subject to review. Appeals close: ',
  'event.wallet': 'Wallet',
  'event.clean': 'Clean',
  'event.prize': 'Prize (USDC)',
  'event.outside': 'outside the prize standings',
  'event.tx': 'transaction',
  'lobby.tab.profile': 'PROFILE',
  'lobby.signOut': 'SIGN OUT',
  'lobby.training.badge': 'TRAINING · NOT IN REPLAYS',
  'lobby.training.hint': 'Training rides are private: not ranked, no TEN4, never shown in replays.',
  'lobby.tier.free': 'TRAINING',
  'lobby.training.result': 'Training ride – no replay is published.',
  'lobby.replays.footer': 'Replays of finished 1-hour rides. Training rides are never shown. Pool rides appear after the pool\'s review ends.',
  'lobby.replays.emptyMine': 'No replays yet. Your training rides are not shown here.',
  'lobby.replays.poolLocked': 'Public after the review',
  'lobby.live.count': 'on the road',
  'replay.play': 'Play',
  'replay.pause': 'Pause',
  'replay.restart': 'Restart',
  'replay.back': '−10s',
  'replay.forward': '+10s',
  'replay.share': 'Share',
  'replay.mute': 'Mute',
  'replay.fullscreen': 'Fullscreen',
  'replay.camera': 'Camera',
  'replay.speed': 'Speed',
  'replay.gear': 'Gear',
  'replay.damage': 'Damage',
  'replay.progress': 'Route',
  'replay.driver': 'Driver',
  'replay.chat': 'Say something…',
  'replay.send': 'SEND',
  'replay.tip': 'Tip the driver',
  'replay.nothing': 'NOTHING TO WATCH',
  'replay.lobby': 'BACK TO THE LOBBY',
  'receipt.watch': 'WATCH REPLAY',
  'receipt.drive': 'TAKE THE WHEEL (DRIVE)',
  'receipt.loading': 'LOADING RIDE',
  'blink.show': 'SHOW',
  'blink.connect': 'CONNECT WALLET',
  'home.lobby': 'Enter the lobby',
  'home.lead': 'A long-haul replay. Training stays private. Tips go to the driver.',
  'legal.notice': 'Devnet SOL has no cash value. Nothing is signed without your wallet.',
  'error.replay_not_available': 'This replay is not available.',
  'error.replay_locked_until_payout': 'This replay opens after the pool pays out.',
  'error.donation_too_small': 'A tip is at least 0.001 SOL.',
  'error.donation_too_large': 'A tip is at most 1 SOL.',
  'error.too_many_open_orders': 'Three tips are already waiting. Finish one first.',
  'error.pledges_disabled': 'Pledges are turned off.',
  'error.chat_banned': 'Chat is closed for this wallet.',
  'error.chat_link_forbidden': 'Links are not allowed in chat.',
  'error.chat_word_forbidden': 'That word is not allowed in chat.',
  'error.live_rate_limited': 'Slow down — five messages a minute.',
  'error.own_ride': 'That action is not available on your own ride.',
  'error.bad_message': 'That message cannot be posted.',
  'error.donation_expired': 'That tip expired. Start it again.',
  'error.not_found': 'Not found.',
};

export const DICT = { en };

export function resolveLang() {
  return 'en';
}

export function currentLang() {
  return 'en';
}

export function saveLang() {
  store.set('fc_lang', 'en');
  store.set('freightchain.lang', 'en');
}

export function t(key) {
  return DICT.en[key] || key;
}

export function errorText(code) {
  return t(`error.${code}`);
}

export function applyI18n(root = typeof document === 'undefined' ? null : document) {
  if (!root) return 'en';
  if (root.documentElement) root.documentElement.lang = 'en';
  const nodes = root.querySelectorAll ? root.querySelectorAll('[data-i18n]') : [];
  for (const node of nodes) {
    const value = t(node.getAttribute('data-i18n'));
    const attr = node.getAttribute('data-i18n-attr');
    if (attr) node.setAttribute(attr, value);
    else node.textContent = value;
  }
  return 'en';
}

export function bootI18n(root = typeof document === 'undefined' ? null : document) {
  return applyI18n(root);
}
