import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'freight:roles';
export const PUBLIC_ADMIN_AUTH = 'freight:public-admin-auth';
export type PrivilegedRole = 'admin' | 'moderator' | 'editor';

/** The only routes a privileged prefix answers without a session. Logout is not one of them. */
export const PUBLIC_ADMIN_ROUTES = new Set([
  'POST /api/admin/auth/nonce',
  'POST /api/admin/auth/verify',
  'POST /api/editor/auth/nonce',
  'POST /api/editor/auth/verify',
]);

export const Roles = (...roles: PrivilegedRole[]): ClassDecorator & MethodDecorator => SetMetadata(ROLES_KEY, roles) as ClassDecorator & MethodDecorator;

/** Prefixes that default-deny. `/api/editor/mcp` stays inside the editor prefix and is authenticated by the job token. */
export function isPrivilegedPath(path: string): boolean {
  return path.startsWith('/api/admin/') || path === '/api/admin'
    || path.startsWith('/api/editor/') || path === '/api/editor'
    || path.startsWith('/api/dev/') || path === '/api/dev'
    || path.startsWith('/api/mcp/') || path === '/api/mcp';
}

/** Sign-in nonce and verify only. Anything else under /api/admin, /api/editor, /api/dev, /api/mcp needs @Roles. */
export const PublicAdminAuth = (): ClassDecorator & MethodDecorator => SetMetadata(PUBLIC_ADMIN_AUTH, true) as ClassDecorator & MethodDecorator;
