import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { siteRoots } from '../../../src/app/app.module.js';
import type { EnvService } from '../../../src/infrastructure/config/env.service.js';

const env = (landingDir: string, clientDir = '/srv/client') => ({ landingDir, clientDir }) as EnvService;

describe('siteRoots', () => {
  const dirs: string[] = [];
  const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'fc-landing-')); dirs.push(d); return d; };
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('a landing build answers / first, client/ is the fallback', () => {
    const landing = tmp(); writeFileSync(join(landing, 'index.html'), '<html></html>');
    const roots = siteRoots(env(landing));
    expect(roots.map((r) => r.rootPath)).toEqual([landing, '/srv/client']);
    expect(roots[0]?.renderPath).toBe('/');
    for (const r of roots) { expect(r.exclude).toEqual(['/api/{*path}', '/actions.json', '/.well-known/{*path}']); expect(r.serveStaticOptions?.setHeaders).toBeTypeOf('function'); }
  });

  it('no landing build (or an empty folder): only client/ – / is its placeholder page', () => {
    const empty = tmp(); mkdirSync(join(empty, 'assets'));
    expect(siteRoots(env(empty)).map((r) => r.rootPath)).toEqual(['/srv/client']);
    expect(siteRoots(env(join(empty, 'missing'))).map((r) => r.rootPath)).toEqual(['/srv/client']);
  });
});
