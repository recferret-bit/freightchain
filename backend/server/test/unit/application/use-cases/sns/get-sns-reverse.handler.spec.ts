import { Keypair } from '@solana/web3.js';
import { GetSnsReverseQuery } from '../../../../../src/application/use-cases/sns/get-sns-reverse/get-sns-reverse.query.js';
import { GetSnsReverseHandler } from '../../../../../src/application/use-cases/sns/get-sns-reverse/get-sns-reverse.handler.js';
import { BadRequestError } from '../../../../../src/domain/shared/errors.js';
import { StubNameServiceAdapter } from '../../../../support/stub-name-service.js';

describe('GetSnsReverseHandler', () => {
  const nameService = new StubNameServiceAdapter();
  const handler = new GetSnsReverseHandler(nameService);
  const wallet = Keypair.generate().publicKey.toBase58();

  beforeEach(() => {
    nameService.clear();
  });

  it('returns resolved domain for registered wallet', async () => {
    nameService.setReverse(wallet, 'driver.sol');
    const res = await handler.execute(new GetSnsReverseQuery(wallet));
    expect(res).toEqual({
      wallet,
      domain: 'driver.sol',
    });
  });

  it('returns null domain for wallet without SNS record', async () => {
    const res = await handler.execute(new GetSnsReverseQuery(wallet));
    expect(res).toEqual({
      wallet,
      domain: null,
    });
  });

  it('throws BadRequestError when given an invalid base58 address', async () => {
    await expect(handler.execute(new GetSnsReverseQuery('invalid-address'))).rejects.toThrow(BadRequestError);
  });
});
