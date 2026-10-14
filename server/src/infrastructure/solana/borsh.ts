import { PublicKey } from '@solana/web3.js';

/* The slice of Anchor's IDL (spec 0.1.0) and of borsh that the pool program uses – by hand, so the server needs no Anchor SDK: little-endian integers, bool as one
   byte, 32-byte keys, fixed arrays, Vec (u32 length, then the items – v4's Merkle proof), Option (one tag byte), structs in field order. u64 / i64 come out as bigint (the caller decides how to narrow them). */

export type IdlType =
  | 'u8' | 'u16' | 'u32' | 'u64' | 'i64' | 'bool' | 'pubkey'
  | { array: [IdlType, number] }
  | { option: IdlType }
  | { vec: IdlType }
  | { defined: { name: string } };
export interface IdlField { name: string; type: IdlType }
export interface IdlAccountItem { name: string; writable?: boolean; signer?: boolean; address?: string; pda?: unknown; relations?: string[]; optional?: boolean }
export interface IdlInstruction { name: string; discriminator: number[]; accounts: IdlAccountItem[]; args: IdlField[] }
export interface IdlTypeDef { name: string; type: { kind: 'struct'; fields: IdlField[] } }
export interface Idl {
  address: string;
  metadata: { name: string; version: string; spec: string; description?: string };
  instructions: IdlInstruction[];
  accounts: { name: string; discriminator: number[] }[];
  events: { name: string; discriminator: number[] }[];
  errors: { code: number; name: string; msg?: string }[];
  types: IdlTypeDef[];
}

export type BorshValue = number | bigint | boolean | string | Uint8Array | null | BorshStruct;
export interface BorshStruct { [field: string]: BorshValue }

export class BorshReader {
  private at = 0;
  constructor(private readonly buf: Uint8Array) {}

  get offset(): number { return this.at; }

  private take(n: number): Uint8Array {
    if (this.at + n > this.buf.length) throw new RangeError(`borsh: wanted ${n} bytes at ${this.at}, only ${this.buf.length - this.at} left`);
    const out = this.buf.subarray(this.at, this.at + n);
    this.at += n;
    return out;
  }
  private view(n: number): DataView {
    const b = this.take(n);
    return new DataView(b.buffer, b.byteOffset, n);
  }

  read(type: IdlType, types: ReadonlyMap<string, IdlTypeDef>): BorshValue {
    if (typeof type === 'string') {
      switch (type) {
        case 'u8': return this.view(1).getUint8(0);
        case 'u16': return this.view(2).getUint16(0, true);
        case 'u32': return this.view(4).getUint32(0, true);
        case 'u64': return this.view(8).getBigUint64(0, true);
        case 'i64': return this.view(8).getBigInt64(0, true);
        case 'bool': {
          const b = this.view(1).getUint8(0);
          if (b > 1) throw new RangeError(`borsh: bool byte ${b}`);
          return b === 1;
        }
        case 'pubkey': return new PublicKey(this.take(32)).toBase58();
      }
    }
    if ('array' in type) {
      const [inner, len] = type.array;
      if (inner === 'u8') return Uint8Array.from(this.take(len));
      throw new Error(`borsh: arrays of ${JSON.stringify(inner)} are not used by the program`);
    }
    if ('vec' in type) {
      const n = this.view(4).getUint32(0, true);
      if (n > 1024) throw new RangeError(`borsh: vec of ${n}`);
      return Array.from({ length: n }, () => this.read(type.vec, types)) as unknown as BorshValue;
    }
    if ('option' in type) {
      const tag = this.view(1).getUint8(0);
      if (tag > 1) throw new RangeError(`borsh: option tag ${tag}`);
      return tag === 0 ? null : this.read(type.option, types);
    }
    return this.struct(type.defined.name, types);
  }

  struct(name: string, types: ReadonlyMap<string, IdlTypeDef>): BorshStruct {
    const def = types.get(name);
    if (!def) throw new Error(`borsh: unknown type ${name}`);
    const out: BorshStruct = {};
    for (const f of def.type.fields) out[f.name] = this.read(f.type, types);
    return out;
  }
}

export class BorshWriter {
  private readonly parts: Uint8Array[] = [];

  bytes(): Buffer { return Buffer.concat(this.parts); }

  raw(b: Uint8Array | number[]): this { this.parts.push(Uint8Array.from(b)); return this; }

  write(type: IdlType, value: unknown, types: ReadonlyMap<string, IdlTypeDef>, path = 'value'): this {
    if (typeof type === 'string') {
      const int = (bytes: number, signed = false) => {
        const v = typeof value === 'bigint' ? value : typeof value === 'number' && Number.isSafeInteger(value) ? BigInt(value) : null;
        if (v === null) throw new TypeError(`${path}: ${type} needs a whole number, got ${String(value)}`);
        const bits = BigInt(bytes * 8);
        const [min, max] = signed ? [-(1n << (bits - 1n)), (1n << (bits - 1n)) - 1n] : [0n, (1n << bits) - 1n];
        if (v < min || v > max) throw new RangeError(`${path}: ${v} does not fit ${type}`);
        const b = new Uint8Array(bytes);
        let x = signed && v < 0n ? (1n << bits) + v : v;
        for (let i = 0; i < bytes; i++) { b[i] = Number(x & 0xffn); x >>= 8n; }
        return this.raw(b);
      };
      switch (type) {
        case 'u8': return int(1);
        case 'u16': return int(2);
        case 'u32': return int(4);
        case 'u64': return int(8);
        case 'i64': return int(8, true);
        case 'bool':
          if (typeof value !== 'boolean') throw new TypeError(`${path}: bool needs a boolean`);
          return this.raw([value ? 1 : 0]);
        case 'pubkey': return this.raw(new PublicKey(value as string | PublicKey).toBytes());
      }
    }
    if ('array' in type) {
      const [inner, len] = type.array;
      if (inner !== 'u8' || !(value instanceof Uint8Array) || value.length !== len) throw new TypeError(`${path}: needs ${len} bytes`);
      return this.raw(value);
    }
    if ('vec' in type) {
      if (!Array.isArray(value)) throw new TypeError(`${path}: needs an array`);
      this.write('u32', value.length, types, `${path}.length`);
      value.forEach((v, i) => this.write(type.vec, v, types, `${path}[${i}]`));
      return this;
    }
    if ('option' in type) return value === null || value === undefined ? this.raw([0]) : this.raw([1]).write(type.option, value, types, path);
    const def = types.get(type.defined.name);
    if (!def) throw new Error(`borsh: unknown type ${type.defined.name}`);
    const obj = value as Record<string, unknown>;
    for (const f of def.type.fields) this.write(f.type, obj[f.name], types, `${path}.${f.name}`);
    return this;
  }
}
