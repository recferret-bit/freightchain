import type { Pledge } from './pledge.entity.js';

export interface PledgeDto {
  id: string;
  pdaAddress: string;
  rideId: string;
  sponsor: string;
  driver: string;
  poolId: number;
  maxLamports: string;
  lamportsPerKm: string;
  targetKm: number;
  status: string;
  createSignature: string | null;
  settled: boolean;
  earnedLamports: string;
  refundedLamports: string;
  createdAt: number;
  settledAt: number | null;
  signature: string | null;
  slot: string | null;
}

export const toPledgeDto = (p: Pledge): PledgeDto => ({
  id: p.id,
  pdaAddress: p.pdaAddress,
  rideId: p.rideId,
  sponsor: p.sponsor,
  driver: p.driver,
  poolId: p.poolId,
  maxLamports: p.maxLamports.toString(),
  lamportsPerKm: p.lamportsPerKm.toString(),
  targetKm: p.targetKm,
  status: p.status,
  createSignature: p.createSignature,
  settled: p.isSettled,
  earnedLamports: p.earnedLamports.toString(),
  refundedLamports: p.refundedLamports.toString(),
  createdAt: p.createdAt.getTime(),
  settledAt: p.settledAt?.getTime() ?? null,
  signature: p.signature,
  slot: p.slot !== null ? p.slot.toString() : null,
});
