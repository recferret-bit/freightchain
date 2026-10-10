import { Injectable } from '@nestjs/common';
import { OfflineRideRepositoryPort, type OfflineClaimInput, type OfflineClaimResult } from '../../../application/ports/offline/offline-ride.repository.port.js';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class OfflineRidePrismaRepository extends OfflineRideRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async counts(fingerprint: string, ip: string): Promise<{ usedFingerprint: number; usedIp: number }> {
    const [usedFingerprint, usedIp] = await Promise.all([
      this.prisma.offlineRideUse.count({ where: { fingerprint } }),
      this.prisma.offlineRideUse.count({ where: { ip } }),
    ]);
    return { usedFingerprint, usedIp };
  }

  /**
   * Fingerprint lock, then the IP lock, then the counts. Two browsers behind one address take their own fingerprint lock first and then queue on the address,
   * so the pair cannot deadlock. `hashtext` is a signed int; the two-int advisory lock accepts it.
   */
  async tryClaim(input: OfflineClaimInput): Promise<OfflineClaimResult> {
    return this.prisma.$transaction(async (tx) => {
      // $executeRaw: the lock returns void, and $queryRaw cannot deserialise that column.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(1, hashtext(${input.fingerprint}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(2, hashtext(${input.ip}))`;
      const usedFingerprint = await tx.offlineRideUse.count({ where: { fingerprint: input.fingerprint } });
      const usedIp = await tx.offlineRideUse.count({ where: { ip: input.ip } });
      if (usedFingerprint >= input.limitFingerprint || usedIp >= input.limitIp) return { granted: false, usedFingerprint, usedIp };
      await tx.offlineRideUse.create({ data: { id: input.id, fingerprint: input.fingerprint, ip: input.ip, at: input.at } });
      return { granted: true, usedFingerprint: usedFingerprint + 1, usedIp: usedIp + 1 };
    });
  }
}
