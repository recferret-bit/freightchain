import { resolveSettings } from '../../../../src/domain/settings/game-settings.js';
import type { GameSettingsService } from '../../../../src/application/services/game-settings.service.js';
import { PlayerRepositoryPort } from '../../../../src/application/ports/players/player.repository.port.js';
import { ClockPort } from '../../../../src/application/ports/shared/clock.port.js';
import { TransactionPort, type TransactionHandle } from '../../../../src/application/ports/shared/transaction.port.js';
import { AirdropService } from '../../../../src/application/airdrop/airdrop.service.js';
import { airdropCode, xAgeOk, xQuoteOk } from '../../../../src/application/airdrop/airdrop-rules.js';
import { TelegramMembershipPort } from '../../../../src/application/airdrop/telegram.port.js';
import { TurnstilePort } from '../../../../src/application/airdrop/turnstile.port.js';
import { XAccountPort, type XPost, type XProfile } from '../../../../src/application/airdrop/x-account.port.js';
import { MemoryAirdropRepository } from '../../../../src/infrastructure/social/memory-airdrop.repository.js';
import { Player } from '../../../../src/domain/players/player.entity.js';
import { DAY_MS } from '../../../../src/domain/shared/time.js';

const NOW = new Date(Date.UTC(2026, 9, 20));

class FakeClock extends ClockPort {
  constructor(public at: Date) { super(); }
  now(): Date { return this.at; }
}
class FakeTx extends TransactionPort {
  run<T>(fn: (tx: TransactionHandle) => Promise<T>): Promise<T> { return fn({} as TransactionHandle); }
}
class FakePlayers extends PlayerRepositoryPort {
  private readonly rows = new Set<string>();
  add(wallet: string): void { this.rows.add(wallet); }
  findByWallet(): Promise<Player | null> { return Promise.resolve(null); }
  findByWalletForUpdate(wallet: string): Promise<Player | null> {
    if (!this.rows.has(wallet)) return Promise.resolve(null);
    return Promise.resolve(Player.restore({ wallet, version: 1, freeRides: 0, freeDay: '2026-10-20', freeRidesMax: 1, createdAt: new Date(0), tutorialPassedAt: null, age18At: null, lossAt: null }));
  }
  insertIfAbsent(): Promise<boolean> { return Promise.resolve(false); }
  grantDailyFreeRides(): Promise<number> { return Promise.resolve(0); }
  save(player: Player): Promise<Player> { return Promise.resolve(player); }
}
class FakeTelegram extends TelegramMembershipPort {
  status = 'member';
  groupStatus: string | null = null;
  calls = 0;
  getChatMember(input: { telegramUserId: string; chatId: string; target?: 'channel' | 'group' }): Promise<{ status: string }> {
    this.calls += 1;
    expect(input.chatId).toBe('@FreightChain');
    return Promise.resolve({ status: input.target === 'group' ? this.groupStatus ?? this.status : this.status });
  }
}
class FakeX extends XAccountPort {
  profile: XProfile | null = null;
  text = '';
  postUser: string | null = null;
  lookups = 0;
  lastHandle = '';
  lookup(handle: string): Promise<XProfile | null> { this.lookups += 1; this.lastHandle = handle; return Promise.resolve(this.profile); }
  quote(): Promise<XPost | null> {
    if (!this.profile || this.postUser === null) return Promise.resolve(null);
    return Promise.resolve({ userId: this.postUser, text: this.text });
  }
}
class FakeTurnstile extends TurnstilePort {
  calls = 0;
  ok = true;
  verify(token: string): Promise<boolean> { this.calls += 1; return Promise.resolve(this.ok && token.length > 0); }
}

function harness() {
  const players = new FakePlayers();
  const telegram = new FakeTelegram();
  const x = new FakeX();
  const turnstile = new FakeTurnstile();
  const repo = new MemoryAirdropRepository();
  const clock = new FakeClock(NOW);
  const svc = new AirdropService(repo, telegram, x, turnstile, players, new FakeTx(), clock, { current: async () => resolveSettings([{ key: 'airdrop_x_check_cost_cents', value: 1 }]) } as GameSettingsService);
  players.add('ada');
  players.add('bob');
  x.profile = { userId: '99', handle: 'ada', createdAt: new Date(NOW.getTime() - 90 * DAY_MS), followers: 10, followsOfficial: true };
  return { players, telegram, x, turnstile, svc, clock };
}

