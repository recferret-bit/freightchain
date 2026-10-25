// Real local-chain receipts + PostgreSQL settlement. Seeded milestone facts, not additional driven rides.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Keypair } from '@solana/web3.js';
import { PrismaService } from '../dist/infrastructure/prisma/prisma.service.js';
import { ConvoyPrismaRepository } from '../dist/infrastructure/prisma/repositories/convoy.prisma.repository.js';
import { HonkPrismaRepository } from '../dist/infrastructure/prisma/repositories/honk.prisma.repository.js';
import { PlayerPrismaRepository } from '../dist/infrastructure/prisma/repositories/player.prisma.repository.js';
import { TransactionPrismaAdapter } from '../dist/infrastructure/prisma/transaction.prisma.adapter.js';
import { ReferralEmissionAdapter } from '../dist/infrastructure/solana/referral-emission.adapter.js';
import { ReleaseConvoyHandler } from '../dist/application/referral/release-convoy.handler.js';
import { ReleaseConvoyCommand } from '../dist/application/referral/release-convoy.command.js';
import { Player } from '../dist/domain/players/player.entity.js';
import { honkBalance, PROGRAM_ID } from './honk-program.mjs';

const { RPC, KEYS, DATABASE_URL } = process.env;
if (!RPC || !KEYS || !DATABASE_URL || !['127.0.0.1', 'localhost'].includes(new URL(RPC).hostname) || !['127.0.0.1', 'localhost'].includes(new URL(DATABASE_URL).hostname) || !new URL(DATABASE_URL).pathname.startsWith('/freightchain_honk_local_')) throw new Error('scratch local validator/database required');
const payerBytes = readFileSync(join(KEYS, 'payer.json'), 'utf8');
const recipient = Keypair.generate().publicKey;
const wallet = recipient.toBase58();
const env = { solanaRpc: RPC, honkProgramId: PROGRAM_ID.toBase58(), honkEmitterSecret: payerBytes };
const clock = { now: () => new Date() }, entropy = { uuid: () => randomUUID() };
const db = new PrismaService(), other = new PrismaService();
const repo = new ConvoyPrismaRepository(db), honk = new HonkPrismaRepository(db);
const players = new PlayerPrismaRepository(db), txs = new TransactionPrismaAdapter(db);
const real = () => new ReferralEmissionAdapter(env);
const worker = (emission, prisma = db) => new ReleaseConvoyHandler(new ConvoyPrismaRepository(prisma), new PlayerPrismaRepository(prisma), new TransactionPrismaAdapter(prisma), emission, new HonkPrismaRepository(prisma), clock, entropy);
const run = (emission, prisma) => worker(emission, prisma).execute(new ReleaseConvoyCommand());
const seed = async () => {
  const friend = Keypair.generate().publicKey.toBase58(), id = `convoy:m1:${friend}`;
  await players.insertIfAbsent(Player.register(friend, clock.now(), 0, 0));
  await txs.run(async (tx) => {
    for (const w of [wallet, friend].sort()) assert.ok(await players.findByWalletForUpdate(w, tx));
    await repo.insertLedger({ id, kind: 'm1', wallet, referrer: wallet, referee: friend, amount: 100, unit: 'ten4', at: new Date(Date.now() - 48 * 3600_000 - 1), dayKey: 'fixture', weekKey: 'fixture', chainState: 'held', releasedAt: null }, tx);
  });
  return id;
};
try {
  await players.insertIfAbsent(Player.register(wallet, clock.now(), 0, 0));
  // The local runner stops its API before this test, so only these explicit workers process fixture rewards.
  const unpaid = await seed();
  await run(new ReferralEmissionAdapter({ ...env, solanaRpc: 'http://127.0.0.1:9' }));
  assert.equal((await repo.findLedger(unpaid)).chainState, 'held');
  assert.equal(await honkBalance({ rpc: RPC, owner: recipient }), 0n);
  await db.convoyLedger.update({ where: { id: unpaid }, data: { chainRetryAt: new Date(0) } });
  assert.equal(await run(real(), other), 1);
  assert.equal(await honk.balance(wallet), 100_000_000n);
  assert.equal(await honkBalance({ rpc: RPC, owner: recipient }), 100_000_000n);
  console.log('ok Convoy restart after pre-broadcast RPC failure');

  const lost = await seed();
  await run({ enabled: () => true, settle: async (payment) => { await real().settle(payment); throw new Error('lost response after confirmed payment'); } });
  assert.equal((await repo.findLedger(lost)).chainState, 'held');
  assert.ok((await repo.findLedger(lost)).chainSignature);
  assert.equal(await honk.balance(wallet), 100_000_000n);
  assert.equal(await honkBalance({ rpc: RPC, owner: recipient }), 200_000_000n);
  await db.convoyLedger.update({ where: { id: lost }, data: { chainRetryAt: new Date(0) } });
  const results = await Promise.all([run(real()), run(real(), other)]);
  assert.equal(results.reduce((a, b) => a + b, 0), 1);
  assert.equal(await honk.balance(wallet), 200_000_000n);
  assert.equal(await honkBalance({ rpc: RPC, owner: recipient }), 200_000_000n);
  assert.equal(await run(real()), 0);
  console.log('ok Convoy lost-response receipt recovery and competing workers: exactly one credit/payment');

  for (let i = 2; i < 10; i++) { await seed(); assert.equal(await run(real()), 1); }
  assert.equal(await honk.balance(wallet), 1_000_000_000n);
  assert.equal(await honkBalance({ rpc: RPC, owner: recipient }), 1_000_000_000n);
  const capped = await seed();
  assert.equal(await run(real()), 0);
  assert.equal((await repo.findLedger(capped)).chainState, 'capped');
  assert.equal((await repo.findLedger(capped)).capReason, 'wallet');
  assert.equal(await run(real(), other), 0);
  assert.equal(await honk.balance(wallet), 1_000_000_000n);
  assert.equal(await honkBalance({ rpc: RPC, owner: recipient }), 1_000_000_000n);
  console.log('ok Convoy real monthly wallet cap: terminal refusal, no unpaid ledger credit or retry backlog');
} finally { await other.$disconnect(); await db.$disconnect(); }
