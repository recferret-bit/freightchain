import { createHash } from 'node:crypto';
import type { HonkChainTx } from '../../../../../src/domain/honk/chain-tx.js';
import { RideEvent } from '../../../../../src/domain/live/ride-event.entity.js';
import { BadRequestError, ConflictError, ForbiddenError, ServiceUnavailableError, TooManyRequestsError } from '../../../../../src/domain/shared/errors.js';
import { HonkChainPort } from '../../../../../src/application/ports/honk/honk-chain.port.js';
import { BurnHonkHandler, BurnHonkCommand, GetHonkCatalogHandler, GetHonkCatalogQuery, GetHonkHandler, GetHonkQuery, MintHonkVisualHandler, MintHonkVisualCommand } from '../../../../../src/application/use-cases/honk/honk.handlers.js';
import { unitContext } from '../../../../support/unit-context.js';

const U = 1_000_000n;
const PROGRAM = 'GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx';
const visualId = (wallet: string, slot: string, item: string) => createHash('sha256').update(`${wallet}|${slot}|${item}`).digest('hex').slice(0, 32);

export class OffHonkChain extends HonkChainPort {
  loads = 0;
  programId(): string | null { return null; }
  load(): Promise<HonkChainTx | null> { this.loads += 1; return Promise.reject(new Error('chain should stay off')); }
}

class ScriptedHonkChain extends HonkChainPort {
  loads = 0;
  constructor(private readonly tx: HonkChainTx | null | Error, private readonly id: string | null = PROGRAM) { super(); }
  programId(): string | null { return this.id; }
  load(): Promise<HonkChainTx | null> {
    this.loads += 1;
    if (this.tx instanceof Error) return Promise.reject(this.tx);
    return Promise.resolve(this.tx);
  }
}

const burnTx = (authority: string, amount: bigint, signer = authority): HonkChainTx => ({ signers: [signer], burns: [{ amount, authority }], parts: [] });
const partTx = (buyer: string, slot: string, item: string, amount: bigint, mint = 'Mint111'): HonkChainTx => ({
  signers: [buyer], burns: [], parts: [{ slot, item, buyer, mint, burned: amount, frozen: true, supply: 1n, decimals: 0, holder: buyer }],
});

