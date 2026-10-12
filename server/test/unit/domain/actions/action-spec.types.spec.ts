import type { ActionGetResponse, ActionsJson as SpecActionsJson, ExternalLinkResponse, TransactionResponse } from '../../../support/actions-spec.js';
import { ACTIONS_JSON, buyTx, rideCard, rideLink, shiftCard, siteLink, watchLink, type ActionCard, type ActionLink, type ActionsJson, type ActionTx } from '../../../../src/domain/actions/action-card.js';

/* Our blink payloads against the Solana Actions spec (vendored @solana/actions-spec 2.4.2). The assignments are the check: the typecheck in
   `npm run check` fails when a field drifts from the spec; the runtime half pins what the types cannot (absolute icon, labels, relative hrefs). */
const asCard = (c: ActionCard): ActionGetResponse => c;
const asTx = (t: ActionTx): TransactionResponse => t;
const asLink = (l: ActionLink): ExternalLinkResponse => l;
const asJson = (j: ActionsJson): SpecActionsJson => j;

const OFFER = [{ tier: '1h' as const, poolId: 7, lamports: 50_000_000 }];

describe('blink payloads follow the Actions spec', () => {
  it('cards, links, the buy and actions.json are spec types; icons are absolute, buttons are action paths with verb-first, short labels', () => {
    const cards = [asCard(shiftCard('https://freightchain.fun', OFFER)), asCard(shiftCard('https://freightchain.fun', [])),
      asCard(rideCard('https://freightchain.fun', { id: 'r', route: 'route-66', tier: '1h', status: 'completed', km: 12, reason: null, verdictRejected: false }, OFFER))];
    for (const c of cards) {
      expect(c.icon).toMatch(/^https:\/\/.+\.(png|svg|webp)$/);
      for (const a of c.links?.actions ?? []) {
        expect(a.href).toMatch(/^\/api\/actions\//);
        expect(a.label.split(/\s+/).filter((w) => /\w/.test(w)).length).toBeLessThanOrEqual(5);
        if (a.type === 'transaction') expect(a.label).toMatch(/^Buy /);
      }
    }
    const links = [asLink(rideLink('https://freightchain.fun', 'r')), asLink(siteLink('https://freightchain.fun', 'home')), asLink(watchLink('https://freightchain.fun', 'https://ride.freightchain.fun', { id: 'r', tier: '1h', status: 'completed' }))];
    for (const l of links) expect(l.externalLink).toMatch(/^https:\/\//);
    const tx = asTx(buyTx('https://freightchain.fun', '1h', 7, 'AAAA'));
    expect(tx.links?.next.type).toBe('inline');
    expect(asJson(ACTIONS_JSON).rules.every((r) => r.pathPattern.startsWith('/') && r.apiPath.startsWith('/api/actions/'))).toBe(true);
  });
});
