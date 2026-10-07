import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PublicKey, SystemProgram, Transaction, TransactionInstruction, type ParsedTransactionWithMeta } from '@solana/web3.js';
import bs58 from 'bs58';
import { DbService } from '../db/db.service.js';
import { ClockService } from '../clock.service.js';
import { ChainService } from '../solana/chain.service.js';
import { PoolService } from '../pool/pool.service.js';
import { RidesService, view } from './rides.service.js';
import { config } from '../config.js';

export const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

/** null = the transaction pays this order; otherwise why not. Scans ALL top-level instructions (wallets may add compute-budget etc.). */
export function checkPayment(tx: ParsedTransactionWithMeta, wallet: string, treasury: string, lamports: number, memo: string): string | null {
  if (!tx.meta) return 'transaction has no metadata';
  if (tx.meta.err) return 'transaction failed on chain';
  const payer = tx.transaction.message.accountKeys[0];
  if (!payer?.signer || payer.pubkey.toBase58() !== wallet) return 'not signed by your wallet';
  let paid = false, memoOk = false;
  for (const ix of tx.transaction.message.instructions) {
    if (!('parsed' in ix)) continue;
    if (ix.programId.equals(SystemProgram.programId) && ix.parsed?.type === 'transfer') {
      const i = ix.parsed.info;
      if (i?.source === wallet && i?.destination === treasury && Number(i?.lamports) >= lamports) paid = true;
    } else if (ix.programId.equals(MEMO_PROGRAM) && ix.parsed === memo) memoOk = true;
  }
  if (!paid) return 'no transfer of the ordered amount from your wallet to the treasury';
  if (!memoOk) return 'the memo does not match this ride';
  return null;
}

/* Plan A payment: the buyer signs a plain SOL transfer to the treasury with the ride id as a memo; the server verifies it on chain.
   (The Anchor escrow program from the plan needs a Rust/Solana toolchain that is not installed.) */
@Injectable()
export class PaymentsService {
  constructor(private readonly store: DbService, private readonly clock: ClockService, private readonly chain: ChainService, private readonly rides: RidesService, private readonly pool: PoolService) {}

  /** The unsigned transaction to sign. Built per click (a blockhash is only good for ~60–90 s). An EXPIRED quote stops new transactions here – and only here. */
  async instructions(wallet: string, rideId: string) {
    const r = this.rides.row(rideId, wallet), now = this.clock.now();
    if (!config.treasury) throw new ServiceUnavailableException('no treasury configured');
    if (r.status !== 'awaiting_payment') throw new ConflictException(`ride is ${r.status}`);
    if ((r.quote_expires_at ?? 0) <= now) throw new ConflictException('the price quote expired – create the ride again');
    const payer = new PublicKey(wallet), { blockhash, lastValidBlockHeight } = await this.chain.latestBlockhash();
    const tx = new Transaction({ feePayer: payer, recentBlockhash: blockhash })
      .add(SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey(config.treasury), lamports: r.lamports }))
      .add(new TransactionInstruction({ keys: [{ pubkey: payer, isSigner: true, isWritable: false }], programId: MEMO_PROGRAM, data: Buffer.from(r.id) }));
    return {
      treasury: config.treasury, lamports: r.lamports, memo: r.id, quoteExpiresAt: r.quote_expires_at, blockhash, lastValidBlockHeight,
      transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
    };
  }

  /** pending = not visible at `confirmed` yet (retry). A matching payment is honoured even after the quote expired – money in flight must not be refused. */
  async confirm(wallet: string, rideId: string, signature: unknown) {
    let sig = '';
    try { sig = typeof signature === 'string' && bs58.decode(signature).length === 64 ? signature : ''; } catch { /* not base58 */ }
    if (!sig) throw new BadRequestException('signature must be a base58 transaction signature');
    const { db } = this.store, r = this.rides.row(rideId, wallet);
    const mine = db.prepare('SELECT signature FROM payments WHERE ride_id = ?').get(rideId) as { signature: string } | undefined;
    if (mine) { if (mine.signature === sig) return { status: 'paid', ride: view(r) }; throw new ConflictException('this ride is already paid'); }
    if (r.status !== 'awaiting_payment' && r.status !== 'expired') throw new ConflictException(`ride is ${r.status}`);
    if (db.prepare('SELECT 1 FROM payments WHERE signature = ?').get(sig)) throw new ConflictException('this transaction already paid for a ride');

    const tx = await this.chain.parsedTx(sig);
    if (!tx) return { status: 'pending' as const };
    const why = checkPayment(tx, wallet, config.treasury, r.lamports, r.id);
    if (why) throw new BadRequestException(why);

    return this.settle(r, sig);
  }

  /** record the verified payment: the order becomes a ready ride and joins the current round's pool (one transaction) */
  private settle(r: ReturnType<RidesService['row']>, sig: string) {
    const { db } = this.store, wallet = r.wallet, rideId = r.id;
    const now = this.clock.now(), round = this.pool.ensureRound(now);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO payments (signature, ride_id, wallet, lamports, usd, round_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(sig, r.id, wallet, r.lamports, r.price_usd, round.id, now);
      db.prepare("UPDATE rides SET status = 'created', paid_at = ?, round_id = ? WHERE id = ?").run(now, round.id, r.id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw new ConflictException('this transaction already paid for a ride', { cause: e }); }
    return { status: 'paid' as const, ride: view(this.rides.row(rideId, wallet)) };
  }

  /** The buyer paid but the confirm call never came (tab closed, network drop): look through the wallet's recent transactions for one that pays this order. */
  async reconcile(wallet: string, rideId: string) {
    const r = this.rides.row(rideId, wallet);
    if (r.status !== 'awaiting_payment' && r.status !== 'expired') return { status: r.status === 'created' && r.paid_at ? 'paid' : r.status, ride: view(r) };
    for (const { signature: sig, memo } of await this.chain.recentSignatures(wallet)) {
      if (!memo?.includes(r.id)) continue;   // only a transaction carrying this ride id can be its payment – usually 0–1 fetches instead of up to 25
      if (this.store.db.prepare('SELECT 1 FROM payments WHERE signature = ?').get(sig)) continue;
      const tx = await this.chain.parsedTx(sig);
      if (tx && !checkPayment(tx, wallet, config.treasury, r.lamports, r.id)) return this.settle(r, sig);
    }
    return { status: 'not_found' as const };
  }
}