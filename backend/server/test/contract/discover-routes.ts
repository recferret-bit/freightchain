import type { INestApplication } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import { CONTROLLER_WATERMARK, GUARDS_METADATA, METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, ModulesContainer } from '@nestjs/core';
import { ZodValidationPipe } from '../../src/infrastructure/http/pipes/zod-validation.pipe.js';
import { ROUTE_AUTHS, ROUTE_METHODS, type RouteAuth, type RouteDescriptor, type RouteMethod, routeKey } from './routes.manifest.js';

const ADMIN_PUBLIC = 'freight:admin-public';
const EDITOR_PUBLIC = 'freight:editor-public';
const BODY = 3;
const QUERY = 4;
const PARAM = 5;

const METHOD_BY_CODE: Record<number, RouteMethod> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.DELETE]: 'DELETE',
};

interface ArgMeta { pipes?: unknown[] }

export interface DiscoveredRoute extends RouteDescriptor {
  /** Body / query / path inputs the handler declares, and whether each pipe is the Zod one. */
  inputs: { kind: 'body' | 'query' | 'params'; zod: boolean }[];
  /** The path template contains `:param`. */
  declaresPathParam: boolean;
}

const asPaths = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.length ? value.map(String) : [''];
  if (value === undefined || value === null || value === '') return [''];
  return [String(value)];
};

const joinPath = (prefix: string, path: string): string => {
  const parts = [prefix, path].flatMap((part) => part.split('/').filter((segment) => segment.length > 0 && segment !== '/'));
  return `/${parts.join('/')}`;
};

const guardName = (guard: unknown): string => {
  if (typeof guard === 'function') return guard.name;
  if (guard && typeof guard === 'object') return (guard as { constructor?: { name?: string } }).constructor?.name ?? '';
  return '';
};

const authOf = (names: readonly string[], adminPublic: boolean, editorPublic: boolean): RouteAuth => {
  if (names.includes('McpJobGuard')) return 'mcp';
  if ((names.includes('WebhookSecretGuard') || names.includes('TelegramWebhookGuard'))) return 'webhook';
  if (names.includes('AdminGuard')) return adminPublic ? 'admin-public' : 'admin';
  if (names.includes('EditorGuard')) return editorPublic ? 'editor-public' : 'editor';
  if (names.includes('PlayerAuthGuard')) return 'player';
  if (names.includes('OptionalSessionGuard')) return 'optional';
  return 'none';
};

const isZodPipe = (pipe: unknown): boolean => {
  if (pipe instanceof ZodValidationPipe) return true;
  const name = typeof pipe === 'function' ? pipe.name : pipe && typeof pipe === 'object' ? (pipe as { constructor?: { name?: string } }).constructor?.name : '';
  return name === 'ZodValidationPipe';
};

const handlersOf = (metatype: { prototype: object }): { name: string; fn: (...args: never[]) => unknown }[] => {
  const found: { name: string; fn: (...args: never[]) => unknown }[] = [];
  const seen = new Set<string>();
  let proto: object | null = metatype.prototype;
  while (proto && proto !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor' || seen.has(name)) continue;
      const fn = (proto as Record<string, unknown>)[name];
      if (typeof fn !== 'function' || Reflect.getMetadata(METHOD_METADATA, fn) === undefined) continue;
      seen.add(name);
      found.push({ name, fn: fn as (...args: never[]) => unknown });
    }
    proto = Object.getPrototypeOf(proto);
  }
  return found;
};

/** Every controller route on the booted Nest graph (DiscoveryService), with the Zod pipes each input declares. */
export function discoverRoutes(app: INestApplication): DiscoveredRoute[] {
  const discovery = new DiscoveryService(app.get(ModulesContainer));
  const routes: DiscoveredRoute[] = [];
  for (const wrapper of discovery.getControllers()) {
    const metatype = wrapper.metatype as { prototype: object; name?: string } | undefined;
    if (!metatype || Reflect.getMetadata(CONTROLLER_WATERMARK, metatype) !== true) continue;
    const classGuards = guardList(Reflect.getMetadata(GUARDS_METADATA, metatype));
    for (const prefix of asPaths(Reflect.getMetadata(PATH_METADATA, metatype))) {
      for (const handler of handlersOf(metatype)) {
        const method = METHOD_BY_CODE[Reflect.getMetadata(METHOD_METADATA, handler.fn) as number];
        if (!method) continue;
        const methodGuards = guardList(Reflect.getMetadata(GUARDS_METADATA, handler.fn));
        const auth = authOf([...methodGuards, ...classGuards], Reflect.getMetadata(ADMIN_PUBLIC, handler.fn) === true, Reflect.getMetadata(EDITOR_PUBLIC, handler.fn) === true);
        const inputs = inputsOf(Reflect.getMetadata(ROUTE_ARGS_METADATA, metatype, handler.name) as Record<string, ArgMeta> | undefined);
        for (const path of asPaths(Reflect.getMetadata(PATH_METADATA, handler.fn))) {
          routes.push({ method, path: joinPath(prefix, path), auth, inputs, declaresPathParam: /:[A-Za-z0-9_]+/.test(path) || /:[A-Za-z0-9_]+/.test(prefix) });
        }
      }
    }
  }
  routes.sort((a, b) => routeKey(a).localeCompare(routeKey(b)));
  return routes;
}

const guardList = (value: unknown): string[] => Array.isArray(value) ? value.map(guardName).filter((name) => name.length > 0) : [];

const inputsOf = (args: Record<string, ArgMeta> | undefined): DiscoveredRoute['inputs'] => {
  const inputs: DiscoveredRoute['inputs'] = [];
  for (const [key, meta] of Object.entries(args ?? {})) {
    const type = Number(key.split(':')[0]);
    const kind = type === BODY ? 'body' : type === QUERY ? 'query' : type === PARAM ? 'params' : null;
    if (!kind) continue;
    const pipes = meta?.pipes ?? [];
    inputs.push({ kind, zod: pipes.some(isZodPipe) });
  }
  return inputs;
};

/** A route whose body, query, or `:param` is not read through `@ZodBody` / `@ZodQuery` / `@ZodParams`. */
export function zodInputGaps(routes: readonly DiscoveredRoute[]): string[] {
  const gaps: string[] = [];
  for (const route of routes) {
    for (const input of route.inputs) {
      if (!input.zod) gaps.push(`${routeKey(route)} ${input.kind} lacks @Zod${input.kind === 'body' ? 'Body' : input.kind === 'query' ? 'Query' : 'Params'}`);
    }
    if (route.declaresPathParam && !route.inputs.some((input) => input.kind === 'params' && input.zod)) gaps.push(`${routeKey(route)} path param lacks @ZodParams`);
  }
  return gaps;
}

export function assertKnownAuth(routes: readonly DiscoveredRoute[]): void {
  for (const route of routes) {
    if (!ROUTE_AUTHS.includes(route.auth)) throw new Error(`${routeKey(route)} has unknown auth ${route.auth}`);
    if (!ROUTE_METHODS.includes(route.method)) throw new Error(`${routeKey(route)} has unknown method ${route.method}`);
  }
}
