import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Keypair } from '@solana/web3.js';
import { POOL_PROGRAM_IDL } from '../../../../src/infrastructure/solana/pool-program.idl.js';
import { PoolProgramCodec, UnrepresentableValueError } from '../../../../src/infrastructure/solana/pool-program.codec.js';
import { BorshReader, BorshWriter } from '../../../../src/infrastructure/solana/borsh.js';
import { SERVER_DIR } from '../../../architecture/source-files.js';
import { CHAIN_EVENT_KINDS } from '../../../../src/domain/economy/chain-events.js';
import { expectedEvent, fixtureAccount, fixtureTx, poolProgramFixture } from '../../../support/chain-fixtures.js';

/* The codec against REAL program output (LiteSVM, tests/export_fixtures.rs): every event the program logged decodes to what the program's own Rust types say,
   every instruction it accepted re-encodes byte for byte, every account decodes field for field. */
const fx = poolProgramFixture();
const codec = new PoolProgramCodec(fx.programId);
const b64 = (s: string) => Buffer.from(s, 'base64');

/** fixture args (camelCase, u64 strings, base64 ids) → the IDL's snake_case instruction args */
function idlArgs(name: string, a: Record<string, unknown>): Record<string, unknown> {
  switch (name) {
    case 'buy_ticket': return { pool_id: a['poolId'], qty: a['qty'], order_id: b64(String(a['orderId'])) };
    case 'sponsor': return { pool_id: a['poolId'], lamports: BigInt(String(a['lamports'])) };
    case 'pay_prize': return { pool_id: a['poolId'], lamports: BigInt(String(a['lamports'])), rank: a['rank'] };
    case 'create_pool': return { params: { tier: a['tier'], price_lamports: BigInt(String(a['priceLamports'])), min_tickets: a['minTickets'], max_tickets: a['maxTickets'], max_per_wallet: a['maxPerWallet'],
      prep_deadline: BigInt(Number(a['prepDeadline'])), play_deadline: BigInt(Number(a['playDeadline'])), payout_at: BigInt(Number(a['payoutAt'])), prize_bps: a['prizeBps'], seed_bps: a['seedBps'], fee_bps: a['feeBps'],
      seed_commitment: b64(String(a['seedCommitment'])) } };
    case 'set_series': return { params: { tier: a['tier'], enabled: a['enabled'], price_lamports: BigInt(String(a['priceLamports'])), min_tickets: a['minTickets'], max_tickets: a['maxTickets'],
      max_per_wallet: a['maxPerWallet'], sale_secs: BigInt(Number(a['saleSecs'])), play_secs: BigInt(Number(a['playSecs'])), verify_secs: BigInt(Number(a['verifySecs'])),
      prize_bps: a['prizeBps'], seed_bps: a['seedBps'], fee_bps: a['feeBps'], start_at: BigInt(Number(a['startAt'])) } };
    case 'open_next_pool': return { tier: a['tier'], seed_commitment: b64(String(a['seedCommitment'])) };
    case 'set_payout_authority': return { payout_authority: a['payoutAuthority'] };
    case 'propose_authority': return { new_authority: fx.keys.nextAdmin };
    case 'accept_authority': return {};
    default: return { pool_id: a['poolId'] }; // fail_pool, refund, close_pool, close_ticket, cancel_pool, expire_pool
  }
}

describe('pool program IDL (vendored)', () => {
  it('is the committed IDL without its doc comments', () => {
    const strip = (v: unknown): unknown => (Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'docs').map(([k, x]) => [k, strip(x)])) : v);
    const committed = JSON.parse(readFileSync(join(SERVER_DIR, '../programs/freightchain-pools/idl/freightchain_pools.json'), 'utf8')) as unknown;
    expect(POOL_PROGRAM_IDL).toEqual(strip(committed)); // differs → node scripts/vendor-idl.mjs
    expect(POOL_PROGRAM_IDL.address).toBe(fx.programId);
  });
});

