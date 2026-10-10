import { ClaimOfflineRideHandler } from '../../../../../src/application/use-cases/offline/claim-offline-ride/claim-offline-ride.handler.js';
import { ClaimOfflineRideCommand } from '../../../../../src/application/use-cases/offline/claim-offline-ride/claim-offline-ride.command.js';
import { ConflictError } from '../../../../../src/domain/shared/errors.js';
import { unitContext, type UnitContext } from '../../../../support/unit-context.js';

const FP = 'a'.repeat(64);
const FP2 = 'b'.repeat(64);
const handlerOf = (ctx: UnitContext) => new ClaimOfflineRideHandler(ctx.offlineRides, ctx.settings, ctx.rules, ctx.clock, ctx.entropy);

describe('ClaimOfflineRideHandler', () => {
  it('inserts one row per start until the fingerprint limit, then 409', async () => {
    const ctx = unitContext();
    const h = handlerOf(ctx);
    const first = await h.execute(new ClaimOfflineRideCommand(null, FP, '1.2.3.4'));
    expect(first).toMatchObject({ signedIn: false, allowed: true, claimed: true, remaining: 2, usedFingerprint: 1, usedIp: 1, minSeconds: 10, completeDist: 70 });
    await h.execute(new ClaimOfflineRideCommand(null, FP, '1.2.3.4'));
    const last = await h.execute(new ClaimOfflineRideCommand(null, FP, '1.2.3.4'));
    expect(last).toMatchObject({ claimed: true, allowed: false, remaining: 0, usedFingerprint: 3 });
    await expect(h.execute(new ClaimOfflineRideCommand(null, FP, '1.2.3.4'))).rejects.toMatchObject({ errorCode: 'offline_rides_spent' });
    expect(ctx.db.offlineUses).toHaveLength(3);
  });

  it('a second fingerprint still fits under the address cap; a signed-in wallet inserts nothing', async () => {
    const ctx = unitContext();
    const h = handlerOf(ctx);
    for (let i = 0; i < 3; i++) await h.execute(new ClaimOfflineRideCommand(null, FP, '9.9.9.9'));
    const other = await h.execute(new ClaimOfflineRideCommand(null, FP2, '9.9.9.9'));
    expect(other).toMatchObject({ claimed: true, usedFingerprint: 1, usedIp: 4 });
    const signed = await h.execute(new ClaimOfflineRideCommand('wallet', FP2, '9.9.9.9'));
    expect(signed).toMatchObject({ signedIn: true, claimed: false, allowed: false, usedFingerprint: 1 });
    expect(ctx.db.offlineUses).toHaveLength(4);
  });

  it('a blank address shares one bucket, and a limit of 0 refuses everyone', async () => {
    const ctx = unitContext();
    const h = handlerOf(ctx);
    await h.execute(new ClaimOfflineRideCommand(null, FP, ''));
    await h.execute(new ClaimOfflineRideCommand(null, FP2, '   '));
    expect(ctx.db.offlineUses.every((row) => row.ip === 'unknown')).toBe(true);
    await ctx.settingsRepo.upsert('offline_free_rides', 0);
    await expect(h.execute(new ClaimOfflineRideCommand(null, 'c'.repeat(64), '1.1.1.1'))).rejects.toBeInstanceOf(ConflictError);
  });

  it('eight claims at once take exactly the three fingerprint slots', async () => {
    const ctx = unitContext();
    const h = handlerOf(ctx);
    const results = await Promise.all(Array.from({ length: 8 }, () => h.execute(new ClaimOfflineRideCommand(null, FP, '1.2.3.4')).then(() => 'ok', (e: unknown) => e)));
    expect(results.filter((r) => r === 'ok')).toHaveLength(3);
    expect(results.filter((r) => r instanceof ConflictError)).toHaveLength(5);
    expect(ctx.db.offlineUses).toHaveLength(3);
  });
});
