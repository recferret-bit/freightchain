import { UnauthorizedError } from '../../../../src/domain/shared/errors.js';
import { testAdmin } from '../../../support/admin-fixtures.js';
import { unitContext } from '../../../support/unit-context.js';

describe('AdminProofService', () => {
  const intent = { action: 'override' as const, rideId: 'r-1', decision: 'verified' as const, note: null };

  it('issue → the wallet signs → prove: the signed text and signature come back for the audit; single use', async () => {
    const ctx = unitContext(), admin = testAdmin(ctx);
    const message = await ctx.proofs.issue(admin.wallet, intent);
    const signature = admin.signText(message);
    expect(await ctx.proofs.prove(admin.wallet, intent, signature)).toEqual({ message, signature });
    await expect(ctx.proofs.prove(admin.wallet, intent, signature)).rejects.toThrow(/no signed request/);
  });

  it('expires with the nonce TTL (5 min)', async () => {
    const ctx = unitContext(), admin = testAdmin(ctx);
    const signature = await admin.sign(intent);
    ctx.clock.advance(301);
    await expect(ctx.proofs.prove(admin.wallet, intent, signature)).rejects.toThrow(/no signed request/);
  });

  it('another admin cannot use it, and a text issued for one admin is not another admin\'s', async () => {
    const ctx = unitContext(), a = testAdmin(ctx), b = testAdmin(ctx);
    const message = await ctx.proofs.issue(a.wallet, intent);
    await expect(ctx.proofs.prove(b.wallet, intent, b.signText(message, b.kp))).rejects.toThrow(/no signed request/);   // b has nothing pending
    await expect(ctx.proofs.prove(a.wallet, intent, a.signText(message, b.kp))).rejects.toBeInstanceOf(UnauthorizedError);   // b's key on a's text
  });

  it('a sign-in challenge (admin or rider) is never an action proof', async () => {
    const ctx = unitContext(), admin = testAdmin(ctx);
    await ctx.challenges.upsert({ wallet: admin.wallet, message: 'rider sign-in', expiresAt: new Date(ctx.clock.ms + 60_000), isExpired: () => false } as never);
    await expect(ctx.proofs.prove(admin.wallet, intent, admin.signText('rider sign-in'))).rejects.toThrow(/no signed request/);
  });
});
