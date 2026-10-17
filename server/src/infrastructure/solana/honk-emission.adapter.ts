import { Injectable, Logger } from '@nestjs/common';
import { Keypair } from '@solana/web3.js';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HonkEmissionPort } from '../../application/ports/honk/honk-emission.port.js';
import { EnvService } from '../config/env.service.js';
import { parseKeypair } from './program-chain.adapter.js';

/** After the ledger credit commits. The pool vault is not paid. The program derives the amount. A repeated ride id is ignored. */
@Injectable()
export class HonkEmissionAdapter extends HonkEmissionPort {
  private readonly logger = new Logger(HonkEmissionAdapter.name);
  private readonly key: Keypair | null;

  constructor(private readonly env: EnvService) {
    super();
    this.key = env.honkEmitterSecret ? parseKeypair(env.honkEmitterSecret) : null;
  }

  enabled(): boolean { return this.key !== null && !!this.env.honkProgramId; }

  async mint(rideId: string, wallet: string, tier: string, bands: number, dayIndex: number): Promise<void> {
    const key = this.key;
    const tierByte = tier === '1h' ? 1 : tier === '4h' ? 4 : tier === '8h' ? 8 : 0;
    if (!key || !this.env.honkProgramId || tierByte === 0 || bands === 0 || !Number.isInteger(dayIndex) || dayIndex < 0) return;
    const ride = Buffer.from(rideId.replace(/-/g, ''), 'hex');
    if (ride.length !== 16) return;
    // dayIndex is the ClockPort unix day from the caller. The program rejects it unless it matches the validator clock.
    const mod = await import(pathToFileURL(join(process.cwd(), 'scripts', 'honk-program.mjs')).href) as {
      mintRide(i: { rpc: string; emitter: Keypair; rider: string; rideId: Buffer; tier: number; bands: number; dayIndex: number }): Promise<string>;
    };
    try {
      await mod.mintRide({ rpc: this.env.solanaRpc, emitter: key, rider: wallet, rideId: ride, tier: tierByte, bands, dayIndex });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/already in use|0x0/i.test(message)) return;
      this.logger.error({ event: 'honk-emission', rideId, message });
      throw error;
    }
  }
}
