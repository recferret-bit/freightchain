import { Injectable, RequestMethod, type OnModuleInit } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { EnvService } from '../config/env.service.js';
import { PUBLIC_ADMIN_AUTH, PUBLIC_ADMIN_ROUTES, ROLES_KEY, isPrivilegedPath } from './guards/privileged.decorator.js';

const METHOD_NAME: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.DELETE]: 'DELETE',
};

export interface PrivilegedRouteFact {
  /** `POST /api/admin/auth/nonce` */
  key: string;
  isPublic: boolean;
  hasRoles: boolean;
}

/** Boot fails closed: a privileged route with neither @Roles nor @PublicAdminAuth, or a public decorator on any other path. */
export function privilegedRouteProblems(routes: readonly PrivilegedRouteFact[], strict: boolean): string[] {
  const problems: string[] = [];
  for (const route of routes) {
    if (route.isPublic && !PUBLIC_ADMIN_ROUTES.has(route.key)) problems.push(`${route.key} is @PublicAdminAuth but only nonce and verify may be`);
    if (!route.isPublic && !route.hasRoles) problems.push(`${route.key} lacks @Roles or @PublicAdminAuth`);
    if (strict && / \/api\/dev(\/|$)/.test(route.key)) problems.push(`${route.key} is a dev route and strict mode refuses it`);
  }
  return problems;
}

@Injectable()
export class PrivilegedRouteCheck implements OnModuleInit {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly env: EnvService,
  ) {}

  onModuleInit(): void {
    const problems = privilegedRouteProblems(this.routes(), this.env.isStrict);
    if (problems.length) throw new Error(`privileged routes:\n${problems.join('\n')}`);
  }

  private routes(): PrivilegedRouteFact[] {
    const found: PrivilegedRouteFact[] = [];
    for (const wrapper of this.discovery.getControllers()) {
      const metatype = wrapper.metatype as { prototype: object } | undefined;
      const instance = wrapper.instance as object | undefined;
      if (!metatype || !instance) continue;
      const prototype = Object.getPrototypeOf(instance) as object;
      for (const prefix of pathsOf(Reflect.getMetadata(PATH_METADATA, metatype))) {
        this.scanner.scanFromPrototype(instance, prototype, (name) => {
          const handler = (prototype as Record<string, unknown>)[name];
          if (typeof handler !== 'function') return;
          const method = METHOD_NAME[Reflect.getMetadata(METHOD_METADATA, handler) as number];
          if (!method) return;
          for (const path of pathsOf(Reflect.getMetadata(PATH_METADATA, handler))) {
            const full = joinPath(prefix, path);
            if (!isPrivilegedPath(full)) return;
            found.push({
              key: `${method} ${full}`,
              isPublic: Reflect.getMetadata(PUBLIC_ADMIN_AUTH, handler) === true,
              hasRoles: Reflect.getMetadata(ROLES_KEY, handler) != null || Reflect.getMetadata(ROLES_KEY, metatype) != null,
            });
          }
        });
      }
    }
    return found;
  }
}

function pathsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.length ? value.map(String) : [''];
  if (value === undefined || value === null || value === '') return [''];
  return [String(value)];
}

function joinPath(prefix: string, path: string): string {
  const parts = [prefix, path].flatMap((part) => part.split('/').filter((segment) => segment.length > 0));
  return `/${parts.join('/')}`.replace(/\/+$/, '') || '/';
}
