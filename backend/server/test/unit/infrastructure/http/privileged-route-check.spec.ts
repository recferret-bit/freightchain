import { privilegedRouteProblems } from '../../../../src/infrastructure/http/privileged-route-check.js';
import { PrivilegedRouteCheck } from '../../../../src/infrastructure/http/privileged-route-check.js';

describe('PrivilegedRouteCheck', () => {
  it('names a privileged route that has neither @Roles nor @PublicAdminAuth, and a public decorator in the wrong place', () => {
    const problems = privilegedRouteProblems([
      { key: 'POST /api/admin/auth/nonce', isPublic: true, hasRoles: false },
      { key: 'POST /api/admin/settings', isPublic: false, hasRoles: true },
      { key: 'POST /api/admin/auth/logout', isPublic: true, hasRoles: true },
      { key: 'GET /api/dev/sim', isPublic: false, hasRoles: false },
    ], true);
    expect(problems.join('\n')).toMatch(/logout/);
    expect(problems.join('\n')).toMatch(/\/api\/dev\/sim/);
    expect(problems.join('\n')).not.toMatch(/settings/);
    expect(problems.some((line) => line.startsWith('POST /api/admin/auth/nonce'))).toBe(false);
  });

  it('the class is the boot check', () => {
    expect(PrivilegedRouteCheck).toBeTypeOf('function');
  });
});
