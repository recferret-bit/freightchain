import type { Connection } from '@solana/web3.js';
import { SolanaRpc } from '../../../../src/infrastructure/solana/solana-rpc.js';
import { ServiceUnavailableError } from '../../../../src/domain/shared/errors.js';

const conn = (name: string) => ({ name }) as unknown as Connection;
const nameOf = (c: Connection) => (c as unknown as { name: string }).name;

describe('SolanaRpc', () => {
  it('reads from the primary; on failure from each fallback in turn, with an exponential backoff', async () => {
    const waits: number[] = [];
    const rpc = new SolanaRpc(conn('primary'), [conn('f1'), conn('f2')], async (ms) => { waits.push(ms); });
    const asked: string[] = [];
    const out = await rpc.read(async (c) => { asked.push(nameOf(c)); if (nameOf(c) !== 'f2') throw new Error('429'); return 'ok'; });
    expect(out).toBe('ok');
    expect(asked).toEqual(['primary', 'f1', 'f2']);
    expect(waits).toEqual([250, 500]);
    expect(await rpc.read(async (c) => nameOf(c))).toBe('primary');
  });

  it('every endpoint down = 503, never "not found"', async () => {
    const rpc = new SolanaRpc(conn('primary'), [conn('f1')], async () => undefined);
    await expect(rpc.read(async () => { throw new Error('down'); })).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it('writes (and history-sensitive reads) go to the primary only', async () => {
    const rpc = new SolanaRpc(conn('primary'), [conn('f1')], async () => undefined);
    const asked: string[] = [];
    await expect(rpc.primaryOnly(async (c) => { asked.push(nameOf(c)); throw new Error('down'); })).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(asked).toEqual(['primary']);
    expect(await rpc.primaryOnly(async (c) => nameOf(c))).toBe('primary');
  });
});
