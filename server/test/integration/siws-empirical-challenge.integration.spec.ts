import request from 'supertest';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { formatSignInMessage } from '../../src/domain/auth/auth-challenge.entity.js';
import { bindClient, newWallet, sign, type Wallet } from '../support/client.js';
import { createHarness, type Harness } from '../support/harness.js';

const PARALLEL = 20;
const ADMIN = newWallet();

describe('Empirical SIWS Challenge Suite (PostgreSQL)', () => {
  let harness: Harness;
  let prisma: PrismaService;
  const { anon, sec } = bindClient(() => harness);

  beforeAll(async () => {
    harness = await createHarness('postgres', { FREE_RIDE_SECONDS: '10', ADMIN_WALLETS: ADMIN.address });
    prisma = harness.app.get(PrismaService, { strict: false });
  });

  afterAll(() => harness.close());
  beforeEach(() => harness.reset());

  const parallel = <T>(n: number, fn: (i: number) => Promise<T>): Promise<T[]> =>
    Promise.all(Array.from({ length: n }, (_, i) => fn(i)));

  const makeCanonicalSiwsMessage = (ch: any, walletAddress: string, overrides: Record<string, any> = {}) => {
    return formatSignInMessage({
      domain: ch.domain,
      address: walletAddress,
      statement: ch.statement,
      uri: ch.uri,
      version: ch.version,
      chainId: ch.chainId,
      nonce: ch.nonce,
      issuedAt: ch.issuedAt,
      expirationTime: ch.expirationTime,
      ...overrides,
    });
  };

  describe('1. Replay Attacks & Single-Use Verification', () => {
    it('anonymous 1-click SIWS: duplicate verification calls for the same nonce fail (401)', async () => {
      const w = newWallet();
      const { body: ch } = await anon().post('/api/auth/nonce').send({}).expect(200);
      expect(ch.nonce).toBeDefined();

      const message = makeCanonicalSiwsMessage(ch, w.address);
      const signature = sign(w.kp, message);

      // Call 1: Valid initial verification
      const res1 = await anon().post('/api/auth/verify').send({ wallet: w.address, signature, message, nonce: ch.nonce }).expect(200);
      expect(res1.body.wallet).toBe(w.address);

      // Call 2: Immediate duplicate replay must fail with 401
      const res2 = await anon().post('/api/auth/verify').send({ wallet: w.address, signature, message, nonce: ch.nonce }).expect(401);
      expect(res2.body.detail ?? res2.body.message).toMatch(/no valid challenge/i);

      // Call 3: Subsequent replay must still fail with 401
      const res3 = await anon().post('/api/auth/verify').send({ wallet: w.address, signature, message, nonce: ch.nonce }).expect(401);
      expect(res3.body.detail ?? res3.body.message).toMatch(/no valid challenge/i);
    });

    it('legacy wallet challenge: duplicate verification calls fail (401)', async () => {
      const w = newWallet();
      const { body: ch } = await anon().post('/api/auth/nonce').send({ wallet: w.address }).expect(200);
      const signature = sign(w.kp, ch.message);

      // Call 1: Valid initial verification
      const res1 = await anon().post('/api/auth/verify').send({ wallet: w.address, signature }).expect(200);
      expect(res1.body.wallet).toBe(w.address);

      // Call 2: Replay must fail with 401
      const res2 = await anon().post('/api/auth/verify').send({ wallet: w.address, signature }).expect(401);
      expect(res2.body.detail ?? res2.body.message).toMatch(/no valid challenge/i);
    });

    it('burn-on-fail: a failed attempt burns the challenge so it cannot be retried/replayed', async () => {
      const w = newWallet();
      const { body: ch } = await anon().post('/api/auth/nonce').send({}).expect(200);
      const message = makeCanonicalSiwsMessage(ch, w.address);

      // Attacker attempts verification with bogus signature
      const bogusKey = newWallet();
      const bogusSig = sign(bogusKey.kp, message);
      await anon().post('/api/auth/verify').send({
        wallet: w.address,
        signature: bogusSig,
        message,
        nonce: ch.nonce,
      }).expect(401);

      // Honest user now tries with valid signature: challenge is already burned, must fail 401
      const validSig = sign(w.kp, message);
      const res = await anon().post('/api/auth/verify').send({
        wallet: w.address,
        signature: validSig,
        message,
        nonce: ch.nonce,
      }).expect(401);
      expect(res.body.detail ?? res.body.message).toMatch(/no valid challenge/i);
    });

    it('cross-wallet replay attack: attacker cannot reuse victim nonce with another wallet', async () => {
      const victim = newWallet();
      const attacker = newWallet();
      const { body: ch } = await anon().post('/api/auth/nonce').send({}).expect(200);

      // Victim signs
      const victimMsg = makeCanonicalSiwsMessage(ch, victim.address);
      const victimSig = sign(victim.kp, victimMsg);

      // Attacker intercepts victim signature and tries to verify as attacker wallet
      await anon().post('/api/auth/verify').send({
        wallet: attacker.address,
        signature: victimSig,
        message: victimMsg,
        nonce: ch.nonce,
      }).expect(401);

      // Challenge is burned by the failed attempt, neither attacker nor victim can reuse it
      await anon().post('/api/auth/verify').send({
        wallet: victim.address,
        signature: victimSig,
        message: victimMsg,
        nonce: ch.nonce,
      }).expect(401);
    });

    it('replay without explicit nonce parameter (extracted from message) fails on replay', async () => {
      const w = newWallet();
      const { body: ch } = await anon().post('/api/auth/nonce').send({}).expect(200);
      const message = makeCanonicalSiwsMessage(ch, w.address);
      const signature = sign(w.kp, message);

      // Verify without body.nonce (handler extracts nonce from message)
      await anon().post('/api/auth/verify').send({
        wallet: w.address,
        signature,
        message,
      }).expect(200);

      // Replay attempt without body.nonce
      await anon().post('/api/auth/verify').send({
        wallet: w.address,
        signature,
        message,
      }).expect(401);
    });
  });

  describe('2. Concurrency & Race Conditions', () => {
    it('race condition on anonymous SIWS: 20 parallel verifies for same nonce -> exactly 1 succeeds, 19 fail (401)', async () => {
      const w = newWallet();
      const { body: ch } = await anon().post('/api/auth/nonce').send({}).expect(200);
      const message = makeCanonicalSiwsMessage(ch, w.address);
      const signature = sign(w.kp, message);

      const results = await parallel(PARALLEL, () =>
        anon().post('/api/auth/verify').send({
          wallet: w.address,
          signature,
          message,
          nonce: ch.nonce,
        }),
      );

      const successes = results.filter((r) => r.status === 200);
      const unauthorized = results.filter((r) => r.status === 401);

      expect(successes).toHaveLength(1);
      expect(unauthorized).toHaveLength(PARALLEL - 1);

      // Confirm in PostgreSQL: challenge row is consumed and gone
      const remaining = await prisma.authChallenge.findUnique({
        where: { wallet: `nonce:${ch.nonce}` },
      });
      expect(remaining).toBeNull();

      // Exactly 1 player signin recorded
      expect(await prisma.signIn.count({ where: { wallet: w.address } })).toBe(1);
    });

    it('race condition on legacy challenge: 20 parallel verifies for same wallet -> exactly 1 succeeds, 19 fail (401)', async () => {
      const w = newWallet();
      const { body: ch } = await anon().post('/api/auth/nonce').send({ wallet: w.address }).expect(200);
      const signature = sign(w.kp, ch.message);

      const results = await parallel(PARALLEL, () =>
        anon().post('/api/auth/verify').send({
          wallet: w.address,
          signature,
        }),
      );

      const successes = results.filter((r) => r.status === 200);
      const unauthorized = results.filter((r) => r.status === 401);

      expect(successes).toHaveLength(1);
      expect(unauthorized).toHaveLength(PARALLEL - 1);

      const remaining = await prisma.authChallenge.findUnique({
        where: { wallet: w.address },
      });
      expect(remaining).toBeNull();
    });

    it('race condition on challenge issuance: 20 parallel creations for same wallet upsert cleanly', async () => {
      const w = newWallet();
      const results = await parallel(PARALLEL, () =>
        anon().post('/api/auth/nonce').send({ wallet: w.address }),
      );

      expect(results.every((r) => r.status === 200)).toBe(true);

      // In database: exactly 1 row exists for this wallet
      const challenges = await prisma.authChallenge.findMany({
        where: { wallet: w.address },
      });
      expect(challenges).toHaveLength(1);

      // The surviving challenge can be verified
      const sig = sign(w.kp, challenges[0].message);
      await anon().post('/api/auth/verify').send({
        wallet: w.address,
        signature: sig,
      }).expect(200);
    });

    it('race condition on anonymous challenge creation: 20 parallel creations yield 20 unique nonces', async () => {
      const results = await parallel(PARALLEL, () =>
        anon().post('/api/auth/nonce').send({}),
      );

      expect(results.every((r) => r.status === 200)).toBe(true);
      const nonces = results.map((r) => r.body.nonce);
      expect(new Set(nonces).size).toBe(PARALLEL);

      // All 20 exist in DB under nonce:<nonce>
      const dbChallenges = await prisma.authChallenge.findMany({
        where: { wallet: { in: nonces.map((n) => `nonce:${n}`) } },
      });
      expect(dbChallenges).toHaveLength(PARALLEL);
    });

    it('interleaved race: concurrent challenge request and verification for same wallet does not throw 500 or corrupt state', async () => {
      const w = newWallet();
      const { body: initialCh } = await anon().post('/api/auth/nonce').send({ wallet: w.address }).expect(200);
      const initialSig = sign(w.kp, initialCh.message);

      // Concurrently fire 5 verify requests with initial challenge and 5 new nonce requests
      const verifyOps = Array.from({ length: 5 }, () =>
        anon().post('/api/auth/verify').send({ wallet: w.address, signature: initialSig }),
      );
      const nonceOps = Array.from({ length: 5 }, () =>
        anon().post('/api/auth/nonce').send({ wallet: w.address }),
      );

      const mixedResults = await Promise.all([...verifyOps, ...nonceOps]);
      // All responses must be clean HTTP status (200 or 401), zero 500 server errors
      for (const res of mixedResults) {
        expect([200, 401]).toContain(res.status);
      }
    });

    it('multi-user concurrency: 20 distinct wallets concurrently perform full 1-click SIWS flow', async () => {
      const wallets = Array.from({ length: PARALLEL }, () => newWallet());

      const flowResults = await Promise.all(
        wallets.map(async (w) => {
          const { body: ch } = await anon().post('/api/auth/nonce').send({}).expect(200);
          const message = makeCanonicalSiwsMessage(ch, w.address);
          const signature = sign(w.kp, message);
          const verifyRes = await anon().post('/api/auth/verify').send({
            wallet: w.address,
            signature,
            message,
            nonce: ch.nonce,
          });
          return verifyRes;
        }),
      );

      expect(flowResults.every((r) => r.status === 200)).toBe(true);
      const returnedWallets = flowResults.map((r) => r.body.wallet);
      expect(new Set(returnedWallets).size).toBe(PARALLEL);
      expect(await prisma.signIn.count()).toBe(PARALLEL);
    });
  });

  describe('3. Backward Compatibility & Protocol Interoperability', () => {
    it('pure legacy client: specifies wallet, signs stored message, submits { wallet, signature } without message or nonce', async () => {
      const w = newWallet();
      const { body: ch } = await anon().post('/api/auth/nonce').send({ wallet: w.address }).expect(200);
      expect(ch.message).toContain(w.address);

      const signature = sign(w.kp, ch.message);
      const res = await anon().post('/api/auth/verify').send({
        wallet: w.address,
        signature,
      }).expect(200);

      expect(res.headers['set-cookie'][0]).toMatch(/fc_session=.*HttpOnly/);
      expect(res.body).toMatchObject({ wallet: w.address, freeRides: 10 });
    });

    it('pure modern SIWS client: empty body at nonce request, canonical format, submits { wallet, signature, message, nonce }', async () => {
      const w = newWallet();
      const { body: ch } = await anon().post('/api/auth/nonce').send({}).expect(200);
      expect(ch.address).toBeUndefined();

      const message = makeCanonicalSiwsMessage(ch, w.address);
      const signature = sign(w.kp, message);

      const res = await anon().post('/api/auth/verify').send({
        wallet: w.address,
        signature,
        message,
        nonce: ch.nonce,
      }).expect(200);

      expect(res.headers['set-cookie'][0]).toMatch(/fc_session=.*HttpOnly/);
      expect(res.body).toMatchObject({ wallet: w.address, freeRides: 10 });
    });

    it('hybrid flow A: wallet supplied at nonce request, but modern SIWS message signed and sent at verify', async () => {
      const w = newWallet();
      const { body: ch } = await anon().post('/api/auth/nonce').send({ wallet: w.address }).expect(200);

      const message = makeCanonicalSiwsMessage(ch, w.address);
      const signature = sign(w.kp, message);

      const res = await anon().post('/api/auth/verify').send({
        wallet: w.address,
        signature,
        message,
        nonce: ch.nonce,
      }).expect(200);

      expect(res.body.wallet).toBe(w.address);
    });

    it('hybrid flow B: nonce omitted in verify body but present in canonical message', async () => {
      const w = newWallet();
      const { body: ch } = await anon().post('/api/auth/nonce').send({}).expect(200);

      const message = makeCanonicalSiwsMessage(ch, w.address);
      const signature = sign(w.kp, message);

      const res = await anon().post('/api/auth/verify').send({
        wallet: w.address,
        signature,
        message,
      }).expect(200);

      expect(res.body.wallet).toBe(w.address);
    });

    it('invalid flow: anonymous challenge cannot be verified with bare { wallet, signature } without message/nonce', async () => {
      const w = newWallet();
      const { body: ch } = await anon().post('/api/auth/nonce').send({}).expect(200);
      const message = makeCanonicalSiwsMessage(ch, w.address);
      const signature = sign(w.kp, message);

      // Attempting legacy verify on anonymous challenge must fail (401)
      await anon().post('/api/auth/verify').send({
        wallet: w.address,
        signature,
      }).expect(401);
    });

    it('CRLF line-ending resilience: parses and validates SIWS message with Windows CRLF newlines', async () => {
      const w = newWallet();
      const { body: ch } = await anon().post('/api/auth/nonce').send({}).expect(200);

      const lfMessage = makeCanonicalSiwsMessage(ch, w.address);
      const crlfMessage = lfMessage.replace(/\n/g, '\r\n');
      const signature = sign(w.kp, crlfMessage);

      const res = await anon().post('/api/auth/verify').send({
        wallet: w.address,
        signature,
        message: crlfMessage,
        nonce: ch.nonce,
      }).expect(200);

      expect(res.body.wallet).toBe(w.address);
    });

    it('domain binding: rejects phishing domain in message', async () => {
      const w = newWallet();
      const { body: ch } = await anon().post('/api/auth/nonce').send({}).expect(200);

      const maliciousMsg = makeCanonicalSiwsMessage(ch, w.address, { domain: 'evil-phishing.org' });
      const signature = sign(w.kp, maliciousMsg);

      const res = await anon().post('/api/auth/verify').send({
        wallet: w.address,
        signature,
        message: maliciousMsg,
        nonce: ch.nonce,
      }).expect(401);

      expect(res.body.detail ?? res.body.message).toMatch(/domain mismatch/i);
    });

    it('address binding: rejects message where address header does not match wallet parameter', async () => {
      const w1 = newWallet();
      const w2 = newWallet();
      const { body: ch } = await anon().post('/api/auth/nonce').send({}).expect(200);

      const msg = makeCanonicalSiwsMessage(ch, w2.address); // message bound to w2
      const signature = sign(w2.kp, msg);

      const res = await anon().post('/api/auth/verify').send({
        wallet: w1.address, // submitting as w1
        signature,
        message: msg,
        nonce: ch.nonce,
      }).expect(401);

      expect(res.body.detail ?? res.body.message).toMatch(/address mismatch/i);
    });

    it('nonce binding: rejects forged nonce in SIWS message', async () => {
      const w = newWallet();
      const { body: ch } = await anon().post('/api/auth/nonce').send({}).expect(200);

      const msg = makeCanonicalSiwsMessage(ch, w.address, { nonce: 'forged_fake_nonce_12345' });
      const signature = sign(w.kp, msg);

      const res = await anon().post('/api/auth/verify').send({
        wallet: w.address,
        signature,
        message: msg,
        nonce: ch.nonce,
      }).expect(401);

      expect(res.body.detail ?? res.body.message).toMatch(/nonce mismatch/i);
    });

    it('expiration check: rejects message whose expirationTime is in the past', async () => {
      const w = newWallet();
      const { body: ch } = await anon().post('/api/auth/nonce').send({}).expect(200);

      const pastExpiry = new Date(Date.now() - 60_000).toISOString();
      const msg = makeCanonicalSiwsMessage(ch, w.address, { expirationTime: pastExpiry });
      const signature = sign(w.kp, msg);

      const res = await anon().post('/api/auth/verify').send({
        wallet: w.address,
        signature,
        message: msg,
        nonce: ch.nonce,
      }).expect(401);

      expect(res.body.detail ?? res.body.message).toMatch(/challenge expired/i);
    });

    it('server-side TTL expiration: rejects challenge when clock advances past server TTL', async () => {
      const w = newWallet();
      const { body: ch } = await anon().post('/api/auth/nonce').send({}).expect(200);
      const message = makeCanonicalSiwsMessage(ch, w.address);
      const signature = sign(w.kp, message);

      // Advance clock past 300s TTL
      sec(301);

      const res = await anon().post('/api/auth/verify').send({
        wallet: w.address,
        signature,
        message,
        nonce: ch.nonce,
      }).expect(401);

      expect(res.body.detail ?? res.body.message).toMatch(/no valid challenge/i);
    });

    it('admin auth remains backwards compatible: requires wallet, signs stored challenge', async () => {
      const agent = request.agent(harness.server());

      const { body: ch } = await agent
        .post('/api/admin/auth/nonce')
        .set('x-fc-admin', '1')
        .send({ wallet: ADMIN.address })
        .expect(200);

      expect(ch.message).toContain(ADMIN.address);
      const signature = sign(ADMIN.kp, ch.message);

      const res = await agent
        .post('/api/admin/auth/verify')
        .set('x-fc-admin', '1')
        .send({ wallet: ADMIN.address, signature })
        .expect(200);

      expect(res.headers['set-cookie'][0]).toMatch(/fc_admin=.*HttpOnly/);
    });
  });
});