describe('PoolProgramCodec – events from real logs', () => {
  for (const tx of fx.transactions) {
    it(`${tx.name}: decodes what the program says it emitted`, () => {
      const records = codec.poolEvents(tx.logs, tx.signature, tx.slot);
      if (records === 'truncated') throw new Error('unexpected truncation');
      const isPool = (k: string) => (CHAIN_EVENT_KINDS as readonly string[]).includes(k); // Authority* / SeriesSet / PayoutAuthoritySet are program events, not pool events
      const pool = tx.events.filter((e) => isPool(e.kind));
      expect(records.map((r) => r.kind)).toEqual(pool.map((e) => e.kind));
      records.forEach((r, i) => {
        expect(r).toMatchObject({ signature: tx.signature, slot: tx.slot });
        expect(r).toEqual({ ...expectedEvent(pool[i]!), signature: tx.signature, slot: tx.slot, index: r.index });
      });
      // index = position among the program's Program data lines (skipped kinds count)
      expect(records.map((r) => r.index)).toEqual(tx.events.map((e, i) => (isPool(e.kind) ? i : -1)).filter((i) => i >= 0));
    });
  }

  it('skips the authority handover (program events, not pool events) but still sees them as program data', () => {
    const t = fixtureTx('propose_authority');
    expect(codec.poolEvents(t.logs, t.signature, t.slot)).toEqual([]);
    const lines = codec.programData(t.logs);
    expect(lines !== 'truncated' && codec.decodeEvent(lines[0]!.bytes)?.name).toBe('AuthorityProposed');
  });

  it('ignores a forged event: a TicketBought logged by ANOTHER program in the same transaction', () => {
    const real = fixtureTx('buy_ticket self-paid');
    const data = real.logs.find((l) => l.startsWith('Program data: '))!;
    const evil = Keypair.generate().publicKey.toBase58();
    const forged = [`Program ${evil} invoke [1]`, data, `Program ${evil} success`, ...real.logs, `Program ${evil} invoke [1]`, `Program ${fx.programId} invoke [2]`, `Program ${fx.programId} success`, data, `Program ${evil} success`];
    const records = codec.poolEvents(forged, 'sig', 1);
    expect(records !== 'truncated' && records.map((r) => r.kind)).toEqual(['TicketBought', 'PoolActivated']);
    expect(codec.poolEvents([data], 'sig', 1)).toEqual([]); // no invoke frame at all
  });

  it('a truncated log is reported, not half-read', () => {
    expect(codec.poolEvents([...fixtureTx('sponsor').logs, 'Log truncated'], 'sig', 1)).toBe('truncated');
  });

  it('a u64 the server cannot hold exactly is refused, not rounded', () => {
    const ev = POOL_PROGRAM_IDL.events.find((e) => e.name === 'Sponsored')!;
    const bytes = new BorshWriter().raw(ev.discriminator).write('u32', 1, new Map()).write('pubkey', Keypair.generate().publicKey.toBase58(), new Map())
      .write('u64', 2n ** 53n, new Map()).write('u64', 1n, new Map()).bytes();
    expect(() => codec.decodeEvent(bytes)).toThrow(UnrepresentableValueError);
    expect(codec.decodeEvent(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
  });
});

describe('PoolProgramCodec – instructions', () => {
  const all = fx.transactions.flatMap((t) => t.instructions);

  it('covers every instruction the server builds', () => {
    for (const n of ['buy_ticket', 'fail_pool', 'refund', 'pay_prize', 'close_pool']) expect(all.some((i) => i.name === n), n).toBe(true);
  });

  for (const ix of all.filter((i, k) => all.findIndex((j) => j.name === i.name) === k)) {
    it(`${ix.name}: same data bytes and account metas as Anchor's InstructionData / ToAccountMetas`, () => {
      const idl = POOL_PROGRAM_IDL.instructions.find((i) => i.name === ix.name)!;
      const accounts = Object.fromEntries(idl.accounts.map((a, k) => [a.name, ix.accounts[k]!.pubkey]));
      const built = codec.instruction(ix.name, accounts, idlArgs(ix.name, ix.args));
      expect(built.data.toString('base64')).toBe(ix.data);
      expect(built.programId.toBase58()).toBe(ix.programId);
      expect(built.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable }))).toEqual(ix.accounts);
    });
  }

  it('derives the PDAs the program checks', () => {
    const buy = fixtureTx('buy_ticket sponsored').instructions[0]!;
    const poolId = Number(buy.args['poolId']);
    expect(codec.configPda().toBase58()).toBe(fx.configAddress);
    expect(codec.poolPda(poolId).toBase58()).toBe(buy.accounts[3]!.pubkey);
    expect(codec.vaultPda(poolId).toBase58()).toBe(buy.accounts[4]!.pubkey);
    expect(codec.ticketPda(poolId, fx.keys.a).toBase58()).toBe(buy.accounts[5]!.pubkey);
    const pay = fixtureTx('pay_prize').instructions[0]!;
    expect(codec.attestationPda(0, fx.keys.winner).toBase58()).toBe(pay.accounts[5]!.pubkey);
    const rideId = Buffer.alloc(32, 7);
    const pledge = codec.pledgePda(rideId, fx.keys.a);
    expect(pledge.toBase58()).toBeTruthy();
    expect(() => codec.pledgePda(Buffer.alloc(16), fx.keys.a)).toThrow(/32 bytes/);
  });

  it('refuses missing accounts and out-of-range args', () => {
    expect(() => codec.instruction('fail_pool', {}, { pool_id: 1 })).toThrow(/account caller missing/);
    expect(() => codec.encodeData('pay_prize', { pool_id: 1, lamports: -1n, rank: 1 })).toThrow(RangeError);
    expect(() => codec.encodeData('buy_ticket', { pool_id: 1, qty: 1, order_id: new Uint8Array(15) })).toThrow(/16 bytes/);
    expect(() => codec.encodeData('nope', {})).toThrow(/no instruction/);
  });
});