describe('BurnHonkHandler', () => {
  const setup = async (balance = 5n * U, chain: HonkChainPort = new OffHonkChain()) => {
    const ctx = unitContext();
    const ride = await ctx.paidRide('driver');
    await ctx.player('fan');
    if (balance > 0n) await ctx.honkRepo.credit('fan', balance, ctx.now());
    const handler = new BurnHonkHandler(ctx.liveAccess, ctx.players, ctx.honkRepo, ctx.rideEvents, ctx.transactions, ctx.clock, ctx.entropy, chain);
    const burn = (signature?: string) => handler.execute(new BurnHonkCommand('fan', ride.id, signature));
    return { ctx, ride, burn, chain };
  };

  it('burns 1 HONK and posts the chat line HONK, with no second burn inside 10 s', async () => {
    const { ctx, ride, burn } = await setup();
    expect(await burn()).toEqual({ balance: '4', pays: '1' });
    expect(ctx.db.rideEvents.some((e) => e.rideId === ride.id && e.text === 'HONK')).toBe(true);
    await expect(burn()).rejects.toBeInstanceOf(TooManyRequestsError);
    await expect(burn()).rejects.toMatchObject({ errorCode: 'honk_rate_limited' });
    expect(await ctx.honkRepo.balance('fan')).toBe(4n * U);
    ctx.clock.advance(10);
    expect(await burn()).toEqual({ balance: '3', pays: '1' });
  });

  it('an empty balance is a conflict and burns nothing', async () => {
    const { ctx, burn } = await setup(0n);
    await expect(burn()).rejects.toMatchObject({ errorCode: 'honk_balance' });
    expect(ctx.db.honkBurns.size).toBe(0);
  });

  it('a refused chat line refunds the burn', async () => {
    const { ctx, ride, burn } = await setup();
    await ctx.rideEvents.insert(RideEvent.message({ rideId: ride.id, wallet: 'fan', text: 'hi', now: ctx.now() }));
    await expect(burn()).rejects.toMatchObject({ errorCode: 'live_rate_limited' });
    expect(await ctx.honkRepo.balance('fan')).toBe(5n * U);
    expect(ctx.db.honkBurns.size).toBe(0);
  });

  it('the driver cannot honk their own ride, and a free ride has no stream', async () => {
    const { ctx, ride } = await setup();
    const handler = new BurnHonkHandler(ctx.liveAccess, ctx.players, ctx.honkRepo, ctx.rideEvents, ctx.transactions, ctx.clock, ctx.entropy, new OffHonkChain());
    await expect(handler.execute(new BurnHonkCommand('driver', ride.id))).rejects.toBeInstanceOf(ForbiddenError);
    const free = await ctx.freeRide('fan', true);
    await expect(handler.execute(new BurnHonkCommand('driver', free.id))).rejects.toMatchObject({ errorCode: 'free_ride_no_stream' });
  });

  it('a program id requires a confirmed burn of exactly 1 HONK, and a bad one does not debit', async () => {
    const off = await setup();
    expect((off.chain as OffHonkChain).loads).toBe(0);
    const missing = await setup(5n * U, new ScriptedHonkChain(burnTx('fan', U)));
    await expect(missing.burn()).rejects.toMatchObject({ errorCode: 'bad_signature' });
    expect((missing.chain as ScriptedHonkChain).loads).toBe(0);
    expect(await missing.ctx.honkRepo.balance('fan')).toBe(5n * U);
    const wrong = await setup(5n * U, new ScriptedHonkChain(burnTx('fan', 2n * U)));
    await expect(wrong.burn('sig')).rejects.toMatchObject({ errorCode: 'bad_signature' });
    expect(await wrong.ctx.honkRepo.balance('fan')).toBe(5n * U);
    expect(wrong.ctx.db.honkBurns.size).toBe(0);
    const down = await setup(5n * U, new ScriptedHonkChain(new ServiceUnavailableError('Solana RPC unavailable', 'honk_chain')));
    await expect(down.burn('sig')).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(await down.ctx.honkRepo.balance('fan')).toBe(5n * U);
    const ok = await setup(5n * U, new ScriptedHonkChain(burnTx('fan', U)));
    expect(await ok.burn('sig')).toEqual({ balance: '4', pays: '1' });
    expect((ok.chain as ScriptedHonkChain).loads).toBe(1);
  });
});

