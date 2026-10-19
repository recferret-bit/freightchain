import bs58 from 'bs58';
import { ReceiveChainWebhookCommand } from '../../../src/application/use-cases/chain/receive-chain-webhook/receive-chain-webhook.command.js';
import { ChainWebhookHttpController } from '../../../src/presentation/chain/chain-webhook.http.controller.js';
import { chainWebhookBodySchema } from '../../../src/presentation/chain/dto/chain.dto.js';
import { busMock } from '../../support/bus.js';

const A = bs58.encode(new Uint8Array(64).fill(3));

describe('ChainWebhookHttpController', () => {
  it('webhook → ReceiveChainWebhookCommand with the signatures only', async () => {
    const commands = busMock({ received: 1, settled: 1, pending: 0 });
    const c = new ChainWebhookHttpController(commands.bus);
    expect(await c.receive({ signatures: [A] })).toEqual({ received: 1, settled: 1, pending: 0 });
    expect(commands.last()).toEqual(new ReceiveChainWebhookCommand([A]));
  });

  it('the body schema keeps nothing but signatures and refuses an unfiltered stream', () => {
    expect(chainWebhookBodySchema.parse([{ signature: A, nativeTransfers: [{ amount: 1 }] }])).toEqual({ signatures: [A] });
    expect(chainWebhookBodySchema.parse({})).toEqual({ signatures: [] });
    const many = Array.from({ length: 101 }, (_, i) => bs58.encode(new Uint8Array(64).fill(2).map((x, j) => (j === 0 ? i : x))));
    expect(chainWebhookBodySchema.safeParse(many).error?.issues[0]?.message).toMatch(/at most 100 signatures/);
  });
});
