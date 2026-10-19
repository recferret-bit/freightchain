import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { html, open, REPO, settle } from '../dom.mjs';
import { pageRoutes } from '../fixtures.mjs';

export async function openReceipt() {
  const page = open({
    html: html('frontend/client/r.html'),
    url: 'http://127.0.0.1:3411/r.html?desktop=1&id=11111111-1111-4111-8111-111111111111',
    routes: pageRoutes(),
  });
  await import(pathToFileURL(join(REPO, 'frontend/client/site/ride.js')).href);
  await settle(40);
  return page;
}
