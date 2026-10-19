import { createHash } from 'node:crypto';
import { Keypair, PublicKey, type ParsedTransactionWithMeta, type PartiallyDecodedInstruction } from '@solana/web3.js';
import bs58 from 'bs58';
import { confirmsHonkBurn, confirmsHonkPart } from '../../../../src/domain/honk/chain-tx.js';
import { HonkChainAdapter, readHonkTx } from '../../../../src/infrastructure/solana/honk-chain.adapter.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';

const PROGRAM = new PublicKey('GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx');
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const disc = (name: string) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const u64 = (n: bigint): Buffer => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };
const text16 = (s: string): Buffer => { const b = Buffer.alloc(16); b.write(s); return b; };
const honkMint = PublicKey.findProgramAddressSync([Buffer.from('honk-mint')], PROGRAM)[0];

const key = (pubkey: PublicKey, signer: boolean) => ({ pubkey, signer, writable: true });
const burnData = (amount: bigint) => bs58.encode(Buffer.concat([disc('burn'), u64(amount)]));
const buyData = (slot: string, item: string) => bs58.encode(Buffer.concat([disc('buy_part'), text16(slot), text16(item)]));

function parsed(type: string, info: Record<string, string>): { program: string; programId: PublicKey; parsed: { type: string; info: Record<string, string> } } {
  return { program: 'spl-token', programId: TOKEN, parsed: { type, info } };
}

function tx(instructions: PartiallyDecodedInstruction[], inner: { index: number; instructions: ReturnType<typeof parsed>[] }[], balances: ParsedTransactionWithMeta['meta'] extends infer M ? M extends { postTokenBalances?: infer B } ? B : never : never = [], err: unknown = null): ParsedTransactionWithMeta {
  const keys = [...new Set(instructions.flatMap((ix) => ix.accounts.map((a) => a.toBase58())))].map((s) => new PublicKey(s));
  return {
    slot: 1, blockTime: 1, transaction: { signatures: ['sig'], message: { accountKeys: keys.map((k) => key(k, true)), instructions, recentBlockhash: 'b' } },
    meta: { err, fee: 1, preBalances: [], postBalances: [], innerInstructions: inner, logMessages: [], preTokenBalances: [], postTokenBalances: balances ?? [] },
  } as unknown as ParsedTransactionWithMeta;
}

describe('readHonkTx', () => {
  const buyer = Keypair.generate().publicKey;
  const ata = Keypair.generate().publicKey;
  const nft = Keypair.generate().publicKey;
  const nftAta = Keypair.generate().publicKey;
  const other = Keypair.generate().publicKey;

  it('a confirmed program burn of exactly 1 HONK by the signer counts, and a failed or foreign burn does not', () => {
    const ix = { programId: PROGRAM, accounts: [buyer, honkMint, ata, TOKEN], data: burnData(1_000_000n) };
    const inner = parsed('burn', { account: ata.toBase58(), mint: honkMint.toBase58(), authority: buyer.toBase58(), amount: '1000000' });
    const good = readHonkTx(tx([ix], [{ index: 0, instructions: [inner] }]), PROGRAM);
    expect(good && confirmsHonkBurn(good, buyer.toBase58(), 1_000_000n)).toBe(true);
    expect(good && confirmsHonkBurn(good, buyer.toBase58(), 10_000_000n)).toBe(false);
    const raw = { programId: TOKEN, accounts: [ata, honkMint, buyer], data: bs58.encode(Buffer.concat([Buffer.from([8]), u64(25_000_000n)])) };
    const weather = { programId: PROGRAM, accounts: [buyer, honkMint, ata, TOKEN], data: burnData(25_000_000n) };
    const fromRaw = readHonkTx(tx([weather], [{ index: 0, instructions: [raw as unknown as ReturnType<typeof parsed>] }]), PROGRAM);
    expect(fromRaw && confirmsHonkBurn(fromRaw, buyer.toBase58(), 25_000_000n)).toBe(true);
    expect(readHonkTx(tx([ix], [{ index: 0, instructions: [inner] }], [], { InstructionError: [0, 'Custom'] }), PROGRAM)).toBeNull();
    const stranger = parsed('burn', { account: ata.toBase58(), mint: honkMint.toBase58(), authority: other.toBase58(), amount: '1000000' });
    const notTheirs = readHonkTx(tx([ix], [{ index: 0, instructions: [stranger] }]), PROGRAM);
    expect(notTheirs && confirmsHonkBurn(notTheirs, buyer.toBase58(), 1_000_000n)).toBe(false);
  });

  it('buy_part of that slot and item burns the catalog price and mints a frozen supply-1 token to the buyer', () => {
    const buy = { programId: PROGRAM, accounts: [buyer, honkMint, ata, other, nft, nftAta, other, TOKEN, other, other], data: buyData('wheel', 'gold') };
    const skip = { programId: other, accounts: [], data: bs58.encode(Buffer.from([1])) };
    const inner = [
      parsed('burn', { account: ata.toBase58(), mint: honkMint.toBase58(), authority: buyer.toBase58(), amount: '260000000' }),
      parsed('mintTo', { mint: nft.toBase58(), account: nftAta.toBase58(), amount: '1' }),
      parsed('freezeAccount', { account: nftAta.toBase58(), mint: nft.toBase58(), freezeAuthority: other.toBase58() }),
    ];
    const balances = [{ accountIndex: 5, mint: nft.toBase58(), owner: buyer.toBase58(), uiTokenAmount: { amount: '1', decimals: 0, uiAmount: 1 } }];
    const built = tx([skip, buy], [{ index: 1, instructions: inner }], balances as never);
    const read = readHonkTx(built, PROGRAM);
    expect(read && confirmsHonkPart(read, buyer.toBase58(), 'wheel', 'gold', 260_000_000n)).toBe(nft.toBase58());
    expect(read && confirmsHonkPart(read, buyer.toBase58(), 'wheel', 'ivory', 65_000_000n)).toBeNull();
    expect(read && confirmsHonkPart(read, other.toBase58(), 'wheel', 'gold', 260_000_000n)).toBeNull();
    const thawed = readHonkTx(tx([skip, buy], [{ index: 1, instructions: inner.slice(0, 2) }], balances as never), PROGRAM);
    expect(thawed && confirmsHonkPart(thawed, buyer.toBase58(), 'wheel', 'gold', 260_000_000n)).toBeNull();
  });
});

describe('HonkChainAdapter', () => {
  const env = (honkProgramId?: string) => ({ solanaRpc: 'http://127.0.0.1:1', honkProgramId }) as EnvService;

  it('is unconfigured without a program id and does not read the RPC', async () => {
    const a = new HonkChainAdapter(env());
    expect(a.programId()).toBeNull();
    await expect(a.load('sig')).resolves.toBeNull();
    expect(new HonkChainAdapter(env(PROGRAM.toBase58())).programId()).toBe(PROGRAM.toBase58());
  });
});
