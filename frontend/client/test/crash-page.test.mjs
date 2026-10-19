// Which page a crash belongs to, and that every module entry installs the hook before its other imports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crashPage } from '../js/crash-page.js';
import { clientErrorUrl } from '../js/crash.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (path) => readFileSync(join(root, path), 'utf8');

test('a host at / is that host\'s page, and a path names the file when the host does not', () => {
  assert.deepEqual(crashPage('whitepaper.freightchain.fun', '/'), { surface: 'whitepaper' });
  assert.deepEqual(crashPage('pitchdeck.freightchain.fun', '/'), { surface: 'pitchdeck', credentials: 'omit' });
  assert.deepEqual(crashPage('storybook.freightchain.fun', '/'), { surface: 'viewer', credentials: 'omit' });
  assert.deepEqual(crashPage('admin.freightchain.fun', '/'), { surface: 'admin' });
  assert.deepEqual(crashPage('freightchain.fun', '/'), { surface: 'landing' });
  assert.deepEqual(crashPage('www.freightchain.fun', '/index.html'), { surface: 'landing' });
  assert.deepEqual(crashPage('ride.freightchain.fun', '/play.html'), { surface: 'game' });
  assert.deepEqual(crashPage('localhost', '/freightchain.html'), { surface: 'game' });
  assert.deepEqual(crashPage('ride.freightchain.fun:443', '/lobby.html'), { surface: 'lobby' });
  assert.deepEqual(crashPage('freightchain.fun', '/r/abc'), { surface: 'receipt' });
  assert.deepEqual(crashPage('freightchain.fun', '/r'), { surface: 'receipt' });
  assert.deepEqual(crashPage('localhost:3000', '/r.html'), { surface: 'receipt' });
  assert.equal(crashPage('freightchain.fun', '/rides'), null);
  assert.deepEqual(crashPage('localhost', '/viewer.html'), { surface: 'viewer', credentials: 'omit' });
  assert.deepEqual(crashPage('localhost', '/admin.html'), { surface: 'admin' });
  assert.deepEqual(crashPage('localhost', '/blink.html'), { surface: 'blink' });
  assert.deepEqual(crashPage('localhost', '/whitepaper.html'), { surface: 'whitepaper' });
  assert.deepEqual(crashPage('localhost', '/pitchdeck.html'), { surface: 'pitchdeck', credentials: 'omit' });
  assert.equal(crashPage('freightchain.fun', '/play.html').credentials, undefined);
  assert.equal(crashPage('api.freightchain.fun', '/api/health'), null);
});

test('the admin page posts the crash on its own host; every other page uses the API', () => {
  assert.equal(clientErrorUrl('admin.freightchain.fun', 'https://api.freightchain.fun'), '/api/client-error');
  assert.equal(clientErrorUrl('Admin.Freightchain.fun:443', 'https://api.freightchain.fun'), '/api/client-error');
  assert.equal(clientErrorUrl('storybook.freightchain.fun', 'https://api.freightchain.fun'), 'https://api.freightchain.fun/api/client-error');
  assert.equal(clientErrorUrl('ride.freightchain.fun', ''), '/api/client-error');
  assert.equal(clientErrorUrl('localhost', ''), '/api/client-error');
});

/** The first import statement, comments ignored. Its module finishes before the next import runs. */
function firstImport(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const line of code.split('\n')) {
    const text = line.replace(/\/\/.*$/, '').trim();
    if (!text) continue;
    const match = text.match(/^import\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/);
    return match ? match[1] : text;
  }
  return '';
}

test('every page imports the crash hook before its other modules', () => {
  const entries = [
    ['frontend/client/play.html', 'js/main.js', './crash-boot.js'],
    ['frontend/client/viewer.html', 'js/viewer.js', './crash-boot.js'],
    ['frontend/client/lobby.html', 'site/lobby.js', '../js/crash-boot.js'],
    ['frontend/client/admin.html', 'site/admin.js', '../js/crash-boot.js'],
    ['frontend/client/blink.html', 'site/blink.js', '../js/crash-boot.js'],
    ['frontend/client/r.html', 'site/ride.js', '../js/crash-boot.js'],
    ['frontend/landing/index.html', 'src/main.js', '../../client/js/crash-boot.js'],
    ['frontend/landing/whitepaper.html', 'src/whitepaper.js', '../../client/js/crash-boot.js'],
    ['frontend/landing/pitchdeck.html', 'src/pitchdeck.js', '../../client/js/crash-boot.js'],
  ];
  for (const [html, src, boot] of entries) {
    assert.match(read(html), new RegExp(`<script type="module" src="[^"]*${src.replace('.', '\\.')}"`));
    assert.equal(firstImport(read(join(dirname(html), src))), boot, html);
  }
});

test('the client and the server name the same pages', () => {
  const client = /const SURFACES = new Set\(\[([^\]]+)\]\)/.exec(read('frontend/client/js/crash.js'))[1];
  const server = /CLIENT_ERROR_SURFACES = \[([^\]]+)\]/.exec(read('backend/server/src/domain/analytics/client-error.ts'))[1];
  assert.equal(client.replace(/\s/g, ''), server.replace(/\s/g, ''));
});
