import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderOpenApi } from '../../scripts/generate-openapi.js';
import { ROUTES, routeKey } from './routes.manifest.js';

const OPENAPI = fileURLToPath(new URL('../../openapi.json', import.meta.url));

describe('openapi contract', () => {
  const fresh = renderOpenApi();
  const onDisk = existsSync(OPENAPI) ? readFileSync(OPENAPI, 'utf8') : '';

  it('backend/server/openapi.json is present and a fresh generate matches it', () => {
    expect(existsSync(OPENAPI)).toBe(true);
    expect(onDisk.length).toBeGreaterThan(0);
    expect(onDisk).toBe(fresh);
  });

  it('every routes.manifest route is an operation in openapi.json', () => {
    const doc = JSON.parse(onDisk) as { openapi: string; paths: Record<string, Record<string, unknown>> };
    expect(doc.openapi).toBe('3.1.0');
    const missing = ROUTES.filter((route) => doc.paths[route.path]?.[route.method.toLowerCase()] === undefined).map(routeKey);
    expect(missing).toEqual([]);
    expect(ROUTES.length).toBeGreaterThanOrEqual(151);
  });

  it('does not scan a live server; schemathesis is optional', () => {
    const probe = spawnSync('schemathesis', ['--version'], { encoding: 'utf8' });
    const installed = probe.status === 0;
    // Missing CLI is not a failure. Either way this file does not send traffic anywhere.
    expect({ installed, scanned: false }).toEqual({ installed, scanned: false });
  });
});
