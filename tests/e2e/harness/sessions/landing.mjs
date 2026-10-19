import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { html, open, REPO, settle } from '../dom.mjs';
import { pageRoutes } from '../fixtures.mjs';

export async function openLanding({ paid = false, pool = false } = {}) {
  const base = pageRoutes({ anon: true, paid });
  const soon = Date.now() + 86_400_000;
  const page = open({
    html: html('frontend/landing/index.html'),
    url: 'http://127.0.0.1:3411/',
    routes: (method, url, body) => {
      if (pool && method === 'GET' && url.pathname === '/api/pool') {
        return { status: 200, json: {
          pools: [{ id: 1, tier: '1h', label: 'week', vaultLamports: 1_000_000_000, priceLamports: 10_000_000, address: '64GheTAtcPoz6Re29qwWxzKU2gtZCTF6gC1NBPVgaL2N', progressPct: 10, status: 'open', prepDeadline: soon, playDeadline: soon + 86_400_000, payoutAt: soon + 172_800_000, payout: null }],
          solUsd: 100, entries: 1, round: { endsAt: soon },
          split: { grand: 500_000_000, top20: 200_000_000, nextSeed: 200_000_000, fees: 100_000_000 },
          usd: { grand: 50 },
        } };
      }
      return base(method, url, body);
    },
  });
  await import(pathToFileURL(join(REPO, 'frontend/landing/src/main.js')).href);
  await settle(80);
  return page;
}