describe('airdrop rules', () => {
  it('does not award trust again when the same social accounts are reverified', async () => {
    const h = harness();
    const save = vi.spyOn(h.players, 'save');
    await h.svc.recordVerifiedRide('ada', 'free-2c');
    await h.svc.verifyTelegram('ada', '42');
    await h.svc.verifyTelegram('ada', '42');
    h.x.postUser = '99';
    h.x.text = `@FreightChainSol ${airdropCode('ada')}`;
    await h.svc.verifyX('ada', 'ada', 'post');
    await h.svc.verifyX('ada', 'ada', 'post');
    expect(save).toHaveBeenCalledTimes(2);
  });
  it('builds a stable code and checks age, followers, and the quote', () => {
    expect(airdropCode('ada')).toBe(airdropCode('ada'));
    expect(airdropCode('ada')).toBe('FC-ada');
    expect(airdropCode('ABCDone')).not.toBe(airdropCode('ABCDtwo'));
    expect(xAgeOk(new Date(NOW.getTime() - 90 * DAY_MS), NOW)).toBe(true);
    expect(xAgeOk(new Date(NOW.getTime() - 90 * DAY_MS + 1), NOW)).toBe(false);
    const code = airdropCode('ada');
    expect(xQuoteOk(`joined @FreightChainSol ${code}`, code)).toBe(true);
    expect(xQuoteOk(`joined @freightchainsol ${code}`, code)).toBe(true);
    expect(xQuoteOk('@FreightChainSol only', code)).toBe(false);
    expect(xQuoteOk(`@FreightChainSolFake ${code}`, code)).toBe(false);
    expect(xQuoteOk(`@FreightChainSol ${code}Extra`, code)).toBe(false);
  });
});

