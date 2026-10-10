import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import type { ChainEventKind, ChainEventRecord } from '../../domain/economy/chain-events.js';
import { CHAIN_EVENT_KINDS } from '../../domain/economy/chain-events.js';
import { orderIdFromBytes } from '../../domain/economy/ticket-purchase-verification.js';
import { BorshReader, BorshWriter, type BorshStruct, type BorshValue, type IdlField, type IdlType, type IdlTypeDef } from './borsh.js';
import { POOL_PROGRAM_IDL } from './pool-program.idl.js';

/* Everything the server knows about the pool program's bytes, driven by the committed IDL (discriminators included – nothing is hashed here):
   instruction data + account metas, account and event decoding, PDAs, error names, and the log walk that attributes `Program data:` lines to the program.
   The specs check all of it against real LiteSVM output (server/test/fixtures/chain/pool-program.json). */

const IDL = POOL_PROGRAM_IDL;
const TYPES: ReadonlyMap<string, IdlTypeDef> = new Map(IDL.types.map((t) => [t.name, t]));
const sameBytes = (a: Uint8Array, b: readonly number[]) => a.length >= b.length && b.every((v, i) => a[i] === v);
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const u32le = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };

/** A value the program wrote that the server cannot represent exactly (a u64 above 2^53): the whole transaction is treated as invalid, never rounded. */
export class UnrepresentableValueError extends Error {}

/** IDL value → domain value: u64 → exact number, i64 → Date (unix seconds), [u8; 16] → uuid, keys stay base58, nested structs recurse. Field names → camelCase. */
function toDomain(fields: IdlField[], raw: BorshStruct, where: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) out[camel(f.name)] = convert(f.type, raw[f.name] ?? null, `${where}.${f.name}`);
  return out;
}
function convert(type: IdlType, v: BorshValue, where: string): unknown {
  if (type === 'u64') {
    const n = v as bigint;
    if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new UnrepresentableValueError(`${where} = ${n} is above 2^53`);
    return Number(n);
  }
  if (type === 'i64') return new Date(Number(v as bigint) * 1000);
  if (typeof type === 'object' && 'array' in type) return orderIdFromBytes(v as Uint8Array);
  if (typeof type === 'object' && 'option' in type) return v === null ? null : convert(type.option, v, where);
  if (typeof type === 'object' && 'defined' in type) return toDomain(TYPES.get(type.defined.name)!.type.fields, v as BorshStruct, where);
  return v;
}

export type PoolAccountName = 'Pool' | 'Ticket' | 'Config' | 'Series';
export type AccountKeys = Record<string, PublicKey | string>;

export interface ProgramDataLine {
  /** position among the program's `Program data:` lines of the transaction */
  index: number;
  bytes: Buffer;
}

export class PoolProgramCodec {
  readonly programId: PublicKey;

  constructor(programId: string) {
    this.programId = new PublicKey(programId);
  }

