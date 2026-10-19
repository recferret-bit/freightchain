import { Connection, PublicKey, type ConnectionConfig } from '@solana/web3.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { publicKey } from '@metaplex-foundation/umi';

/** Exercise the real Web3/Jayson and Umi stacks with only the HTTP boundary replaced. No RPC network or chain writes. */
describe('Solana HTTP compatibility with the scoped Jayson 5 override', () => {
  const address = '11111111111111111111111111111111';
  type RpcRequest = { jsonrpc: string; id: string; method: string; params: unknown[] };
  function transport(answer: (r: RpcRequest) => unknown) {
    const requests: RpcRequest[] = [];
    const fetch: NonNullable<ConnectionConfig['fetch']> = async (_url, init) => {
      if (typeof init?.body !== 'string') throw new Error('expected a JSON string body');
      const input = JSON.parse(init.body) as RpcRequest | RpcRequest[];
      const reply = (r: RpcRequest) => { requests.push(r); return { jsonrpc: '2.0', id: r.id, ...answer(r) as object }; };
      return new Response(JSON.stringify(Array.isArray(input) ? input.map(reply) : reply(input)), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    return { requests, connection: new Connection('http://rpc.invalid', { fetch, disableRetryOnRateLimit: true }) };
  }

  it('preserves request IDs, parameters, concurrent calls, batches and transaction submission encoding', async () => {
    const t = transport(r => ({ result: r.method === 'getBalance' ? { context: { slot: 42 }, value: 123 } : r.method === 'sendTransaction' ? 'signature' : null }));
    expect(await Promise.all([t.connection.getBalance(new PublicKey(address)), t.connection.getBalance(new PublicKey(address))])).toEqual([123, 123]);
    expect(await t.connection.getParsedTransactions(['sig-a', 'sig-b'])).toEqual([null, null]);
    expect(await t.connection.sendRawTransaction(Uint8Array.from([1, 2, 3]), { skipPreflight: true })).toBe('signature');
    expect(t.requests).toHaveLength(5);
    expect(new Set(t.requests.map(r => r.id)).size).toBe(5);
    expect(t.requests.every(r => r.jsonrpc === '2.0' && typeof r.id === 'string' && r.id.length > 0)).toBe(true);
    expect(t.requests[0]!.params[0]).toBe(address);
    expect(t.requests.at(-1)!.params).toEqual(['AQID', expect.objectContaining({ encoding: 'base64', skipPreflight: true })]);
  });

  it('propagates JSON-RPC errors and malformed responses rather than accepting them as results', async () => {
    const error = transport(() => ({ error: { code: -32000, message: 'RPC refused' } }));
    await expect(error.connection.getBalance(new PublicKey(address))).rejects.toThrow('RPC refused');
    const malformed = transport(() => ({ result: 'invalid balance' }));
    await expect(malformed.connection.getBalance(new PublicKey(address))).rejects.toThrow();
  });

  it('the Metaplex default bundle reads accounts and blockhashes through the upgraded transport', async () => {
    const t = transport(r => ({ result: r.method === 'getAccountInfo' ? { context: { slot: 42 }, value: null } : { context: { slot: 42 }, value: { blockhash: address, lastValidBlockHeight: 123 } } }));
    const umi = createUmi(t.connection);
    expect(await umi.rpc.getAccount(publicKey(address))).toMatchObject({ exists: false, publicKey: address });
    expect(await umi.rpc.getLatestBlockhash()).toMatchObject({ blockhash: address, lastValidBlockHeight: 123 });
    expect(t.requests.map(r => r.method)).toEqual(['getAccountInfo', 'getLatestBlockhash']);
  });
});