describe('PoolProgramCodec – accounts', () => {
  for (const a of fx.accounts) {
    it(`${a.name}: decodes field for field`, () => {
      const got = codec.decodeAccount(a.decoded.type as 'Pool' | 'Ticket' | 'Config' | 'Series', b64(a.data));
      const { type: _type, ...fields } = a.decoded;
      expect(got).toEqual(expectedEvent(fields as never));
    });
  }

  it('wrong discriminator or short data → null', () => {
    expect(codec.decodeAccount('Pool', b64(fixtureAccount('config').data))).toBeNull();
    expect(codec.decodeAccount('Pool', b64(fixtureAccount('pool 0 active').data).subarray(0, 40))).toBeNull();
  });

  it('error names come from the IDL', () => {
    expect(codec.errorName(6007)).toMatch(/^SoldOut: /);
    expect(codec.errorName(1)).toBeNull();
  });
});

describe('borsh', () => {
  it('round-trips the integer edges and options', () => {
    const types = new Map();
    const w = new BorshWriter().write('i64', -5n, types).write('u16', 65535, types).write({ option: 'u16' }, null, types).write({ option: 'bool' }, true, types);
    const r = new BorshReader(w.bytes());
    expect([r.read('i64', types), r.read('u16', types), r.read({ option: 'u16' }, types), r.read({ option: 'bool' }, types)]).toEqual([-5n, 65535, null, true]);
    expect(() => new BorshReader(Buffer.from([2])).read('bool', types)).toThrow(RangeError);
    expect(() => new BorshReader(Buffer.from([1])).read('u32', types)).toThrow(RangeError);
    expect(() => new BorshWriter().write('u8', 256, types)).toThrow(RangeError);
    expect(() => new BorshWriter().write('u8', 1.5, types)).toThrow(TypeError);
  });
});