  // ---- PDAs (README "Accounts")
  configPda(): PublicKey { return PublicKey.findProgramAddressSync([Buffer.from('config')], this.programId)[0]; }
  poolPda(poolId: number): PublicKey { return PublicKey.findProgramAddressSync([Buffer.from('pool'), u32le(poolId)], this.programId)[0]; }
  vaultPda(poolId: number): PublicKey { return PublicKey.findProgramAddressSync([Buffer.from('vault'), u32le(poolId)], this.programId)[0]; }
  seriesPda(tier: number): PublicKey { return PublicKey.findProgramAddressSync([Buffer.from('series'), Buffer.from([tier])], this.programId)[0]; }
  ticketPda(poolId: number, buyer: string | PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from('ticket'), this.poolPda(poolId).toBuffer(), new PublicKey(buyer).toBuffer()], this.programId)[0];
  }

  /** discriminator + borsh args, in the IDL's order (args keyed by their IDL snake_case names) */
  encodeData(name: string, args: Record<string, unknown>): Buffer {
    const ix = IDL.instructions.find((i) => i.name === name);
    if (!ix) throw new Error(`no instruction ${name} in the IDL`);
    const w = new BorshWriter().raw(ix.discriminator);
    for (const a of ix.args) w.write(a.type, args[a.name], TYPES, a.name);
    return w.bytes();
  }

  /** The instruction with its account metas in the IDL's order and with the IDL's signer / writable flags (fixed addresses such as the system program filled in). */
  instruction(name: string, accounts: AccountKeys, args: Record<string, unknown>): TransactionInstruction {
    const ix = IDL.instructions.find((i) => i.name === name);
    if (!ix) throw new Error(`no instruction ${name} in the IDL`);
    const keys = ix.accounts.map((a) => {
      const key = a.address ?? accounts[a.name];
      if (key === undefined) throw new Error(`${name}: account ${a.name} missing`);
      return { pubkey: new PublicKey(key), isSigner: a.signer === true, isWritable: a.writable === true };
    });
    return new TransactionInstruction({ programId: this.programId, keys, data: this.encodeData(name, args) });
  }

  /** null when the bytes are not that account (wrong discriminator or too short) */
  decodeAccount(name: PoolAccountName, data: Uint8Array): Record<string, unknown> | null {
    const acc = IDL.accounts.find((a) => a.name === name)!;
    if (!sameBytes(data, acc.discriminator)) return null;
    try {
      const raw = new BorshReader(data.subarray(8)).struct(name, TYPES);
      return toDomain(TYPES.get(name)!.type.fields, raw, name);
    } catch (e) {
      if (e instanceof UnrepresentableValueError) throw e;
      return null;
    }
  }

  /**
   * The `Program data:` lines THIS program wrote, attributed through the invoke stack (`Program <id> invoke [n]` … `success` / `failed`): a line logged by any
   * other program – one that copied our discriminators to forge a TicketBought – is not ours and is ignored. 'truncated' when the runtime cut the logs
   * (events may be missing, so nothing in them can be trusted to be complete).
   */
  programData(logs: readonly string[]): ProgramDataLine[] | 'truncated' {
    const me = this.programId.toBase58();
    const stack: string[] = [];
    const out: ProgramDataLine[] = [];
    for (const line of logs) {
      if (line.startsWith('Log truncated')) return 'truncated';
      const invoke = /^Program (\w+) invoke \[\d+\]$/.exec(line);
      if (invoke) { stack.push(invoke[1]!); continue; }
      if (/^Program \w+ (success|failed)/.test(line)) { stack.pop(); continue; }
      if (line.startsWith('Program data: ') && stack.at(-1) === me) out.push({ index: out.length, bytes: Buffer.from(line.slice('Program data: '.length).trim(), 'base64') });
    }
    return out;
  }

  /** One event: its IDL name and domain fields; null for bytes that match no event of the IDL. */
  decodeEvent(bytes: Uint8Array): { name: string; fields: Record<string, unknown> } | null {
    const ev = IDL.events.find((e) => sameBytes(bytes, e.discriminator));
    if (!ev) return null;
    const def = TYPES.get(ev.name)!;
    return { name: ev.name, fields: toDomain(def.type.fields, new BorshReader(bytes.subarray(8)).struct(ev.name, TYPES), ev.name) };
  }

  /** The POOL events of a transaction's logs, in order. Authority* (and anything unknown) are skipped but keep their index. */
  poolEvents(logs: readonly string[], signature: string, slot: number): ChainEventRecord[] | 'truncated' {
    const lines = this.programData(logs);
    if (lines === 'truncated') return lines;
    const out: ChainEventRecord[] = [];
    for (const { index, bytes } of lines) {
      const ev = this.decodeEvent(bytes);
      if (!ev || !(CHAIN_EVENT_KINDS as readonly string[]).includes(ev.name)) continue;
      out.push({ ...ev.fields, kind: ev.name as ChainEventKind, signature, index, slot } as ChainEventRecord);
    }
    return out;
  }

  /** "SoldOut: …" for the program's custom error codes (6000 + index), else null */
  errorName(code: number): string | null {
    const e = IDL.errors.find((x) => x.code === code);
    return e ? `${e.name}${e.msg ? `: ${e.msg}` : ''}` : null;
  }
}
