import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Connection, PublicKey, type ParsedInstruction, type ParsedTransactionWithMeta, type PartiallyDecodedInstruction } from '@solana/web3.js';
import bs58 from 'bs58';
import { HonkChainPort } from '../../application/ports/honk/honk-chain.port.js';
import type { HonkChainBurn, HonkChainPart, HonkChainTx } from '../../domain/honk/chain-tx.js';
import { ServiceUnavailableError } from '../../domain/shared/errors.js';
import { EnvService } from '../config/env.service.js';

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const disc = (name: string): Buffer => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const BURN_DISC = disc('burn');
const BUY_DISC = disc('buy_part');

type Ix = ParsedInstruction | PartiallyDecodedInstruction;

interface TokenEffect {
  kind: 'burn' | 'mint' | 'freeze';
  amount: bigint;
  mint: string;
  authority: string;
  account: string;
}

/** Confirmed TEN4 (`freightchain_honk`) program transaction. No program id: the ledger stands alone and `load` is not used. */
@Injectable()
export class HonkChainAdapter extends HonkChainPort {
  private readonly connection: Connection;
  private readonly program: PublicKey | null;

  constructor(env: EnvService) {
    super();
    this.connection = new Connection(env.solanaRpc, 'confirmed');
    this.program = env.honkProgramId ? new PublicKey(env.honkProgramId) : null;
  }

  programId(): string | null { return this.program?.toBase58() ?? null; }

  async load(signature: string): Promise<HonkChainTx | null> {
    const program = this.program;
    if (!program) return null;
    let tx: ParsedTransactionWithMeta | null;
    try {
      tx = await this.connection.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    } catch {
      throw new ServiceUnavailableError('Solana RPC unavailable', 'honk_chain');
    }
    return tx ? readHonkTx(tx, program) : null;
  }
}

/** Null when the transaction failed. A successful tx still confirms nothing until a burn or a buy matches. */
export function readHonkTx(tx: ParsedTransactionWithMeta, program: PublicKey): HonkChainTx | null {
  if (!tx.meta || tx.meta.err) return null;
  const keys = tx.transaction.message.accountKeys;
  const signers = keys.filter((k) => k.signer).map((k) => k.pubkey.toBase58());
  const honkMint = PublicKey.findProgramAddressSync([Buffer.from('honk-mint')], program)[0].toBase58();
  const burns: HonkChainBurn[] = [];
  const parts: HonkChainPart[] = [];
  const inners = tx.meta.innerInstructions ?? [];
  tx.transaction.message.instructions.forEach((ix, index) => {
    if (!isPartial(ix) || !ix.programId.equals(program)) return;
    const data = Buffer.from(bs58.decode(ix.data));
    const effects = tokenEffects(inners.find((g) => g.index === index)?.instructions ?? []);
    const user = ix.accounts[0]?.toBase58();
    if (!user) return;
    if (data.subarray(0, 8).equals(BURN_DISC) && data.length >= 16 && ix.accounts[1]?.toBase58() === honkMint) {
      const amount = data.readBigUInt64LE(8);
      const burned = sumBurns(effects, honkMint, user);
      if (burned === amount) burns.push({ amount, authority: user });
      return;
    }
    if (!data.subarray(0, 8).equals(BUY_DISC) || data.length < 40 || ix.accounts[1]?.toBase58() !== honkMint) return;
    const nft = ix.accounts[4]?.toBase58();
    const ata = ix.accounts[5]?.toBase58();
    const slot = text16(data.subarray(8, 24));
    const item = text16(data.subarray(24, 40));
    if (!nft || !ata || !slot || !item) return;
    const held = holding(tx, nft, ata);
    parts.push({
      slot, item, buyer: user, mint: nft, burned: sumBurns(effects, honkMint, user),
      frozen: effects.some((e) => e.kind === 'freeze' && e.account === ata && e.mint === nft),
      supply: mintSupply(tx, nft), decimals: held?.decimals ?? -1, holder: held?.owner ?? null,
    });
  });
  return { signers, burns, parts };
}

