import { MintAchievementsCommand } from '../../../../../src/application/use-cases/achievements/mint-achievements/mint-achievements.command.js';
import { MintAchievementsHandler } from '../../../../../src/application/use-cases/achievements/mint-achievements/mint-achievements.handler.js';
import { MAX_MINT_ATTEMPTS } from '../../../../../src/domain/achievements/achievement-mint.js';
import { ConflictError } from '../../../../../src/domain/shared/errors.js';
import { unitContext, unitRules } from '../../../../support/unit-context.js';

const HOUR = 3_600_000;

describe('MintAchievementsHandler – soulbound badge cNFTs', () => {
  /** wallet `w` has started a ride (First Mile earned and unlocked) `ageSeconds` ago */
  const setup = async (over: Parameters<typeof unitRules>[0] = {}, ageSeconds = 7200) => {
    const ctx = unitContext(unitRules(over));
    await ctx.freeRide('w', true);
    await ctx.achievements.evaluate('w');
    ctx.clock.advance(ageSeconds);
    const handler = new MintAchievementsHandler(ctx.mintChain, ctx.mints, ctx.achievements, ctx.rules, ctx.analytics, ctx.clock);
    const run = (batch = 10, retry = false) => handler.execute(new MintAchievementsCommand(HOUR, batch, retry));
    const row = async (id = 'first-mile') => (await ctx.mints.listByWallet('w')).find((m) => m.achievementId === id);
    return { ctx, run, row };
  };

  it('is off (enabled false, nothing read) without the key, tree and collection', async () => {
    const { ctx, run } = await setup();
    ctx.mintChain.address = null;
    expect(await run()).toMatchObject({ enabled: false, queued: 0, minted: 0 });
    expect(await ctx.mints.listByWallet('w')).toEqual([]);
  });

  it('waits for the delay, then mints to the wallet with the badge\'s name and metadata, and records the asset id', async () => {
    const { ctx, run, row } = await setup({}, 600); // unlocked 10 minutes ago, the delay is an hour
    expect(await run()).toMatchObject({ queued: 0, minted: 0 });
    ctx.clock.advance(3000);
    expect(await run()).toMatchObject({ queued: 1, minted: 1, waiting: 0 });
    expect(ctx.mintChain.minted).toEqual([{ wallet: 'w', name: 'First Mile', uri: 'https://arweave.net/first-mile', signature: 'sig1' }]);
    expect(await row()).toMatchObject({ status: 'minted', signature: 'sig1', assetId: 'asset-sig1', attempts: 1, error: null });
    expect(ctx.analytics.named('achievement_minted')).toHaveLength(1);
    expect(ctx.analytics.named('achievement_minted')[0]).toMatchObject({ distinctId: 'w', properties: { achievement_id: 'first-mile', family: 'road', tier: 1, asset_id: 'asset-sig1', attempts: 1 } });
    expect(await run()).toMatchObject({ queued: 0, minted: 0 }); // a minted badge is never minted again
    expect(ctx.mintChain.minted).toHaveLength(1);
  });

  it('only badges whose metadata is uploaded are queued', async () => {
    const { ctx, run } = await setup();
    ctx.mintChain.uris = {};
    expect(await run()).toMatchObject({ queued: 0, minted: 0 });
    expect(await ctx.mints.listByWallet('w')).toEqual([]);
    ctx.mintChain.uris = { 'first-mile': 'https://arweave.net/x' };
    expect(await run()).toMatchObject({ queued: 1, minted: 1 });
  });

  it('a demo wallet\'s badge is skipped, never minted', async () => {
    const { ctx, run, row } = await setup({ demoWallets: new Set(['w']) });
    expect(await run()).toMatchObject({ queued: 1, minted: 0 });
    expect(await row()).toMatchObject({ status: 'skipped', error: 'demo-wallet' });
    expect(ctx.mintChain.minted).toEqual([]);
  });

  it('re-checks the badge at mint time: an unlock whose rides no longer count (a rejected ride, even in shadow mode) is skipped', async () => {
    const { ctx, run, row } = await setup();
    ctx.db.rides.clear(); // the wallet's only ride no longer counts (a rejected recording leaves no counted ride): the unlock row stays, the token is not minted
    expect(await run()).toMatchObject({ queued: 1, minted: 0, skipped: 1 });
    expect(await row()).toMatchObject({ status: 'skipped', error: 'no-longer-earned' });
    expect(ctx.mintChain.minted).toEqual([]);
  });

  it('the signature is stored BEFORE the broadcast: a crash after signing leaves a sent row that the next pass resolves – never a second mint', async () => {
    const { ctx, run, row } = await setup();
    ctx.mintChain.failNext = { error: new ConflictError('not confirmed yet', 'transaction_unconfirmed'), before: false };
    expect(await run()).toMatchObject({ minted: 0, waiting: 1 });
    expect(await row()).toMatchObject({ status: 'sent', signature: 'sig1', attempts: 1 });
    expect(await run()).toMatchObject({ minted: 0, waiting: 1 }); // still pending: not re-sent
    expect(ctx.mintChain.minted).toEqual([]);
    ctx.mintChain.statuses.set('sig1', 'confirmed');
    ctx.mintChain.assets.set('sig1', 'asset-landed');
    expect(await run()).toMatchObject({ minted: 1 });
    expect(await row()).toMatchObject({ status: 'minted', assetId: 'asset-landed', attempts: 1 });
    expect(ctx.mintChain.minted).toEqual([]); // not one extra transaction was sent
  });

  it('a landed mint whose asset id cannot be read yet waits (the asset id comes from the finalized transaction)', async () => {
    const { ctx, run, row } = await setup();
    ctx.mintChain.assetPending = true;
    expect(await run()).toMatchObject({ minted: 0, waiting: 1 });
    expect(await row()).toMatchObject({ status: 'sent', assetId: null });
    ctx.mintChain.assets.set('sig1', 'asset-late');
    expect(await run()).toMatchObject({ minted: 1 });
    expect(await row()).toMatchObject({ status: 'minted', assetId: 'asset-late' });
  });

  it('a transaction that expired or failed on chain moved nothing: a new one is sent; after MAX_MINT_ATTEMPTS the row is failed (one analytics event) until an admin retries', async () => {
    const { ctx, run, row } = await setup();
    for (let n = 1; n <= MAX_MINT_ATTEMPTS; n++) {
      ctx.mintChain.failNext = { error: new ConflictError('dropped', 'transaction_dropped'), before: false };
      const pass = await run();
      expect(await row()).toMatchObject({ status: n < MAX_MINT_ATTEMPTS ? 'planned' : 'failed', signature: null, attempts: n });
      expect(pass.failed).toBe(n < MAX_MINT_ATTEMPTS ? 0 : 1);
    }
    expect(ctx.analytics.named('achievement_mint_failed')).toHaveLength(1);
    expect(await run()).toMatchObject({ minted: 0, waiting: 0 }); // failed rows are left alone
    expect(await run(10, true)).toMatchObject({ retried: 1, minted: 1 });
    expect(await row()).toMatchObject({ status: 'minted', attempts: 1 });
  });

  it('an expired blockhash found on a sent row sends the mint again', async () => {
    const { ctx, run, row } = await setup();
    ctx.mintChain.failNext = { error: new ConflictError('unconfirmed', 'transaction_unconfirmed'), before: false };
    await run();
    ctx.mintChain.statuses.set('sig1', 'expired');
    expect(await run()).toMatchObject({ waiting: 1, minted: 0 }); // released this pass…
    expect(await row()).toMatchObject({ status: 'planned', signature: null });
    expect(await run()).toMatchObject({ minted: 1 }); // …and minted by the next
    expect(await row()).toMatchObject({ status: 'minted', attempts: 2 });
  });

  it('two passes at once mint once (the claim is conditional on the row)', async () => {
    const { ctx, run, row } = await setup();
    await Promise.all([run(), run()]);
    expect(ctx.mintChain.minted).toHaveLength(1);
    expect(await row()).toMatchObject({ status: 'minted', attempts: 1 });
  });

  it('sends at most `batch` transactions per pass; the rest wait for the next', async () => {
    const { ctx, run } = await setup();
    // a second wallet with its own started ride
    await ctx.freeRide('v', true);
    await ctx.achievements.evaluate('v');
    ctx.clock.advance(7200);
    expect(await run(1)).toMatchObject({ queued: 2, minted: 1, waiting: 1 });
    expect(await run(1)).toMatchObject({ minted: 1, waiting: 0 });
    expect(ctx.mintChain.minted.map((m) => m.wallet).sort()).toEqual(['v', 'w']);
  });

  it('a refused simulation (before signing) stays planned with the error and nothing is claimed', async () => {
    const { ctx, run, row } = await setup();
    ctx.mintChain.failNext = { error: new ConflictError('mint would fail', 'transaction_would_fail'), before: true };
    expect(await run()).toMatchObject({ minted: 0, waiting: 1 });
    expect(await row()).toMatchObject({ status: 'planned', attempts: 0, error: 'mint would fail' });
    expect(await run()).toMatchObject({ minted: 1 });
  });

  it('a FULL tree sends nothing (the rows wait for a new tree) but still resolves what is in flight; a nearly full one is reported', async () => {
    const { ctx, run, row } = await setup();
    ctx.mintChain.usage = { minted: 65_536, capacity: 65_536 };
    expect(await run()).toMatchObject({ queued: 1, minted: 0, waiting: 1, tree: { minted: 65_536, capacity: 65_536 } });
    expect(await row()).toMatchObject({ status: 'planned', attempts: 0 });
    expect(ctx.mintChain.minted).toEqual([]);
    ctx.mintChain.usage = { minted: 100, capacity: 65_536 };
    expect(await run()).toMatchObject({ minted: 1, tree: { minted: 100 } });
    ctx.mintChain.usage = null; // unknown (RPC cannot read it): no guard, the program is the judge
    expect(await run()).toMatchObject({ tree: null });
  });
});
