import type { ZodTypeAny } from 'zod';

type Json = Record<string, unknown>;
interface ZodDef { typeName: string; [key: string]: unknown }

const defOf = (schema: ZodTypeAny): ZodDef => (schema as unknown as { _def: ZodDef })._def;

/** OpenAPI 3.1 schema object from a Zod 3 schema. Effects unwrap to the inner schema (the wire shape). */
export function zodToJsonSchema(schema: ZodTypeAny, seen = new Set<ZodTypeAny>()): Json {
  if (seen.has(schema)) return {};
  const def = defOf(schema);
  switch (def.typeName) {
    case 'ZodObject': return objectSchema(schema, def, seen);
    case 'ZodArray': return { type: 'array', items: zodToJsonSchema(def.type as ZodTypeAny, seen), ...(bounds(def, 'minLength', 'maxLength')) };
    case 'ZodString': return stringSchema(def);
    case 'ZodNumber': return numberSchema(def);
    case 'ZodBigInt': return { type: 'integer' };
    case 'ZodBoolean': return { type: 'boolean' };
    case 'ZodNull': return { type: 'null' };
    case 'ZodUndefined': return {};
    case 'ZodAny':
    case 'ZodUnknown': return {};
    case 'ZodLiteral': return { const: def.value };
    case 'ZodEnum': return { type: 'string', enum: [...(def.values as string[])] };
    case 'ZodNativeEnum': return { enum: nativeEnum(def.values) };
    case 'ZodOptional':
    case 'ZodNullable': return nullable(def.typeName === 'ZodNullable', zodToJsonSchema(def.innerType as ZodTypeAny, seen));
    case 'ZodDefault': return zodToJsonSchema(def.innerType as ZodTypeAny, seen);
    case 'ZodEffects':
    case 'ZodBranded':
    case 'ZodCatch':
    case 'ZodReadonly':
    case 'ZodPipeline': return zodToJsonSchema((def.schema ?? def.type ?? def.innerType ?? def.out) as ZodTypeAny, seen);
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': return { anyOf: optionsOf(def).map((option) => zodToJsonSchema(option, seen)) };
    case 'ZodIntersection': return { allOf: [zodToJsonSchema(def.left as ZodTypeAny, seen), zodToJsonSchema(def.right as ZodTypeAny, seen)] };
    case 'ZodRecord': return { type: 'object', additionalProperties: zodToJsonSchema(def.valueType as ZodTypeAny, seen) };
    case 'ZodTuple': return { type: 'array', prefixItems: (def.items as ZodTypeAny[]).map((item) => zodToJsonSchema(item, seen)) };
    case 'ZodLazy': {
      seen.add(schema);
      return zodToJsonSchema((def.getter as () => ZodTypeAny)(), seen);
    }
    default: return {};
  }
}

function objectSchema(schema: ZodTypeAny, def: ZodDef, seen: Set<ZodTypeAny>): Json {
  const shape = (def.shape as () => Record<string, ZodTypeAny>)();
  const properties: Json = {};
  const required: string[] = [];
  for (const key of Object.keys(shape).sort()) {
    properties[key] = zodToJsonSchema(shape[key]!, seen);
    if (!isOptional(shape[key]!)) required.push(key);
  }
  const out: Json = { type: 'object', properties };
  if (required.length) out.required = required;
  if (def.unknownKeys === 'strict') out.additionalProperties = false;
  else if (def.unknownKeys === 'passthrough') out.additionalProperties = true;
  return out;
}

function isOptional(schema: ZodTypeAny): boolean {
  const name = defOf(schema).typeName;
  if (name === 'ZodOptional' || name === 'ZodDefault') return true;
  if (name === 'ZodEffects' || name === 'ZodCatch' || name === 'ZodNullable') return isOptional((defOf(schema).schema ?? defOf(schema).innerType) as ZodTypeAny);
  return false;
}

function nullable(isNull: boolean, schema: Json): Json {
  if (!isNull) return schema;
  if (schema.anyOf) return { anyOf: [...(schema.anyOf as Json[]), { type: 'null' }] };
  if (schema.type && schema.type !== 'null') return { ...schema, type: Array.isArray(schema.type) ? [...schema.type, 'null'] : [schema.type, 'null'] };
  return { anyOf: [schema, { type: 'null' }] };
}

function stringSchema(def: ZodDef): Json {
  const out: Json = { type: 'string' };
  for (const check of (def.checks as { kind: string; value?: unknown; regex?: RegExp }[] | undefined) ?? []) {
    if (check.kind === 'min') out.minLength = check.value;
    else if (check.kind === 'max') out.maxLength = check.value;
    else if (check.kind === 'uuid') out.format = 'uuid';
    else if (check.kind === 'email') out.format = 'email';
    else if (check.kind === 'regex' && check.regex) out.pattern = check.regex.source;
  }
  return out;
}

function numberSchema(def: ZodDef): Json {
  const integer = ((def.checks as { kind: string }[] | undefined) ?? []).some((check) => check.kind === 'int');
  const out: Json = { type: integer ? 'integer' : 'number' };
  for (const check of (def.checks as { kind: string; value?: number; inclusive?: boolean }[] | undefined) ?? []) {
    if (check.kind === 'min') out[check.inclusive === false ? 'exclusiveMinimum' : 'minimum'] = check.value;
    else if (check.kind === 'max') out[check.inclusive === false ? 'exclusiveMaximum' : 'maximum'] = check.value;
  }
  return out;
}

function bounds(def: ZodDef, minKey: string, maxKey: string): Json {
  const out: Json = {};
  if (def.minLength !== null && def.minLength !== undefined) out[minKey] = (def.minLength as { value: number }).value ?? def.minLength;
  if (def.maxLength !== null && def.maxLength !== undefined) out[maxKey] = (def.maxLength as { value: number }).value ?? def.maxLength;
  return out;
}

function optionsOf(def: ZodDef): ZodTypeAny[] {
  const options = def.options;
  if (Array.isArray(options)) return options as ZodTypeAny[];
  if (options instanceof Map) return [...options.values()] as ZodTypeAny[];
  return [];
}

function nativeEnum(values: unknown): unknown[] {
  const list = Object.values(values as Record<string, unknown>).filter((value) => typeof value !== 'number' || !Number.isNaN(value));
  const numeric = list.filter((value) => typeof value === 'number');
  return numeric.length && numeric.length === list.length / 2 ? numeric : list;
}
