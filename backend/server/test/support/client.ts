import request from 'supertest';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import type { Harness } from './harness.js';

export type Agent = ReturnType<typeof request.agent>;
export interface Wallet {
  kp: nacl.SignKeyPair;
  address: string;
}
export interface Rider extends Wallet {
  /** keeps the httpOnly session cookie, like a browser */
  agent: Agent;
}

export const newWallet = (): Wallet => {
  const kp = nacl.sign.keyPair();
  return { kp, address: bs58.encode(kp.publicKey) };
};

/** What Phantom's signMessage does: an ed25519 signature over the UTF-8 message, base58. */
export const sign = (kp: nacl.SignKeyPair, message: string): string => bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));

/** Test helpers bound to one harness: wallets, sign-in, and time. */
export function bindClient(h: () => Harness) {
  const server = () => h().server();
  const anon = () => request(server());
  /**
   * A signed-in rider (full Sign-In-With-Solana through the real endpoints).
   * The product default is both boxes OFF. This fixture turns them ON unless `{ offer: false }`, so paid-flow tests stay about payments.
   */
  async function login(w: Wallet = newWallet(), opts: { offer?: boolean; terms?: boolean } = {}): Promise<Rider> {
    const agent = request.agent(server());
    const { body } = await agent.post('/api/auth/nonce').send({ wallet: w.address }).expect(200);
    await agent.post('/api/auth/verify').send({ wallet: w.address, signature: sign(w.kp, body.message) }).expect(200);
    if (opts.terms !== false) {
      const { body: current } = await agent.get('/api/profile/terms').expect(200);
      await agent.post('/api/profile/terms').send({ termsVersion: current.termsVersion, privacyVersion: current.privacyVersion, age18: true, accepted: true }).expect(200);
    }
    if (opts.offer === false && opts.terms !== false) await agent.put('/api/profile/agreements').send({ age18: false, loss: false }).expect(200);
    if (opts.offer !== false) await agent.put('/api/profile/agreements').send({ age18: true, loss: true }).expect(200);
    return { agent, ...w };
  }
  /** an admin: the ADMIN sign-in (/api/admin/auth/*, the fc_admin cookie) – no player session; pass an agent to add it to a signed-in rider */
  async function loginAdmin(w: Wallet, agent: Agent = request.agent(server())): Promise<Rider> {
    const { body } = await agent.post('/api/admin/auth/nonce').set('x-fc-admin', '1').send({ wallet: w.address }).expect(200);
    await agent.post('/api/admin/auth/verify').set('x-fc-admin', '1').send({ wallet: w.address, signature: sign(w.kp, body.message) }).expect(200);
    return { agent, ...w };
  }
  return { server, anon, login, loginAdmin, sec: (n: number) => h().clock.advance(n), now: () => h().clock.ms };
}
