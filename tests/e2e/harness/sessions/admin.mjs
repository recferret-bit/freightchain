import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { html, open, REPO, settle } from '../dom.mjs';
import { pageRoutes } from '../fixtures.mjs';

export async function openAdmin({ signedIn }) {
  const page = open({
    html: html('frontend/client/admin.html'),
    url: 'http://127.0.0.1:3411/admin.html',
    routes: pageRoutes({ admin: signedIn }),
  });
  await import(pathToFileURL(join(REPO, 'frontend/client/site/admin.js')).href);
  await settle(60);
  return page;
}
