import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { html, open, REPO, settle } from '../dom.mjs';
import { pageRoutes } from '../fixtures.mjs';

export async function openPaper() {
  const page = open({
    html: html('frontend/landing/whitepaper.html'),
    url: 'http://127.0.0.1:3411/whitepaper.html',
    routes: pageRoutes(),
  });
  await import(pathToFileURL(join(REPO, 'frontend/landing/src/whitepaper.js')).href);
  await settle(20);
  return page;
}
