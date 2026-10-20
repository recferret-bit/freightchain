import { createHarness, type Harness } from '../support/harness.js';
import { assertKnownAuth, discoverRoutes, zodInputGaps, type DiscoveredRoute } from './discover-routes.js';
import { ROUTES, routeKey, type RouteDescriptor } from './routes.manifest.js';

const index = (routes: readonly { method: string; path: string; auth: string }[]): Map<string, string> => {
  const map = new Map<string, string>();
  for (const route of routes) {
    const key = routeKey(route as RouteDescriptor);
    if (map.has(key)) throw new Error(`duplicate route ${key}`);
    map.set(key, route.auth);
  }
  return map;
};

/** `@ZodResponse` is not required yet: another lane is adding it, and it is not in this tree. */
describe('routes.manifest', () => {
  let harness: Harness;
  let live: DiscoveredRoute[];

  beforeAll(async () => {
    harness = await createHarness('memory');
    live = discoverRoutes(harness.app);
  }, 60_000);

  afterAll(() => harness?.close());

  it('lists every controller route and the auth its guards declare', () => {
    assertKnownAuth(live);
    const found = index(live);
    const listed = index(ROUTES as readonly RouteDescriptor[]);
    const missing = [...found.keys()].filter((key) => !listed.has(key));
    const extra = [...listed.keys()].filter((key) => !found.has(key));
    const auth = [...found.keys()].filter((key) => listed.get(key) !== undefined && listed.get(key) !== found.get(key)).map((key) => `${key}: manifest ${listed.get(key)} live ${found.get(key)}`);
    expect({ missing, extra, auth, live: found.size, manifest: listed.size }).toEqual({ missing: [], extra: [], auth: [], live: found.size, manifest: found.size });
  });

  it('requires @ZodBody / @ZodQuery / @ZodParams wherever a handler takes that input', () => {
    expect(zodInputGaps(live)).toEqual([]);
  });
});
