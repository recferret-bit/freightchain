import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ZodValidationPipe } from '../src/infrastructure/http/pipes/zod-validation.pipe.js';
import { ZOD_RESPONSE, ZOD_RESPONSE_RAW, type ZodResponseMeta } from '../src/infrastructure/http/decorators/zod-response.js';
import { zodToJsonSchema } from '../src/infrastructure/http/openapi/zod-json-schema.js';
import { PresentationModule } from '../src/presentation/presentation.module.js';

const METHOD: Record<number, string> = { [RequestMethod.GET]: 'get', [RequestMethod.POST]: 'post', [RequestMethod.PUT]: 'put', [RequestMethod.DELETE]: 'delete', [RequestMethod.PATCH]: 'patch', [RequestMethod.OPTIONS]: 'options', [RequestMethod.HEAD]: 'head' };
const DEFAULT_STATUS: Record<number, number> = { [RequestMethod.POST]: 201, [RequestMethod.PUT]: 200, [RequestMethod.PATCH]: 200, [RequestMethod.DELETE]: 200, [RequestMethod.GET]: 200 };
const BODY = 3;
const QUERY = 4;
const PARAM = 5;

export interface ListedRoute { method: string; path: string; operationId: string }

interface ArgMeta { pipes?: unknown[] }

export function controllerClasses(): (new (...args: never[]) => object)[] {
  const meta = Reflect.getMetadata('controllers', PresentationModule) as (new (...args: never[]) => object)[] | undefined;
  return [...(meta ?? [])].sort((a, b) => a.name.localeCompare(b.name));
}

export function listRoutes(controllers = controllerClasses()): ListedRoute[] {
  const routes: ListedRoute[] = [];
  for (const type of controllers) {
    const base = pathOf(Reflect.getMetadata(PATH_METADATA, type));
    const proto = type.prototype as object;
    for (const name of Object.getOwnPropertyNames(proto).sort()) {
      if (name === 'constructor') continue;
      const handler = (proto as Record<string, unknown>)[name];
      if (typeof handler !== 'function') continue;
      const verb = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
      if (verb === undefined || !METHOD[verb]) continue;
      routes.push({ method: METHOD[verb]!, path: joinPath(base, pathOf(Reflect.getMetadata(PATH_METADATA, handler))), operationId: `${type.name}.${name}` });
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method) || a.operationId.localeCompare(b.operationId));
}

export function renderOpenApi(): string {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const type of controllerClasses()) {
    const base = pathOf(Reflect.getMetadata(PATH_METADATA, type));
    const proto = type.prototype as object;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = (proto as Record<string, unknown>)[name];
      if (typeof handler !== 'function' || name === 'constructor') continue;
      const verb = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
      if (verb === undefined || !METHOD[verb]) continue;
      const path = joinPath(base, pathOf(Reflect.getMetadata(PATH_METADATA, handler)));
      const operation = operationOf(type, name, handler as (...args: unknown[]) => unknown, verb);
      paths[path] ??= {};
      paths[path][METHOD[verb]!] = operation;
    }
  }
  const document = {
    openapi: '3.1.0',
    info: { title: 'Freight Chain', version: '0.0.1' },
    paths,
  };
  return `${JSON.stringify(sortJson(document), null, 2)}\n`;
}

export function writeOpenApi(file: string): string {
  const text = renderOpenApi();
  writeFileSync(file, text);
  return text;
}

if (process.env.OPENAPI_WRITE === '1') writeOpenApi(fileURLToPath(new URL('../openapi.json', import.meta.url)));

