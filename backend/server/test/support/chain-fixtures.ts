import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SERVER_DIR } from '../architecture/source-files.js';

/* Real pool-program output recorded on LiteSVM by programs/freightchain_pools/tests/export_fixtures.rs (regenerate there; keys are random per run).
   u64 values are strings, i64 values unix seconds, order ids base64. */
export interface FixtureMeta { pubkey: string; isSigner: boolean; isWritable: boolean }
export interface FixtureInstruction { name: string; programId: string; accounts: FixtureMeta[]; data: string; args: Record<string, unknown> }
export interface FixtureEvent { kind: string; [field: string]: unknown }
export interface FixtureTx { name: string; signature: string; slot: number; feePayer: string; computeUnits: number; err: string | null; instructions: FixtureInstruction[]; logs: string[]; events: FixtureEvent[] }
export interface FixtureAccount { name: string; address: string; owner: string; lamports: string; data: string; decoded: Record<string, unknown> & { type: string } }
export interface PoolProgramFixture {
  programId: string;
  rentMin: string;
  configAddress: string;
  keys: Record<'authority' | 'cranker' | 'a' | 'b' | 'c' | 'd' | 'gas' | 'brand' | 'winner' | 'nextAdmin' | 'payout' | 'feeTreasury' | 'seedTreasury' | 'platformTreasury', string>;
  transactions: FixtureTx[];
  accounts: FixtureAccount[];
}

let cached: PoolProgramFixture | undefined;
export const poolProgramFixture = (): PoolProgramFixture =>
  (cached ??= JSON.parse(readFileSync(join(SERVER_DIR, 'test/fixtures/chain/pool-program.json'), 'utf8')) as PoolProgramFixture);

export const fixtureTx = (name: string): FixtureTx => {
  const t = poolProgramFixture().transactions.find((x) => x.name === name || x.name.startsWith(name));
  if (!t) throw new Error(`no fixture transaction ${name}`);
  return t;
};
export const fixtureAccount = (name: string): FixtureAccount => {
  const a = poolProgramFixture().accounts.find((x) => x.name === name);
  if (!a) throw new Error(`no fixture account ${name}`);
  return a;
};

/** A Rust-decoded event in the domain's shape (what the TS decoder must produce): u64 strings → numbers, unix seconds → Date, base64 order id → uuid. */
export function expectedEvent(e: FixtureEvent): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    if (k === 'orderId') {
      const hex = Buffer.from(String(v), 'base64').toString('hex');
      out[k] = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    } else if (['opensAt', 'lastStartAt', 'periodSecs', 'startBufferSecs', 'prepDeadline', 'playDeadline', 'payoutAt', 'nextOpenAt', 'saleSecs', 'playSecs', 'verifySecs', 'at', 'createdAt', 'recordedAt', 'committedAt', 'payFrom', 'settleFrom', 'minReviewSecs', 'minFinishSecs'].includes(k)) out[k] = new Date(Number(v) * 1000); // i64 decodes as a Date (durations too)
    else if (k === 'paidMask') out[k] = BigInt(String(v));   // a u64 bitfield stays exact (the codec's BITFIELDS)
    else if (typeof v === 'string' && /^\d+$/.test(v)) out[k] = Number(v);
    else out[k] = v;
  }
  return out;
}
