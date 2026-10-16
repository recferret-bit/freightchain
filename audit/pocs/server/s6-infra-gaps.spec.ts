import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair } from '@solana/web3.js';
import { validateEnv } from '../../../../src/infrastructure/config/env.schema.js';
import { EnvService } from '../../../../src/infrastructure/config/env.service.js';
import { endRideBodySchema, createRideBodySchema } from '../../../../src/presentation/rides/dto/rides.dto.js';
import { redeemPromoBodySchema } from '../../../../src/presentation/economy/dto/pools.dto.js';

/**
 * These assertions describe the secure behaviour. They fail on the current tree on purpose:
 * they are the proof for the S6 findings, not a regression suite that should be green.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '../../../../../');
const read = (rel: string) => readFileSync(join(repo, rel), 'utf8');

const prod = {
  DATABASE_URL: 'postgresql://x',
  NODE_ENV: 'production',
  JWT_SECRET: 'a'.repeat(32),
  TREASURY_PUBKEY: Keypair.generate().publicKey.toBase58(),
  TRUST_PROXY: '1',
};

describe('S6 gaps (expected to fail until fixed)', () => {
  it('production refuses a 32-character repeated JWT_SECRET', () => {
    expect(() => validateEnv(prod)).toThrow(/JWT_SECRET/);
  });

  it('production requires a distinct ADMIN_JWT_SECRET (not a public derivation of JWT_SECRET)', () => {
    expect(validateEnv(prod).ADMIN_JWT_SECRET).toEqual(expect.any(String));
    const saved = { ...process.env };
    process.env = { ...prod, ADMIN_JWT_SECRET: '' };
    try {
      const env = new EnvService();
      const derived = createHash('sha256').update(`${env.jwtSecret}:admin-session`).digest('hex');
      expect(env.adminJwtSecret).not.toBe(derived);
    } finally {
      process.env = saved;
    }
  });

  it('a simple urlencoded body cannot end a ride, create one, or redeem a promo', () => {
    // Nest registers express.urlencoded by default (platform-express registerParserMiddleware).
    // These objects are what that parser produces from a form POST. SameSite=Lax still sends
    // the apex session cookie on a same-site form POST from storybook.* / whitepaper.* / ride.*.
    expect(endRideBodySchema.safeParse({ outcome: 'failed', s: '0' }).success).toBe(false);
    expect(createRideBodySchema.safeParse({ tier: 'free' }).success).toBe(false);
    expect(redeemPromoBodySchema.safeParse({ code: 'FREEBIE' }).success).toBe(false);
  });

  it('every public nginx template sets CSP, frame-ancestors, HSTS and Referrer-Policy', () => {
    for (const rel of [
      'deploy/nginx/site.conf.template',
      'deploy/nginx/admin.conf.template',
      'deploy/nginx/storybook.conf.template',
      'deploy/nginx/whitepaper.conf.template',
    ]) {
      const text = read(rel);
      expect(text, rel).toMatch(/Content-Security-Policy/);
      expect(text, rel).toMatch(/frame-ancestors/);
      expect(text, rel).toMatch(/Strict-Transport-Security/);
      expect(text, rel).toMatch(/Referrer-Policy/);
    }
    expect(read('deploy/scripts/remote/setup.sh')).toMatch(/--hsts/);
  });

  it('play.html and viewer.html pin three.js with a subresource integrity hash', () => {
    for (const rel of ['client/play.html', 'client/viewer.html']) {
      const text = read(rel);
      expect(text, rel).toMatch(/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0/);
      expect(text, rel).toMatch(/integrity=/);
    }
  });
});