function operationOf(type: new (...args: never[]) => object, name: string, handler: (...args: unknown[]) => unknown, verb: number): Record<string, unknown> {
  const raw = Reflect.getMetadata(ZOD_RESPONSE_RAW, handler) === true;
  const response = Reflect.getMetadata(ZOD_RESPONSE, handler) as ZodResponseMeta | undefined;
  const httpCode = Reflect.getMetadata(HTTP_CODE_METADATA, handler) as number | undefined;
  const status = response?.status ?? httpCode ?? DEFAULT_STATUS[verb] ?? 200;
  const parameters = parametersOf(type, name);
  const body = bodyOf(type, name);
  const op: Record<string, unknown> = { operationId: `${type.name}.${name}`, tags: [type.name] };
  if (parameters.length) op.parameters = parameters.sort((a, b) => String(a.in).localeCompare(String(b.in)) || String(a.name).localeCompare(String(b.name)));
  if (body) op.requestBody = body;
  op.responses = {
    [String(status)]: raw || !response
      ? { description: raw ? 'Non-JSON response' : 'JSON' }
      : { description: 'JSON', content: { 'application/json': { schema: zodToJsonSchema(response.schema) } } },
  };
  return op;
}

function parametersOf(type: new (...args: never[]) => object, name: string): Record<string, unknown>[] {
  const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, type, name) ?? {}) as Record<string, ArgMeta>;
  const out: Record<string, unknown>[] = [];
  for (const [key, arg] of Object.entries(args)) {
    const kind = Number(key.split(':')[0]);
    if (kind !== QUERY && kind !== PARAM) continue;
    const schema = pipeSchema(arg);
    if (!schema) continue;
    const object = unwrapObject(schema);
    if (!object) continue;
    const shape = object._def.shape() as Record<string, { isOptional?: () => boolean } & import('zod').ZodTypeAny>;
    for (const prop of Object.keys(shape).sort()) {
      const field = shape[prop]!;
      out.push({ name: prop, in: kind === PARAM ? 'path' : 'query', required: kind === PARAM || !isOptionalField(field), schema: zodToJsonSchema(field) });
    }
  }
  return out;
}

function bodyOf(type: new (...args: never[]) => object, name: string): Record<string, unknown> | undefined {
  const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, type, name) ?? {}) as Record<string, ArgMeta>;
  for (const [key, arg] of Object.entries(args)) {
    if (Number(key.split(':')[0]) !== BODY) continue;
    const schema = pipeSchema(arg);
    if (!schema) continue;
    return { required: true, content: { 'application/json': { schema: zodToJsonSchema(schema) } } };
  }
  return undefined;
}

function pipeSchema(arg: ArgMeta): import('zod').ZodTypeAny | undefined {
  const pipe = arg.pipes?.find((item): item is ZodValidationPipe<unknown> => item instanceof ZodValidationPipe);
  return pipe?.schema;
}

function unwrapObject(schema: import('zod').ZodTypeAny): { _def: { shape: () => Record<string, import('zod').ZodTypeAny> } } | undefined {
  const typeName = (schema as unknown as { _def: { typeName: string; schema?: import('zod').ZodTypeAny; innerType?: import('zod').ZodTypeAny } })._def;
  if (typeName.typeName === 'ZodObject') return schema as unknown as { _def: { shape: () => Record<string, import('zod').ZodTypeAny> } };
  if ((typeName.typeName === 'ZodEffects' || typeName.typeName === 'ZodCatch') && typeName.schema) return unwrapObject(typeName.schema);
  if (typeName.innerType) return unwrapObject(typeName.innerType);
  return undefined;
}

function isOptionalField(schema: import('zod').ZodTypeAny): boolean {
  const name = (schema as unknown as { _def: { typeName: string; schema?: import('zod').ZodTypeAny; innerType?: import('zod').ZodTypeAny } })._def;
  if (name.typeName === 'ZodOptional' || name.typeName === 'ZodDefault') return true;
  if (name.schema) return isOptionalField(name.schema);
  if (name.typeName === 'ZodNullable' && name.innerType) return isOptionalField(name.innerType);
  return false;
}

function pathOf(value: unknown): string {
  if (Array.isArray(value)) return pathOf(value[0]);
  return typeof value === 'string' ? value : '';
}

function joinPath(base: string, method: string): string {
  const joined = `/${base}/${method}`.replace(/\/+/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) out[key] = sortJson((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}
