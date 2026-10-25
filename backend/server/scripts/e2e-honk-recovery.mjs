// Local validator + PostgreSQL recovery; rewards are seeded facts, not additional driven rides.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Keypair } from '@solana/web3.js';
import { PrismaService } from '../dist/infrastructure/prisma/prisma.service.js';
import { HonkPrismaRepository } from '../dist/infrastructure/prisma/repositories/honk.prisma.repository.js';
import { PlayerPrismaRepository } from '../dist/infrastructure/prisma/repositories/player.prisma.repository.js';
import { TransactionPrismaAdapter } from '../dist/infrastructure/prisma/transaction.prisma.adapter.js';
import { HonkEmissionAdapter } from '../dist/infrastructure/solana/honk-emission.adapter.js';
import { HonkMintService } from '../dist/application/services/honk-mint.service.js';
import { ReleaseHonkHandler } from '../dist/application/use-cases/honk/release-honk.handler.js';
import { ReleaseHonkCommand } from '../dist/application/use-cases/honk/release-honk.command.js';
import { honkBalance, mintRide, PROGRAM_ID } from './honk-program.mjs';

const { RPC, KEYS, DATABASE_URL } = process.env;
if (!RPC || !KEYS || !DATABASE_URL || !['127.0.0.1', 'localhost'].includes(new URL(RPC).hostname) || !new URL(DATABASE_URL).pathname.startsWith('/freightchain_honk_local_')) throw new Error('scratch local validator/database required');
const payerBytes = readFileSync(join(KEYS, 'payer.json'), 'utf8');
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(payerBytes)));
const player = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(KEYS, 'player.json'), 'utf8'))));
const wallet = player.publicKey.toBase58();
const env = { solanaRpc: RPC, honkProgramId: PROGRAM_ID.toBase58(), honkEmitterSecret: payerBytes };
const clock = { now: () => new Date() };
const db = new PrismaService();
const repo = new HonkPrismaRepository(db);
const players = new PlayerPrismaRepository(db);
const txs = new TransactionPrismaAdapter(db);
const real = new HonkEmissionAdapter(env);
const mints = new HonkMintService(repo, clock, real);
const worker = (emission) => new ReleaseHonkHandler(repo, mints, players, txs, emission, clock);
const expireLease = (rideId) => db.honkMint.update({ where: { rideId }, data: { chainRetryAt: new Date(0) } });
const seed = (rideId) => txs.run(async (tx) => {
  assert.ok(await players.findByWalletForUpdate(wallet, tx));
  return mints.credit({ rideId, wallet, tier: '1h', distance: 100, completeDist: 100 }, tx);
});
try {
  for (const crashAfterSend of [false, true]) {
    const rideId = randomUUID();
    const beforeChain = await honkBalance({ rpc: RPC, owner: player.publicKey });
    const beforeLedger = await repo.balance(wallet);
    assert.equal(await seed(rideId), 100_000_000n);
    const failing = crashAfterSend ? {
      enabled: () => true,
      mint: async (...args) => { await real.mint(...args); throw new Error('simulate lost response after confirmed transaction'); },
    } : new HonkEmissionAdapter({ ...env, solanaRpc: 'http://127.0.0.1:9' });
    await worker(failing).execute(new ReleaseHonkCommand());
    assert.equal((await repo.findMint(rideId)).chainPending, true);
    assert.equal((await honkBalance({ rpc: RPC, owner: player.publicKey })) - beforeChain, crashAfterSend ? 100_000_000n : 0n);
    // Only the retry lease is accelerated. Chain time and reward amounts remain real.
    await expireLease(rideId);
    await worker(new HonkEmissionAdapter(env)).execute(new ReleaseHonkCommand());
    assert.equal((await repo.findMint(rideId)).chainPending, false);
    assert.equal((await honkBalance({ rpc: RPC, owner: player.publicKey })) - beforeChain, 100_000_000n);
    assert.equal((await repo.balance(wallet)) - beforeLedger, 100_000_000n);
    await worker(new HonkEmissionAdapter(env)).execute(new ReleaseHonkCommand());
    assert.equal((await honkBalance({ rpc: RPC, owner: player.publicKey })) - beforeChain, 100_000_000n);
    console.log(`ok recovery ${crashAfterSend ? 'after landed transaction' : 'before broadcast'}: exactly one ledger credit and chain payment`);
  }
  const ride = Buffer.from(randomUUID().replaceAll('-', ''), 'hex');
  const before = await honkBalance({ rpc: RPC, owner: player.publicKey });
  await assert.rejects(mintRide({ rpc: RPC, emitter: payer, rider: wallet, rideId: ride, expectedAmount: 99_000_000n }), /RewardMismatch|0x1781/);
  assert.equal(await honkBalance({ rpc: RPC, owner: player.publicKey }), before);
  console.log('ok mismatched reserved reward refuses atomically');
} finally { await db.$disconnect(); }
