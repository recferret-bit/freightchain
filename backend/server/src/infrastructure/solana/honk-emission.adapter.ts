import { Injectable } from '@nestjs/common';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HonkEmissionPort } from '../../application/ports/honk/honk-emission.port.js';
import { EnvService } from '../config/env.service.js';
import { parseKeypair } from './program-chain.adapter.js';

const PROGRAM = 'GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx';
const RECEIPT = createHash('sha256').update('account:RideMint').digest().subarray(0, 8);

/** A confirmed, matching PDA is the retry receipt. Error text never proves payment. */
@Injectable()
export class HonkEmissionAdapter extends HonkEmissionPort {
  private readonly key: Keypair | null;

  constructor(private readonly env: EnvService) {
    super();
    this.key = env.honkEmitterSecret ? parseKeypair(env.honkEmitterSecret) : null;
  }

  enabled(): boolean { return this.key !== null && !!this.env.honkProgramId; }

  async mint(rideId: string, wallet: string, tier: string, bands: number, dayIndex: number, expectedAmount?: bigint): Promise<void> {
    if (!this.enabled()) return;
    const key = this.key!;
    const tierByte = tier === '1h' ? 1 : tier === '4h' ? 4 : tier === '8h' ? 8 : 0;
    if (this.env.honkProgramId !== PROGRAM || !tierByte || !Number.isInteger(bands) || bands < 1 || bands > 7 || !Number.isInteger(dayIndex) || dayIndex < 0 || !expectedAmount || expectedAmount < 0n) throw new Error('invalid emission request');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rideId)) throw new Error('invalid emission ride');
    const ride = Buffer.from(rideId.replace(/-/g, ''), 'hex');
    const program = new PublicKey(PROGRAM);
    const recipient = new PublicKey(wallet);
    const [receipt] = PublicKey.findProgramAddressSync([Buffer.from('ride-mint'), ride], program);
    const connection = new Connection(this.env.solanaRpc, 'confirmed');
    const paid = async () => {
      const account = await connection.getAccountInfo(receipt, 'confirmed');
      if (!account) return false;
      const d = account.data;
      if (!account.owner.equals(program) || d.length !== 52 || !d.subarray(0, 8).equals(RECEIPT) || d.readBigUInt64LE(8) !== expectedAmount || !d.subarray(16, 48).equals(recipient.toBuffer()) || d[48] !== tierByte || d[49] !== bands) throw new Error('emission receipt mismatch');
      return true;
    };
    if (await paid()) return;
    const mod = await import(pathToFileURL(join(process.cwd(), 'scripts', 'honk-program.mjs')).href) as {
      mintRide(i: { rpc: string; emitter: Keypair; rider: string; rideId: Buffer; tier: number; bands: number; dayIndex: number; expectedAmount: bigint }): Promise<string>;
    };
    try {
      await mod.mintRide({ rpc: this.env.solanaRpc, emitter: key, rider: wallet, rideId: ride, tier: tierByte, bands, dayIndex, expectedAmount });
    } catch {
      if (await paid()) return;
      throw new Error('emission transaction unconfirmed');
    }
    if (!(await paid())) throw new Error('emission receipt missing');
  }
}
