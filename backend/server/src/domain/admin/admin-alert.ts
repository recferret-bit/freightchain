import type { AdminActionRecord } from './admin.dto.js';
import { MONEY_SETTING_KEYS } from './dual-approval.js';
import type { AlertRecord } from './privileged-records.js';

/** Actions that enqueue an operator alert in the same write as the audit row. */
const CRITICAL = new Set([
  'auth.signin', 'auth.fail', 'auth.fail.burst', 'auth.logout', 'editor.signin',
  'setting.update', 'verdict.override', 'verdict.rejudge', 'verdict.rejudge-bulk',
  'promo.create', 'promo.disable', 'pool.hold', 'pool.release', 'free_rides.adjust',
  'chat.hide', 'chat.ban', 'pool.rules', 'program.config', 'proposal.approve', 'pending_approval',
  'entity.publish',
]);

const MONEY = new Set(['verdict.override', 'verdict.rejudge', 'pool.hold', 'pool.release', 'verdict.rejudge-bulk']);

const shortWallet = (wallet: string): string => (wallet.length > 12 ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : wallet);

function moneyOf(record: AdminActionRecord): boolean {
  if (MONEY.has(record.action) || record.action === 'cli.pool:payout') return true;
  if (record.action === 'setting.update') return MONEY_SETTING_KEYS.has(record.target);
  if (record.action === 'promo.create') {
    const effect = record.detail.effect;
    return typeof effect === 'object' && effect !== null && (effect as { kind?: unknown }).kind === 'tickets';
  }
  return false;
}

/** The Telegram row for one audit write, or null when the action is not on the alert list. */
export function alertForAudit(record: AdminActionRecord, id: string): AlertRecord | null {
  const cli = record.action.startsWith('cli.');
  if (!cli && !CRITICAL.has(record.action)) return null;
  const money = moneyOf(record);
  const text = `${money ? 'MONEY ' : ''}${record.action} ${record.target} by ${shortWallet(record.wallet)}`.slice(0, 400);
  return {
    id, kind: record.action, text, money, status: 'pending', attempts: 0,
    nextAttemptAt: record.at, lastError: null, createdAt: record.at, sentAt: null, requestId: record.requestId,
  };
}
