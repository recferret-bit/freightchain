import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { html, open, REPO, settle } from '../dom.mjs';
import { pageRoutes } from '../fixtures.mjs';

export async function openLobby({ paid = false, search = '' } = {}) {
  const page = open({
    html: html('client/lobby.html'),
    url: `http://127.0.0.1:3411/lobby.html${search}`,
    routes: pageRoutes({ paid }),
  });
  await import(pathToFileURL(join(REPO, 'client/site/lobby.js')).href);
  await settle(80);
  return page;
}
