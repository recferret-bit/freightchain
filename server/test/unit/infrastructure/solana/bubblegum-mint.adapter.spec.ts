import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { BubblegumMintAdapter } from '../../../../src/infrastructure/solana/bubblegum-mint.adapter.js';
import { ServiceUnavailableError } from '../../../../src/domain/shared/errors.js';

const KEY = bs58.encode(Keypair.generate().secretKey); // a throwaway key, generated per run
const env = (over: Record<string, unknown> = {}) => ({
  solanaRpc: 'http://127.0.0.1:1', solanaRpcFallbacks: [], solanaCommitment: 'confirmed', priorityFee: { minMicrolamports: 1 },
  achievementMintSecret: undefined, achievementTree: undefined, achievementCollection: undefined, ...over,
}) as never;

/** a Connection stand-in for the two calls signatureStatus makes */
const rpcWith = (status: unknown, height = 0) => ({ primaryOnly: async (call: (c: unknown) => unknown) => call({ getSignatureStatuses: async () => ({ value: [status] }), getBlockHeight: async () => height }) });

describe('BubblegumMintAdapter', () => {
  it('is unconfigured (no address) without the key, the tree and the collection, and refuses to mint', async () => {
    for (const over of [{}, { achievementMintSecret: KEY }, { achievementMintSecret: KEY, achievementTree: 'T'.repeat(40) }]) {
      const a = new BubblegumMintAdapter(env(over));
      expect(a.address).toBeNull();
      await expect(a.mint({ wallet: 'w', name: 'n', uri: 'u' }, async () => undefined)).rejects.toBeInstanceOf(ServiceUnavailableError);
    }
  });

  it('with all three it has the key\'s address; a metadata uri exists only for an uploaded badge', () => {
    const a = new BubblegumMintAdapter(env({ achievementMintSecret: KEY, achievementTree: 'T'.repeat(40), achievementCollection: 'C'.repeat(40) }));
    expect(a.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(a.metadataUri('no-such-badge')).toBeNull();
  });

  it('the tree usage is unknown (null, never a throw) when minting is not configured', async () => {
    expect(await new BubblegumMintAdapter(env()).treeUsage()).toBeNull();
  });

  it('reads a transaction\'s state: landed with an error = failed, confirmed / finalized, still pending, expired once the blockhash is gone', async () => {
    const a = new BubblegumMintAdapter(env());
    const at = (status: unknown, height = 0) => { (a as unknown as { rpc: unknown }).rpc = rpcWith(status, height); return a.signatureStatus('sig', 100); };
    expect(await at({ err: { InstructionError: [0, 'Custom'] }, confirmationStatus: 'confirmed' })).toBe('failed');
    expect(await at({ err: null, confirmationStatus: 'finalized' })).toBe('finalized');
    expect(await at({ err: null, confirmationStatus: 'confirmed' })).toBe('confirmed');
    expect(await at({ err: null, confirmationStatus: 'processed' })).toBe('pending');
    expect(await at(null, 99)).toBe('pending');
    expect(await at(null, 101)).toBe('expired');
  });
});
