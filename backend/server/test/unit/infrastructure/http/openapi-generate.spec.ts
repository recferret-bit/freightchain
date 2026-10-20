import { readFileSync } from 'node:fs';
import { listRoutes, renderOpenApi } from '../../../../scripts/generate-openapi.js';

describe('openapi:generate', () => {
  const first = renderOpenApi();
  const second = renderOpenApi();

  it('renders the same bytes twice', () => {
    expect(first).toBe(second);
    expect(first.endsWith('\n')).toBe(true);
  });

  it('is OpenAPI 3.1 and lists every registered controller route', () => {
    const doc = JSON.parse(first) as { openapi: string; paths: Record<string, Record<string, { operationId: string }>> };
    expect(doc.openapi).toBe('3.1.0');
    const routes = listRoutes();
    expect(routes.length).toBeGreaterThanOrEqual(151);
    for (const route of routes) expect(doc.paths[route.path]?.[route.method]?.operationId, `${route.method} ${route.path}`).toBe(route.operationId);
    const listed = Object.entries(doc.paths).flatMap(([path, methods]) => Object.keys(methods).map((method) => `${method} ${path}`)).sort();
    expect(listed).toEqual(routes.map((route) => `${route.method} ${route.path}`).sort());
  });

  it('matches backend/server/openapi.json', () => {
    expect(readFileSync(new URL('../../../../openapi.json', import.meta.url), 'utf8')).toBe(first);
  });
});