function isPartial(ix: Ix): ix is PartiallyDecodedInstruction {
  return 'data' in ix && !('parsed' in ix);
}

function text16(buf: Buffer): string {
  const end = buf.indexOf(0);
  return buf.subarray(0, end === -1 ? buf.length : end).toString('utf8');
}

function sumBurns(effects: readonly TokenEffect[], mint: string, authority: string): bigint {
  return effects.filter((e) => e.kind === 'burn' && e.mint === mint && e.authority === authority).reduce((sum, e) => sum + e.amount, 0n);
}

function mintSupply(tx: ParsedTransactionWithMeta, mint: string): bigint {
  return (tx.meta?.postTokenBalances ?? []).filter((b) => b.mint === mint).reduce((sum, b) => sum + BigInt(b.uiTokenAmount.amount), 0n);
}

function holding(tx: ParsedTransactionWithMeta, mint: string, account: string): { owner: string; decimals: number } | null {
  const keys = tx.transaction.message.accountKeys;
  for (const b of tx.meta?.postTokenBalances ?? []) {
    if (b.mint !== mint || keys[b.accountIndex]?.pubkey.toBase58() !== account || !b.owner) continue;
    return { owner: b.owner, decimals: b.uiTokenAmount.decimals };
  }
  return null;
}

function tokenEffects(ixs: readonly Ix[]): TokenEffect[] {
  const out: TokenEffect[] = [];
  for (const ix of ixs) {
    if (ix.programId.toBase58() !== TOKEN_PROGRAM) continue;
    const parsed = parsedEffect(ix);
    if (parsed) { out.push(parsed); continue; }
    const raw = rawEffect(ix);
    if (raw) out.push(raw);
  }
  return out;
}

function parsedEffect(ix: Ix): TokenEffect | null {
  if (!('parsed' in ix) || !ix.parsed || typeof ix.parsed !== 'object') return null;
  const parsed = ix.parsed as { type?: string; info?: Record<string, unknown> };
  const info = parsed.info ?? {};
  const mint = str(info['mint']);
  const account = str(info['account']);
  const authority = str(info['authority']) || str(info['freezeAuthority']) || str(info['mintAuthority']);
  if (parsed.type === 'burn' || parsed.type === 'burnChecked') {
    const amount = asAmount(info);
    if (amount === null || !mint || !authority) return null;
    return { kind: 'burn', amount, mint, authority, account };
  }
  if (parsed.type === 'mintTo' || parsed.type === 'mintToChecked') {
    const amount = asAmount(info);
    const dest = account || str(info['destination']); // mintTo uses `account` in the parsed form
    if (amount === null || !mint || !dest) return null;
    return { kind: 'mint', amount, mint, authority, account: dest };
  }
  if (parsed.type === 'freezeAccount' && mint && account) return { kind: 'freeze', amount: 0n, mint, authority, account };
  return null;
}

function rawEffect(ix: Ix): TokenEffect | null {
  if (!('data' in ix)) return null;
  let data: Buffer;
  try { data = Buffer.from(bs58.decode(ix.data)); } catch { return null; }
  const acc = ix.accounts.map((a) => a.toBase58());
  const tag = data[0];
  if ((tag === 8 || tag === 15) && data.length >= 9 && acc.length >= 3) return { kind: 'burn', amount: data.readBigUInt64LE(1), account: acc[0]!, mint: acc[1]!, authority: acc[2]! };
  if ((tag === 7 || tag === 14) && data.length >= 9 && acc.length >= 2) return { kind: 'mint', amount: data.readBigUInt64LE(1), mint: acc[0]!, account: acc[1]!, authority: acc[2] ?? '' };
  if (tag === 10 && acc.length >= 2) return { kind: 'freeze', amount: 0n, account: acc[0]!, mint: acc[1]!, authority: acc[2] ?? '' };
  return null;
}

function asAmount(info: Record<string, unknown>): bigint | null {
  const token = info['tokenAmount'];
  const raw = info['amount'] ?? (token && typeof token === 'object' ? (token as { amount?: unknown }).amount : undefined);
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  try { return BigInt(raw); } catch { return null; }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
