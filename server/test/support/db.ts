import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { truncateAllTables } from '../../src/infrastructure/prisma/truncate.js';
import { Player } from '../../src/domain/players/player.entity.js';
import { Ride } from '../../src/domain/rides/ride.entity.js';
import type { TransactionHandle } from '../../src/application/ports/shared/transaction.port.js';
import { testDatabaseUrl } from './harness.js';

/** A PrismaService on the integration suite's OWN database (`*_test`; created + migrated by global-setup). */
export async function testPrisma(): Promise<PrismaService> {
  process.env['DATABASE_URL'] = testDatabaseUrl(); // PrismaClient reads it; truncateAllTables refuses anything not named *_test
  const prisma = new PrismaService();
  await prisma.onModuleInit();
  return prisma;
}

export const wipe = (prisma: PrismaService) => truncateAllTables(prisma);

export const T0 = new Date(Date.UTC(2036, 9, 8, 12, 0, 0));
export const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

/** rows the foreign keys need */
export async function seedPlayer(prisma: PrismaService, wallet: string): Promise<void> {
  const s = Player.register(wallet, T0, 5, 5).snapshot();
  await prisma.player.create({ data: { wallet: s.wallet, version: s.version, freeRides: s.freeRides, freeDay: s.freeDay, freeRidesMax: s.freeRidesMax, createdAt: s.createdAt } });
}

let n = 0;
export const rideId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
export const freeRideAt = (wallet: string, now = T0, minSeconds = 10, helpers: { tutorial?: boolean; assist?: boolean } = {}) => Ride.createFree({ id: rideId(), wallet, seed: 7, minSeconds, now, ...helpers });
export const orderAt = (wallet: string, now = T0, lamports = 50_000_000) =>
  Ride.createPaidOrder({ id: rideId(), wallet, tier: '1h', seed: 7, minSeconds: 3600, timeScale: 1, priceUsd: 5, lamports, solUsd: 100, now, quoteTtlMs: 600_000 });

/** run `fn` in a real interactive transaction (what TransactionPrismaAdapter does) */
export const inTx = <T>(prisma: PrismaService, fn: (tx: TransactionHandle) => Promise<T>) => prisma.$transaction((c) => fn(c as unknown as TransactionHandle), { timeout: 10_000 });
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