describe('AirdropService', () => {
  it('locks social steps behind a verified MEDIUM or HARD ride', async () => {
    const h = harness();
    expect((await h.svc.status('ada')).rideUnlocked).toBe(false);
    expect((await h.svc.recordVerifiedRide('ada', 'free-1c')).rideUnlocked).toBe(false);
    expect((await h.svc.recordVerifiedRide('ada', '1h')).rideUnlocked).toBe(false);
    await expect(h.svc.verifyTelegram('ada', '100')).rejects.toMatchObject({ errorCode: 'ride_required' });
    expect(h.telegram.calls).toBe(0);
    expect((await h.svc.recordVerifiedRide('ada', 'free-2c')).rideUnlocked).toBe(true);
    expect((await h.svc.recordVerifiedRide('ada', 'free-3c')).rideUnlocked).toBe(true);
  });

  it('binds telegram once and rejects a second wallet, a non-member, and an id change', async () => {
    const h = harness();
    await h.svc.recordVerifiedRide('ada', 'free-2c');
    await h.svc.recordVerifiedRide('bob', 'free-3c');
    h.telegram.status = 'kicked';
    await expect(h.svc.verifyTelegram('ada', '100')).rejects.toMatchObject({ errorCode: 'telegram_not_member' });
    h.telegram.status = 'member';
    h.telegram.groupStatus = 'left';
    await expect(h.svc.verifyTelegram('ada', '100')).rejects.toMatchObject({ errorCode: 'telegram_group_required' });
    expect((await h.svc.status('ada')).telegram.bound).toBe(false);
    h.telegram.groupStatus = 'member';
    expect((await h.svc.verifyTelegram('ada', '100')).telegram).toMatchObject({ bound: true, member: true, groupMember: true });
    expect((await h.svc.verifyTelegram('ada', '100')).telegram.member).toBe(true);
    await expect(h.svc.verifyTelegram('bob', '100')).rejects.toMatchObject({ errorCode: 'social_account_already_bound' });
    await expect(h.svc.verifyTelegram('ada', '200')).rejects.toMatchObject({ errorCode: 'social_account_already_bound' });
    expect(h.turnstile.calls).toBe(0);
  });

  it('checks X age, followers, follow, and quote, then refuses a reused x user id', async () => {
    const h = harness();
    await h.svc.recordVerifiedRide('ada', 'free-2c');
    await h.svc.recordVerifiedRide('bob', 'free-3c');
    const code = (await h.svc.status('ada')).code;
    h.x.profile = { ...h.x.profile!, createdAt: new Date(NOW.getTime() - 90 * DAY_MS + 1) };
    await expect(h.svc.verifyX('ada', '@ada', '55')).rejects.toMatchObject({ errorCode: 'x_account_too_new' });
    h.x.profile = { ...h.x.profile!, createdAt: new Date(NOW.getTime() - 90 * DAY_MS), followers: 9 };
    h.clock.at = new Date(h.clock.at.getTime() + 600001);
    await expect(h.svc.verifyX('ada', 'ada', '55')).rejects.toMatchObject({ errorCode: 'x_too_few_followers' });
    h.x.profile = { ...h.x.profile!, followers: 10, followsOfficial: false };
    h.clock.at = new Date(h.clock.at.getTime() + 600001);
    await expect(h.svc.verifyX('ada', 'ada', '55')).rejects.toMatchObject({ errorCode: 'x_not_following' });
    h.x.profile = { ...h.x.profile!, followsOfficial: true };
    h.x.text = 'no code';
    h.x.postUser = '99';
    h.clock.at = new Date(h.clock.at.getTime() + 600001);
    await expect(h.svc.verifyX('ada', 'ada', '55')).rejects.toMatchObject({ errorCode: 'x_quote_missing' });
    h.x.text = `@FreightChainSol ${code}`;
    h.x.postUser = 'someone-else';
    h.clock.at = new Date(h.clock.at.getTime() + 600001);
    await expect(h.svc.verifyX('ada', 'ada', '55')).rejects.toMatchObject({ errorCode: 'x_quote_missing' });
    h.x.postUser = '99';
    h.clock.at = new Date(h.clock.at.getTime() + 600001);
    const verified = await h.svc.verifyX('ada', '@ada', '55');
    expect(h.x.lastHandle).toBe('ada');
    expect(verified.x).toEqual({ bound: true, ageOk: true, followersOk: true, follows: true, quoteOk: true });
    h.x.profile = { ...h.x.profile!, userId: '99' };
    const bobCode = (await h.svc.status('bob')).code;
    h.x.text = `@FreightChainSol ${bobCode}`;
    h.clock.at = new Date(h.clock.at.getTime() + 600001);
    await expect(h.svc.verifyX('bob', 'ada', '56')).rejects.toMatchObject({ errorCode: 'social_account_already_bound' });
    h.x.profile = null;
    h.clock.at = new Date(h.clock.at.getTime() + 600001);
    await expect(h.svc.verifyX('bob', 'missing', '57')).rejects.toMatchObject({ errorCode: 'x_account_not_found' });
  });

  it('claims a ledger row once, and only calls turnstile when a test enables it', async () => {
    const h = harness();
    await h.svc.recordVerifiedRide('ada', 'free-2c');
    const code = (await h.svc.status('ada')).code;
    await h.svc.verifyTelegram('ada', '100');
    h.x.text = `@FreightChainSol ${code}`;
    h.x.postUser = '99';
    await h.svc.verifyX('ada', 'ada', '55');
    await expect(h.svc.claim('bob')).rejects.toMatchObject({ errorCode: 'ride_required' });
    const held = await h.svc.claim('ada');
    expect(held).toMatchObject({ claimed: false, settlement: 'ledger', turnstile: { required: false, passed: false } });
    h.clock.at = new Date(NOW.getTime() + 48 * 3_600_000);
    const claimed = await h.svc.claim('ada');
    expect(claimed).toMatchObject({ claimed: true, settlement: 'ledger', turnstile: { required: false, passed: false } });
    expect(h.turnstile.calls).toBe(0);
    const lookups = h.x.lookups;
    h.clock.at = new Date(NOW.getTime() + DAY_MS);
    const again = await h.svc.claim('ada');
    expect(again.claimedAt).toBe(claimed.claimedAt);
    expect(h.x.lookups).toBe(lookups);
    h.svc.turnstileEnabled = true;
    h.turnstile.ok = false;
    await expect(h.svc.verifyTelegram('ada', '100', 'bad')).rejects.toMatchObject({ errorCode: 'turnstile_failed' });
    h.turnstile.ok = true;
    expect((await h.svc.claim('ada', 'ok-token')).turnstile.passed).toBe(false);
    expect(h.turnstile.calls).toBeGreaterThan(0);
  });
});