describe('MintHonkVisualHandler', () => {
  const setup = async (balance = 260n * U, chain: HonkChainPort = new OffHonkChain()) => {
    const ctx = unitContext();
    await ctx.player('w');
    if (balance > 0n) await ctx.honkRepo.credit('w', balance, ctx.now());
    const handler = new MintHonkVisualHandler(ctx.players, ctx.honkRepo, ctx.cosmetics, ctx.transactions, ctx.clock, ctx.hasher, ctx.entropy, chain);
    const mint = (slot = 'wheel', item = 'gold', signature?: string) => handler.execute(new MintHonkVisualCommand('w', slot, item, signature));
    return { ctx, mint, chain };
  };

  it('burns the price, unlocks the part as honk:<id> and wears it', async () => {
    const { ctx, mint, chain } = await setup();
    const id = visualId('w', 'wheel', 'gold');
    expect(await mint()).toEqual({ nft: { id, slot: 'wheel', item: 'gold', name: 'Wheel · Gold', burned: '260' }, balance: '0', chain: null });
    expect((chain as OffHonkChain).loads).toBe(0);
    expect(await ctx.cosmetics.has('w', 'wheel', 'gold')).toBe(true);
    expect((await ctx.cosmetics.listUnlocked('w'))[0]).toMatchObject({ code: `honk:${id}`, item: 'gold' });
    expect(await ctx.cosmetics.listEquipped('w')).toEqual({ wheel: 'gold' });
    expect((await ctx.honkRepo.account('w')).burned).toBe(260n * U);
    expect((await ctx.honkRepo.visuals('w'))[0]).toMatchObject({ chainMint: null, chainSignature: null });
  });

  it('a confirmed buy is stored on the visual and a bad one does not debit', async () => {
    const chain = new ScriptedHonkChain(partTx('w', 'wheel', 'gold', 260n * U));
    const { ctx, mint } = await setup(260n * U, chain);
    const id = visualId('w', 'wheel', 'gold');
    expect(await mint('wheel', 'gold', 'Sig111')).toEqual({ nft: { id, slot: 'wheel', item: 'gold', name: 'Wheel · Gold', burned: '260' }, balance: '0', chain: { mint: 'Mint111', signature: 'Sig111' } });
    expect((await ctx.honkRepo.visuals('w'))[0]).toMatchObject({ chainMint: 'Mint111', chainSignature: 'Sig111' });
    expect(await ctx.cosmetics.has('w', 'wheel', 'gold')).toBe(true);
    const bad = await setup(260n * U, new ScriptedHonkChain(partTx('w', 'wheel', 'ivory', 65n * U)));
    await expect(bad.mint('wheel', 'gold', 'sig')).rejects.toMatchObject({ errorCode: 'bad_signature' });
    expect(await bad.ctx.honkRepo.balance('w')).toBe(260n * U);
    expect(await bad.ctx.honkRepo.visuals('w')).toEqual([]);
    expect(await bad.ctx.cosmetics.has('w', 'wheel', 'gold')).toBe(false);
  });

  it('an unknown or default part is refused before any chain read', async () => {
    const chain = new ScriptedHonkChain(partTx('w', 'wheel', 'gold', 260n * U));
    const { mint } = await setup(260n * U, chain);
    await expect(mint('wheel', 'classic', 'sig')).rejects.toBeInstanceOf(BadRequestError);
    await expect(mint('seat', 'x', 'sig')).rejects.toMatchObject({ errorCode: 'bad_visual' });
    expect(chain.loads).toBe(0);
  });

  it('a part already owned burns nothing, and a short balance burns nothing', async () => {
    const { ctx, mint } = await setup();
    await mint();
    await expect(mint()).rejects.toMatchObject({ errorCode: 'already_owned' });
    expect(await ctx.honkRepo.balance('w')).toBe(0n);
    const poor = await setup(40n * U);
    await expect(poor.mint('needle', 'lime')).rejects.toBeInstanceOf(ConflictError);
    expect(await poor.ctx.cosmetics.has('w', 'needle', 'lime')).toBe(false);
  });

  it('a default or unknown part is not a visual', async () => {
    const { mint } = await setup();
    await expect(mint('wheel', 'classic')).rejects.toBeInstanceOf(BadRequestError);
    await expect(mint('seat', 'x')).rejects.toMatchObject({ errorCode: 'bad_visual' });
  });
});

describe('HONK queries', () => {
  it('the account lists what was minted, and the catalog is every cab part', async () => {
    const ctx = unitContext();
    await ctx.honkRepo.credit('w', 50n * U, ctx.now());
    const account = await new GetHonkHandler(ctx.honkRepo, new OffHonkChain()).execute(new GetHonkQuery('w'));
    expect(account).toMatchObject({ balance: '50', minted: '50', burned: '0', visuals: [], chain: null });
    expect(await new GetHonkHandler(ctx.honkRepo, new ScriptedHonkChain(null)).execute(new GetHonkQuery('w'))).toMatchObject({ chain: { programId: PROGRAM } });
    const catalog = await new GetHonkCatalogHandler(ctx.honkRepo).execute(new GetHonkCatalogQuery());
    expect(catalog).toHaveLength(54);
    expect(catalog.every((e) => e.isDefault === (e.price === null) && e.description.length > 0)).toBe(true);
    expect(catalog.find((e) => e.item === 'gold' && e.slot === 'wheel')).toEqual({ slot: 'wheel', item: 'gold', name: 'Wheel · Gold', description: 'A gold sheen ring, gold spokes, and a gold hub.', price: '260', isDefault: false });
    expect(catalog.find((e) => e.item === 'crimson')).toMatchObject({ price: '65', description: 'A dark rim with a red sheen ring and a pale mark.', isDefault: false });
    expect(catalog.find((e) => e.slot === 'wheel' && e.item === 'classic')).toEqual({ slot: 'wheel', item: 'classic', name: 'Wheel · Classic', description: 'The stock wheel: a black rim, a dark hub, and the amber mark.', price: null, isDefault: true });
    expect(catalog.find((e) => e.slot === 'ornament' && e.item === 'spear')).toEqual({ slot: 'ornament', item: 'spear', name: 'Ornament · Spear', description: 'The stock hood spear.', price: null, isDefault: true });
    expect(catalog.find((e) => e.slot === 'phone' && e.item === 'gold')).toMatchObject({ name: 'Phone · Gold', price: '260', isDefault: false });
  });
});
