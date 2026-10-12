import { describe, expect, it, vi } from 'vitest';
import type { Connection, SignatureStatus } from '@solana/web3.js';
import { broadcastUntilConfirmed, confirmSignatureViaStatuses, type SignedTx } from '../../../../src/infrastructure/solana/signed-sender.js';
import { SolanaRpc } from '../../../../src/infrastructure/solana/solana-rpc.js';
import { ConflictError, ServiceUnavailableError } from '../../../../src/domain/shared/errors.js';

describe('signed-sender RPC confirmation resilience', () => {
  const dummyTx: SignedTx = {
    raw: Buffer.from([1, 2, 3]),
    signature: '5wV9Q8K911111111111111111111111111111111111111111111111111111111',
    lastValidBlockHeight: 1000,
  };

  const createRpc = (connMock: Partial<Connection>) => {
    return new SolanaRpc(connMock as Connection);
  };

  describe('confirmSignatureViaStatuses', () => {
    it('returns signature status on successful RPC call', async () => {
      const mockStatus: SignatureStatus = {
        slot: 100,
        confirmations: 10,
        err: null,
        confirmationStatus: 'confirmed',
      };
      const rpc = createRpc({
        getSignatureStatuses: vi.fn().mockResolvedValue({ value: [mockStatus] }),
      });

      const res = await confirmSignatureViaStatuses(rpc, dummyTx.signature);
      expect(res).toEqual(mockStatus);
    });

    it('catches transient RPC error, logs debug message, and returns undefined', async () => {
      const rpc = createRpc({
        getSignatureStatuses: vi.fn().mockRejectedValue(new Error('ETIMEDOUT: Connection reset by peer')),
      });

      const debugLogs: string[] = [];
      const res = await confirmSignatureViaStatuses(rpc, dummyTx.signature, (m) => debugLogs.push(m));

      expect(res).toBeUndefined();
      expect(debugLogs.length).toBe(1);
      expect(debugLogs[0]).toContain('confirmSignatureViaStatuses transient error:');
    });
  });

  describe('broadcastUntilConfirmed', () => {
    it('confirms transaction when first attempt succeeds', async () => {
      const mockStatus: SignatureStatus = {
        slot: 100,
        confirmations: 10,
        err: null,
        confirmationStatus: 'confirmed',
      };
      const rpc = createRpc({
        sendRawTransaction: vi.fn().mockResolvedValue(dummyTx.signature),
        getSignatureStatuses: vi.fn().mockResolvedValue({ value: [mockStatus] }),
      });

      const wait = vi.fn().mockResolvedValue(undefined);
      const debug = vi.fn();

      await expect(broadcastUntilConfirmed(rpc, 'confirmed', dummyTx, 'test-tx', wait, debug)).resolves.toBeUndefined();
      expect(wait).toHaveBeenCalledTimes(1);
    });

    it('survives transient RPC failure on first attempt and confirms on second attempt', async () => {
      const mockStatus: SignatureStatus = {
        slot: 100,
        confirmations: 10,
        err: null,
        confirmationStatus: 'confirmed',
      };

      let attempt = 0;
      const rpc = createRpc({
        sendRawTransaction: vi.fn().mockResolvedValue(dummyTx.signature),
        getSignatureStatuses: vi.fn().mockImplementation(async () => {
          attempt++;
          if (attempt === 1) {
            throw new Error('504 Gateway Timeout');
          }
          return { value: [mockStatus] };
        }),
      });

      const wait = vi.fn().mockResolvedValue(undefined);
      const debug = vi.fn();

      await expect(broadcastUntilConfirmed(rpc, 'confirmed', dummyTx, 'test-tx', wait, debug)).resolves.toBeUndefined();
      expect(attempt).toBe(2);
      expect(debug).toHaveBeenCalledWith(expect.stringContaining('Solana RPC unavailable'));
    });

    it('throws ConflictError transaction_failed when transaction fails on chain', async () => {
      const mockStatus: SignatureStatus = {
        slot: 100,
        confirmations: 10,
        err: { InstructionError: [0, 'CustomError'] },
        confirmationStatus: 'confirmed',
      };
      const rpc = createRpc({
        sendRawTransaction: vi.fn().mockResolvedValue(dummyTx.signature),
        getSignatureStatuses: vi.fn().mockResolvedValue({ value: [mockStatus] }),
      });

      const wait = vi.fn().mockResolvedValue(undefined);
      const debug = vi.fn();

      await expect(broadcastUntilConfirmed(rpc, 'confirmed', dummyTx, 'test-tx', wait, debug))
        .rejects.toThrow(new ConflictError('test-tx failed on chain: {"InstructionError":[0,"CustomError"]}', 'transaction_failed'));
    });

    it('throws ConflictError transaction_dropped when block height exceeds lastValidBlockHeight', async () => {
      const rpc = createRpc({
        sendRawTransaction: vi.fn().mockResolvedValue(dummyTx.signature),
        getSignatureStatuses: vi.fn().mockResolvedValue({ value: [null] }),
        getBlockHeight: vi.fn().mockResolvedValue(1005), // > 1000
      });

      const wait = vi.fn().mockResolvedValue(undefined);
      const debug = vi.fn();

      await expect(broadcastUntilConfirmed(rpc, 'confirmed', dummyTx, 'test-tx', wait, debug))
        .rejects.toThrow(new ConflictError('test-tx was dropped – the next pass sends it again', 'transaction_dropped'));
    });

    it('survives transient RPC error in getBlockHeight and retries', async () => {
      const mockStatus: SignatureStatus = {
        slot: 100,
        confirmations: 10,
        err: null,
        confirmationStatus: 'confirmed',
      };

      let attempt = 0;
      const rpc = createRpc({
        sendRawTransaction: vi.fn().mockResolvedValue(dummyTx.signature),
        getSignatureStatuses: vi.fn().mockImplementation(async () => {
          attempt++;
          if (attempt === 1) return { value: [null] };
          return { value: [mockStatus] };
        }),
        getBlockHeight: vi.fn().mockRejectedValue(new Error('RPC rate limit')),
      });

      const wait = vi.fn().mockResolvedValue(undefined);
      const debug = vi.fn();

      await expect(broadcastUntilConfirmed(rpc, 'confirmed', dummyTx, 'test-tx', wait, debug)).resolves.toBeUndefined();
      expect(attempt).toBe(2);
      expect(debug).toHaveBeenCalledWith(expect.stringContaining('Solana RPC unavailable'));
    });
  });
});
