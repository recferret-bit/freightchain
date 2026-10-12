import type { RulesConfigPort } from '../../../../../src/application/ports/config/rules-config.port.js';
import { GetHelloActionHandler, SayHelloActionHandler } from '../../../../../src/application/use-cases/actions/hello-action.handler.js';
import { GetHelloActionQuery } from '../../../../../src/application/use-cases/actions/get-hello-action.query.js';
import { SayHelloActionCommand } from '../../../../../src/application/use-cases/actions/say-hello-action.command.js';

const rules = { get: () => ({ appOrigin: 'https://freightchain.fun' }) } as RulesConfigPort;

describe('hello action', () => {
  it('the card and the reply are static and spend nothing', async () => {
    const card = await new GetHelloActionHandler(rules).execute(new GetHelloActionQuery());
    expect(card.links.actions).toEqual([{ type: 'post', label: 'Say hello', href: '/api/actions/hello' }]);
    const reply = await new SayHelloActionHandler(rules).execute(new SayHelloActionCommand('4GzacGtTe67wnkpJBs7pngcRfsFckbHvzmAUNL6Jchmz'));
    expect(reply).toMatchObject({ type: 'post', message: 'Hello.' });
    expect(reply.links.next.action.icon).toBe('https://freightchain.fun/icons/icon-512.png');
  });
});
