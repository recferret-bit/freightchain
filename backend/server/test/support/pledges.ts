import { Keypair } from '@solana/web3.js';
import { Pledge } from '../../src/domain/economy/pledge.entity.js';
import { rideIdToBytes } from '../../src/domain/economy/pledge.types.js';
import type { UnitContext } from './unit-context.js';

export const wallet = (): string => Keypair.generate().publicKey.toBase58();

/** A pending pledge row (as POST /api/pledges leaves it) of `sponsor` to `driver` in `poolId`, its PDA from the fake chain; `onChain` also puts its create_pledge
    on the fake chain and returns that signature. */
export async function aPledge(ctx: UnitContext, o: { sponsor: string; driver: string; poolId?: number; lamportsPerKm?: bigint; targetKm?: number; onChain?: boolean }):
  Promise<{ pledge: Pledge; createSig: string | null }> {
  const rideId = ctx.entropy.uuid();
  const pledge = Pledge.create({
    id: ctx.entropy.uuid(), pdaAddress: ctx.poolChain.pledgePda(rideIdToBytes(rideId), o.sponsor), rideId, sponsor: o.sponsor, driver: o.driver, poolId: o.poolId ?? 1,
    lamportsPerKm: o.lamportsPerKm ?? 1_000_000n, targetKm: o.targetKm ?? 10, now: ctx.now(),
  });
  await ctx.pledges.insert(pledge);
  const createSig = o.onChain ? ctx.poolChain.addPledgeTransaction([createdEvent(pledge)]) : null;
  return { pledge, createSig };
}

/** the PledgeCreated the program would emit for this row */
export const createdEvent = (p: Pledge) => ({
  kind: 'PledgeCreated' as const, rideId: p.rideId, sponsor: p.sponsor, driver: p.driver, pool: `pool${p.poolId}`, maxLamports: p.maxLamports, lamportsPerKm: p.lamportsPerKm, targetKm: p.targetKm,
});
