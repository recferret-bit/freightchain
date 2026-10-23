// The payout order the server pays: one wallet per verified finisher, best ride first (domain/pool/pool-ranking.js).
// Reads the throwaway database's stats.RideResult. DATABASE_URL must be that database, never a dev or prod URL.
import { PrismaClient } from '@prisma/client';
import { orderWalletsByResults } from '../dist/domain/pool/pool-ranking.js';

export async function rankedWallets(poolId, verifiedWallets) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required (the localnet throwaway database)');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const rows = await prisma.$queryRaw`
      SELECT "wallet", "finished", "verdictTier", "durationMs", "mgPenaltySeconds", "damageTotal", "redLights", "distanceM", "computedAt"
      FROM stats."RideResult" WHERE "poolId" = ${poolId}`;
    const mapped = rows.map(r => ({
      wallet: r.wallet, finished: r.finished, verdictTier: r.verdictTier,
      durationMs: Number(r.durationMs), mgPenaltySeconds: Number(r.mgPenaltySeconds), damageTotal: Number(r.damageTotal),
      redLights: Number(r.redLights), distanceM: Number(r.distanceM), finishedAt: r.computedAt ? new Date(r.computedAt) : null,
    }));
    return orderWalletsByResults(verifiedWallets, mapped);
  } finally {
    await prisma.$disconnect();
  }
}
