// Drives the shipped convoy and airdrop services (compiled dist). M1 and the airdrop claim stay held until 48 hours.
import assert from 'node:assert/strict';
import { AirdropService } from '../dist/application/airdrop/airdrop.service.js';
import { airdropCode } from '../dist/application/airdrop/airdrop-rules.js';
import { ConvoyService } from '../dist/application/referral/convoy.service.js';
import { PlayerRepositoryPort } from '../dist/application/ports/players/player.repository.port.js';
import { ClockPort } from '../dist/application/ports/shared/clock.port.js';
import { TransactionPort } from '../dist/application/ports/shared/transaction.port.js';
import { NameServicePort } from '../dist/application/ports/sns/name-service.port.js';
import { TelegramMembershipPort } from '../dist/application/airdrop/telegram.port.js';
import { TurnstilePort } from '../dist/application/airdrop/turnstile.port.js';
import { XAccountPort } from '../dist/application/airdrop/x-account.port.js';
import { MemoryAirdropRepository } from '../dist/infrastructure/social/memory-airdrop.repository.js';
import { MemoryConvoyRepository } from '../dist/infrastructure/social/memory-convoy.repository.js';
import { Player } from '../dist/domain/players/player.entity.js';
import { DAY_MS } from '../dist/domain/shared/time.js';

const start = new Date(Date.UTC(2026, 9, 19));

class Clock extends ClockPort { at = start; now() { return this.at; } }
class Tx extends TransactionPort { run(fn) { return fn({}); } }
class Players extends PlayerRepositoryPort {
  constructor() { super(); this.rows = new Map(); }
  add(wallet, trust = 60) {
    this.rows.set(wallet, Player.restore({ wallet, version: 1, freeRides: 0, freeDay: '2026-10-19', freeRidesMax: 1, createdAt: start, tutorialPassedAt: null, age18At: null, lossAt: null, trustScore: trust, termsVersion: 1, privacyVersion: 1, rejectedRides: 0 }));
  }
  findByWallet(wallet) { return Promise.resolve(this.rows.get(wallet) ?? null); }
  findByWalletForUpdate(wallet) { return this.findByWallet(wallet); }
  insertIfAbsent() { return Promise.resolve(false); }
  grantDailyFreeRides() { return Promise.resolve(0); }
  save(player) { this.rows.set(player.wallet, player); return Promise.resolve(player); }
}
class Names extends NameServicePort {
  reverse() { return Promise.resolve(null); }
  reverseBatch() { return Promise.resolve(new Map()); }
  resolve() { return Promise.resolve(null); }
}

export async function runGrantHold() {
  const clock = new Clock();
  const players = new Players();
  players.add('ref');
  players.add('referee');
  const grants = [];
  const promos = { findByCode: async () => null, insert: async () => true, disable: async () => true, insertGrant: async (row) => { grants.push(row); } };
  const convoy = new ConvoyService(new MemoryConvoyRepository(), players, new Tx(), clock, new Names(), promos);
  let seq = 0;
  const fact = (wallet, trip) => ({ rideId: `${wallet}-${seq += 1}`, wallet, status: 'completed', verdict: 'verified', trip });
  await convoy.onVerifiedRide(fact('ref', 'free-1c'));
  await convoy.bind('referee', 'ref');
  await convoy.onVerifiedRide(fact('referee', 'free-2c'));
  assert.equal(grants.length, 1);
  assert.equal(grants[0].tier, '1h');
  clock.at = new Date(start.getTime() + 7 * DAY_MS);
  await convoy.onVerifiedRide(fact('ref', 'free-3c'));
  const held = await convoy.onVerifiedRide(fact('referee', 'free-3c'));
  clock.at = new Date(clock.at.getTime() + 48 * 3_600_000);
  const released = await convoy.onVerifiedRide(fact('referee', 'free-3c'));

  const ada = new Players();
  ada.add('ada');
  const code = airdropCode('ada');
  class Telegram extends TelegramMembershipPort { getChatMember() { return Promise.resolve({ status: 'member' }); } }
  class Turnstile extends TurnstilePort { verify() { return Promise.resolve(true); } }
  class Accounts extends XAccountPort {
    lookup() { return Promise.resolve({ userId: '99', handle: 'ada', createdAt: new Date(start.getTime() - 90 * DAY_MS), followers: 10, followsOfficial: true }); }
    quote() { return Promise.resolve({ userId: '99', text: `@FreightChainSol ${code}` }); }
  }
  const airdrop = new AirdropService(new MemoryAirdropRepository(), new Telegram(), new Accounts(), new Turnstile(), ada, new Tx(), clock);
  await airdrop.recordVerifiedRide('ada', 'free-2c');
  await airdrop.verifyTelegram('ada', '100');
  await airdrop.verifyX('ada', 'ada', '55');
  const trustAfterSocial = (await ada.findByWallet('ada'))?.trustScore;
  const claimBefore48h = (await airdrop.claim('ada')).claimed;
  clock.at = new Date(clock.at.getTime() + 48 * 3_600_000);
  const claimAfter48h = (await airdrop.claim('ada')).claimed;
  return { m1OnEarn: held.milestones.m1, m1After48h: released.milestones.m1, trustAfterSocial, claimBefore48h, claimAfter48h };
}

if (process.argv[1] && process.argv[1].endsWith('wave5-grant-hold.mjs')) {
  await runGrantHold();
}
