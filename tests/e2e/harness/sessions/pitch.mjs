import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { html, open, REPO, settle } from '../dom.mjs';
import { pageRoutes } from '../fixtures.mjs';

export async function openPitch() {
  const page = open({
    html: html('frontend/landing/pitchdeck.html'),
    url: 'http://127.0.0.1:3411/pitchdeck.html',
    routes: pageRoutes(),
  });
  await import(pathToFileURL(join(REPO, 'frontend/landing/src/pitchdeck.js')).href);
  await settle(40);
  const core = await import(pathToFileURL(join(REPO, 'frontend/landing/src/pitchdeck/core.js')).href);
  return { ...page, view: core.view };
}
