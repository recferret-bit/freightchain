import type { Ride } from './ride.entity.js';

export interface PublicRideVerdictDto {
  status: 'verified' | 'flagged' | 'rejected';
  reasons: string[];
}

export interface PublicRideDto {
  id: string;
  route: string | null;
  tier: string;
  status: string;
  reason: string | null;
  km: number;
  driveSeconds: number;
  finishedAt: number | null;
  round: number;
  rank: number | null;
  paymentSignature: string | null;
  seed: number;
  seedSlot: number | null;
  wallet: string;
  fullWallet: string | null;
  tipsLamports: number;
  pledgesLamports: number;
  verdict: PublicRideVerdictDto | null;
  /** primary Solana Name Service (.sol) domain name of the driver, or null */
  sns?: string | null;
}

export function shortenWallet(wallet: string): string {
  if (!wallet || wallet.length <= 8) return wallet;
  return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
}

export function toPublicRideDto(
  ride: Ride,
  verdict: PublicRideVerdictDto | null = null,
  extras?: {
    rank?: number | null;
    paymentSignature?: string | null;
    seedSlot?: number | null;
    tipsLamports?: number;
    pledgesLamports?: number;
  },
  sns?: string | null,
): PublicRideDto {
  const p = typeof ride.snapshot === 'function' ? ride.snapshot() : (ride as any);
  const distance = typeof ride.distance === 'number' ? ride.distance : (p.distance ?? p.lastS ?? 0);
  const driveSecs = typeof ride.driveSeconds === 'number' ? ride.driveSeconds : (p.driveSeconds ?? 0);
  const ended = p.endedAt instanceof Date ? p.endedAt.getTime() : (typeof p.endedAt === 'number' ? p.endedAt : (typeof (ride as any).finishedAt === 'number' ? (ride as any).finishedAt : null));
  const rawWallet = p.wallet ?? '';

  return {
    id: p.id,
    route: p.route ?? null,
    tier: p.tier,
    status: p.status,
    reason: p.reason ?? null,
    km: Math.round((distance / 1000) * 100) / 100,
    driveSeconds: Math.round(driveSecs * 10) / 10,
    finishedAt: ended,
    round: (ride as any).round ?? p.roundId ?? 0,
    rank: extras?.rank ?? (ride as any).rank ?? null,
    paymentSignature: extras?.paymentSignature ?? (ride as any).paymentSignature ?? (p as any).paymentSignature ?? null,
    seed: p.seed,
    seedSlot: extras?.seedSlot ?? (ride as any).seedSlot ?? (p as any).seedSlot ?? null,
    wallet: shortenWallet(rawWallet),
    fullWallet: rawWallet || null,
    tipsLamports: extras?.tipsLamports ?? (ride as any).tipsLamports ?? (p as any).tipsLamports ?? 0,
    pledgesLamports: extras?.pledgesLamports ?? (ride as any).pledgesLamports ?? (p as any).pledgesLamports ?? 0,
    verdict,
    ...(sns !== undefined ? { sns } : {}),
  };
}
