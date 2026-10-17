import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { html, open, REPO, settle } from '../dom.mjs';
import { pageRoutes } from '../fixtures.mjs';

export async function openBlink() {
  const page = open({
    html: html('client/blink.html'),
    url: 'http://127.0.0.1:3411/blink.html',
    routes(method, url) {
      if (url.pathname === '/api/actions/hello') {
        return { status: 200, json: { type: 'action', icon: '', title: 'Hello', description: 'hi', label: 'Hello', links: { actions: [{ label: 'Ping', href: 'http://127.0.0.1:3411/api/actions/hello' }] } } };
      }
      return pageRoutes()(method, url);
    },
  });
  await import(pathToFileURL(join(REPO, 'client/site/blink.js')).href);
  await settle(20);
  return page;
}
