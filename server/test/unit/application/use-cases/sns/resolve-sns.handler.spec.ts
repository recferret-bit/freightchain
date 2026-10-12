import { Keypair } from '@solana/web3.js';
import { ResolveSnsQuery } from '../../../../../src/application/use-cases/sns/resolve-sns/resolve-sns.query.js';
import { ResolveSnsHandler } from '../../../../../src/application/use-cases/sns/resolve-sns/resolve-sns.handler.js';
import { BadRequestError } from '../../../../../src/domain/shared/errors.js';
import { StubNameServiceAdapter } from '../../../../support/stub-name-service.js';

describe('ResolveSnsHandler', () => {
  const nameService = new StubNameServiceAdapter();
  const handler = new ResolveSnsHandler(nameService);
  const wallet = Keypair.generate().publicKey.toBase58();

  beforeEach(() => {
    nameService.clear();
  });

  it('resolves existing domain to wallet address', async () => {
    nameService.setRecord('bonfida.sol', wallet);
    const res = await handler.execute(new ResolveSnsQuery('bonfida.sol'));
    expect(res).toEqual({
      domain: 'bonfida.sol',
      wallet,
    });
  });

  it('normalizes domain without suffix and resolves properly', async () => {
    nameService.setRecord('bonfida.sol', wallet);
    const res = await handler.execute(new ResolveSnsQuery('BONFIDA'));
    expect(res).toEqual({
      domain: 'bonfida.sol',
      wallet,
    });
  });

  it('returns null wallet when domain is not found', async () => {
    const res = await handler.execute(new ResolveSnsQuery('nonexistent.sol'));
    expect(res).toEqual({
      domain: 'nonexistent.sol',
      wallet: null,
    });
  });

  it('throws BadRequestError when given an invalid domain format', async () => {
    await expect(handler.execute(new ResolveSnsQuery(''))).rejects.toThrow(BadRequestError);
    await expect(handler.execute(new ResolveSnsQuery('bad name.sol'))).rejects.toThrow(BadRequestError);
  });
});
