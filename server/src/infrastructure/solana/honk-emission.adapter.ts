import { Injectable, Logger } from '@nestjs/common';
import { Keypair } from '@solana/web3.js';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HonkEmissionPort } from '../../application/ports/honk/honk-emission.port.js';
import { EnvService } from '../config/env.service.js';
import { parseKeypair } from './program-chain.adapter.js';

/** After the ledger credit commits. The pool vault is not paid. A repeated ride id is ignored. */
@Injectable()
export class HonkEmissionAdapter extends HonkEmissionPort {
  private readonly logger = new Logger(HonkEmissionAdapter.name);
  private readonly key: Keypair | null;

  constructor(private readonly env: EnvService) {
    super();
    this.key = env.honkEmitterSecret ? parseKeypair(env.honkEmitterSecret) : null;
  }

  enabled(): boolean { return this.key !== null && !!this.env.honkProgramId; }

  async mint(rideId: string, wallet: string, amount: bigint): Promise<void> {
    const key = this.key;
    if (!key || !this.env.honkProgramId || amount <= 0n) return;
    const ride = Buffer.from(rideId.replace(/-/g, ''), 'hex');
    if (ride.length !== 16) return;
    const mod = await import(pathToFileURL(join(process.cwd(), 'scripts', 'honk-program.mjs')).href) as {
      mintRide(i: { rpc: string; emitter: Keypair; rider: string; rideId: Buffer; amount: bigint }): Promise<string>;
    };
    try {
      await mod.mintRide({ rpc: this.env.solanaRpc, emitter: key, rider: wallet, rideId: ride, amount });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/already in use|0x0/i.test(message)) return;
      this.logger.error({ event: 'honk-emission', rideId, message });
      throw error;
    }
  }
}
