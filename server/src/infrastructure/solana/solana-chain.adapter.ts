import { Injectable } from '@nestjs/common';
import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import type { ChainSignature, ChainTransaction, UnsignedPaymentTx } from '../../domain/economy/chain-transaction.js';
import { ServiceUnavailableError } from '../../domain/shared/errors.js';
import { ChainPort, type PaymentTxInput } from '../../application/ports/economy/chain.port.js';
import { EnvService } from '../config/env.service.js';
import { MEMO_PROGRAM, toChainTransaction } from './chain-transaction.mapper.js';

/** Plan A payment: a plain SOL transfer to the treasury with the ride id as a memo. The only module that talks to a Solana RPC. */
@Injectable()
export class SolanaChainAdapter extends ChainPort {
  private readonly connection: Connection;

  constructor(env: EnvService) {
    super();
    this.connection = new Connection(env.solanaRpc, 'confirmed');
  }

  async buildPaymentTransaction(input: PaymentTxInput): Promise<UnsignedPaymentTx> {
    const { blockhash, lastValidBlockHeight } = await this.rpc(() => this.connection.getLatestBlockhash('confirmed'));
    const payer = new PublicKey(input.payer);
    const tx = new Transaction({ feePayer: payer, recentBlockhash: blockhash })
      .add(SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey(input.treasury), lamports: input.lamports }))
      .add(new TransactionInstruction({ keys: [{ pubkey: payer, isSigner: true, isWritable: false }], programId: MEMO_PROGRAM, data: Buffer.from(input.memo) }));
    return { blockhash, lastValidBlockHeight, transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64') };
  }

  async getTransaction(signature: string): Promise<ChainTransaction | null> {
    const parsed = await this.rpc(() => this.connection.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }));
    return parsed ? toChainTransaction(parsed) : null;
  }

  async recentSignatures(wallet: string, limit: number): Promise<ChainSignature[]> {
    const entries = await this.rpc(() => this.connection.getSignaturesForAddress(new PublicKey(wallet), { limit }, 'confirmed'));
    return entries.filter((e) => !e.err).map((e) => ({ signature: e.signature, memo: e.memo }));
  }

  /** An RPC failure is "unavailable", never "not found". */
  private async rpc<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch {
      throw new ServiceUnavailableError('Solana RPC unavailable');
    }
  }
}
