import { Injectable } from '@nestjs/common';
import { Connection, Keypair, PublicKey, type Transaction, type TransactionError } from '@solana/web3.js';
import bs58 from 'bs58';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ReferralEmissionPort, type ReferralPayment, type ReferralSettlement } from '../../application/ports/honk/referral-emission.port.js';
import { EnvService } from '../config/env.service.js';
import { parseKeypair } from './program-chain.adapter.js';

const PROGRAM = new PublicKey('GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx');
const discriminator = (name: string) => createHash('sha256').update(`account:${name}`).digest().subarray(0, 8);
const CONFIG = discriminator('Config'), RECEIPT = discriminator('ReferralMint');
const customCode = (error: TransactionError | null): number | null => {
  if (!error || typeof error !== 'object' || !('InstructionError' in error)) return null;
  const instruction = error.InstructionError;
  if (!Array.isArray(instruction) || instruction[0] !== 1) return null;
  const cause: unknown = instruction[1];
  return cause && typeof cause === 'object' && 'Custom' in cause && typeof cause.Custom === 'number' ? cause.Custom : null;
};
const capped = (code: number | null): ReferralSettlement | null => {
  if (code === 6000 || code === 6006) return { kind: 'capped', reason: 'emission' };
  if (code === 6007) return { kind: 'capped', reason: 'monthly' };
  if (code === 6008) return { kind: 'capped', reason: 'wallet' };
  return null;
};

/** A receipt proves payment; a confirmed failed signature proves a cap refusal. Unknown sends stay pending. */
@Injectable()
export class ReferralEmissionAdapter extends ReferralEmissionPort {
  private readonly key: Keypair | null;
  constructor(private readonly env: EnvService) {
    super();
    this.key = env.honkEmitterSecret ? parseKeypair(env.honkEmitterSecret) : null;
  }
  enabled(): boolean { return this.key !== null && !!this.env.honkProgramId; }

  async settle(payment: ReferralPayment): Promise<ReferralSettlement> {
    if (!this.enabled() || this.env.honkProgramId !== PROGRAM.toBase58() || !['50000000', '100000000'].includes(String(payment.baseAmount))) throw new Error('invalid referral emitter or milestone');
    const key = this.key!, recipient = new PublicKey(payment.wallet);
    const reward = createHash('sha256').update(payment.rewardId).digest().subarray(0, 16);
    const [receipt] = PublicKey.findProgramAddressSync([Buffer.from('referral-mint'), reward], PROGRAM);
    const connection = new Connection(this.env.solanaRpc, 'confirmed');
    const readReceipt = async (): Promise<ReferralSettlement | null> => {
      const account = await connection.getAccountInfo(receipt, 'confirmed');
      if (!account) return null;
      const d = account.data;
      if (!account.owner.equals(PROGRAM) || d.length !== 50 || !d.subarray(0, 8).equals(RECEIPT) || !d.subarray(8, 40).equals(recipient.toBuffer())) throw new Error('referral receipt mismatch');
      const amount = d.readBigUInt64LE(40);
      if (amount <= 0n || amount > payment.baseAmount) throw new Error('referral receipt amount mismatch');
      return { kind: 'paid', amount };
    };
    const existing = await readReceipt();
    if (existing) return existing;
    if (payment.submitted) {
      const prior = (await connection.getSignatureStatuses([payment.submitted.signature], { searchTransactionHistory: true })).value[0];
      if (prior && ['confirmed', 'finalized'].includes(prior.confirmationStatus ?? '')) {
        const refusal = capped(customCode(prior.err));
        if (refusal) return refusal;
        // A midnight rollover may invalidate the old month argument; a fresh signed transaction can retry it.
        if (customCode(prior.err) !== 6014) throw new Error(prior.err ? 'referral transaction failed' : 'referral receipt not yet visible');
      } else if (prior || await connection.getBlockHeight('finalized') <= payment.submitted.lastValidBlockHeight) {
        throw new Error('referral transaction still pending');
      }
    }
    const [configAddress] = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM);
    const config = await connection.getAccountInfo(configAddress, 'confirmed');
    if (!config || !config.owner.equals(PROGRAM) || config.data.length !== 211 || !config.data.subarray(0, 8).equals(CONFIG) || !config.data.subarray(9, 41).equals(key.publicKey.toBuffer())) throw new Error('referral program configuration mismatch');
    const opened = Number(config.data.readBigInt64LE(187));
    const monthIndex = Math.floor((payment.now.getTime() / 1000 - opened) / 2_592_000);
    if (!Number.isSafeInteger(monthIndex) || monthIndex < 0) throw new Error('referral program is not open');
    const latest = await connection.getLatestBlockhash('confirmed');
    const mod = await import(pathToFileURL(join(process.cwd(), 'scripts', 'honk-program.mjs')).href) as {
      referralPaymentTransaction(input: { emitter: Keypair; recipient: PublicKey; rewardId: Buffer; baseAmount: bigint; monthIndex: number; blockhash: string; lastValidBlockHeight: number }): Transaction;
    };
    const transaction = mod.referralPaymentTransaction({ emitter: key, recipient, rewardId: reward, baseAmount: payment.baseAmount, monthIndex, ...latest });
    if (!transaction.signature) throw new Error('referral transaction was not signed');
    const signature = bs58.encode(transaction.signature);
    await payment.onSubmitted({ signature, lastValidBlockHeight: latest.lastValidBlockHeight });
    // Always submit the signed transaction, so even a cap refusal has a durable chain status.
    await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: true, maxRetries: 0 });
    const confirmation = await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
    const paid = await readReceipt();
    if (paid) return paid;
    const refusal = capped(customCode(confirmation.value.err));
    if (refusal) return refusal;
    throw new Error('referral payment is unconfirmed');
  }
}
