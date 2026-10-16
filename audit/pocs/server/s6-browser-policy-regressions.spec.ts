import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (path: string) => readFileSync(`${repo}${path}`, 'utf8');
const policySources = () => [
  'deploy/nginx/site.conf.template', 'deploy/nginx/admin.conf.template', 'deploy/nginx/storybook.conf.template', 'deploy/nginx/whitepaper.conf.template',
  'deploy/scripts/remote/setup.sh', 'server/src/app/configure-app.ts', 'server/src/infrastructure/http/static-cache.ts',
].map(read).join('\n');

/** Source-only invariants: they do not assert anything about an uninspected deployed nginx configuration. */
describe('S6: browser policy is enforced by the repository deployment', () => {
  it('defines a CSP or a CSP-setting middleware', () => {
    expect(/Content-Security-Policy|frame-ancestors|helmet\(/i.test(policySources())).toBe(true);
  });

  it('defines HSTS and an explicit referrer policy', () => {
    expect(/Strict-Transport-Security/i.test(policySources())).toBe(true);
    expect(/Referrer-Policy/i.test(policySources())).toBe(true);
  });

  it.each(['client/play.html', 'client/viewer.html'])('%s pins third-party module bytes as well as the version', (path) => {
    const json = /<script type="importmap">([^<]+)<\/script>/.exec(read(path))?.[1];
    expect(json).toBeDefined();
    const map = JSON.parse(json!) as { imports: Record<string, string>; integrity?: Record<string, string> };
    const url = map.imports['three']!;
    expect(url).toContain('three@0.160.0');
    expect(map.integrity?.[url] ?? '').toMatch(/^sha(256|384|512)-/);
  });
});
