import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import fc from 'fast-check';
import request from 'supertest';
import type { ZodTypeAny } from 'zod';
import { controllerClasses } from '../../scripts/generate-openapi.js';
import { ZodValidationPipe } from '../../src/infrastructure/http/pipes/zod-validation.pipe.js';
import { clientErrorBodySchema } from '../../src/presentation/telemetry/dto/client-error.dto.js';
import { telemetryBodySchema } from '../../src/presentation/telemetry/dto/telemetry.dto.js';
import { createHarness, type Harness } from '../support/harness.js';

interface ZodDef {
  typeName: string;
  unknownKeys?: string;
  shape?: () => Record<string, ZodTypeAny>;
  schema?: ZodTypeAny;
  innerType?: ZodTypeAny;
  options?: ZodTypeAny[];
}

const defOf = (schema: ZodTypeAny): ZodDef => (schema as unknown as { _def: ZodDef })._def;

/** Keys of a strict object, walking effects / unions. Null when the schema is not strict. */
function strictKeys(schema: ZodTypeAny): string[] | null {
  const def = defOf(schema);
  if ((def.typeName === 'ZodEffects' || def.typeName === 'ZodPipeline') && def.schema) return strictKeys(def.schema);
  if (def.innerType && (def.typeName === 'ZodOptional' || def.typeName === 'ZodNullable' || def.typeName === 'ZodDefault' || def.typeName === 'ZodCatch' || def.typeName === 'ZodBranded')) return strictKeys(def.innerType);
  if (def.typeName === 'ZodObject' && def.unknownKeys === 'strict' && def.shape) return Object.keys(def.shape());
  if ((def.typeName === 'ZodUnion' || def.typeName === 'ZodDiscriminatedUnion') && def.options?.length) {
    const parts = def.options.map(strictKeys);
    if (parts.some((part) => part === null)) return null;
    return [...new Set(parts.flatMap((part) => part ?? []))];
  }
  return null;
}

/** Every distinct strict `@ZodBody` / `@ZodQuery` / `@ZodParams` schema on a controller. */
function strictRequestSchemas(): ZodTypeAny[] {
  const seen = new Set<ZodTypeAny>();
  const out: ZodTypeAny[] = [];
  for (const type of controllerClasses()) {
    const proto = type.prototype as object;
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue;
      const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, type, name) as Record<string, { pipes?: unknown[] }> | undefined;
      for (const arg of Object.values(args ?? {})) {
        const pipe = arg.pipes?.find((item): item is ZodValidationPipe<unknown> => item instanceof ZodValidationPipe);
        if (!pipe || seen.has(pipe.schema) || !strictKeys(pipe.schema)) continue;
        seen.add(pipe.schema);
        out.push(pipe.schema);
      }
    }
  }
  return out;
}

describe('dto fuzz', () => {
  let harness: Harness;
  const schemas = strictRequestSchemas();

  beforeAll(async () => {
    harness = await createHarness('memory', { RESPONSE_SCHEMA_CHECK: 'strict' });
  }, 60_000);

  afterAll(() => harness?.close());

  it('finds the strict request schemas and a live route still answers', async () => {
    expect(schemas.length).toBeGreaterThan(20);
    await request(harness.server()).get('/api/health/live').expect(200);
  });

  it('an unknown key is rejected on every strict request schema', () => {
    for (const schema of schemas) {
      const known = new Set(strictKeys(schema) ?? []);
      fc.assert(fc.property(
        fc.stringMatching(/^[a-z][a-z0-9]{0,16}$/).filter((key) => !known.has(key)),
        (key) => {
          const body: Record<string, unknown> = Object.create(null);
          body[key] = 1;
          expect(schema.safeParse(body).success).toBe(false);
        },
      ), { numRuns: 100 });
    }
  });

  it('a wrong root type is rejected on every strict request schema', () => {
    const wrong = fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null), fc.double(), fc.array(fc.integer()));
    for (const schema of schemas) {
      fc.assert(fc.property(wrong, (value) => {
        expect(schema.safeParse(value).success).toBe(false);
      }), { numRuns: 100 });
    }
  });

  it('telemetry and client-error drop an unknown key instead of rejecting it', () => {
    const telemetry = telemetryBodySchema.safeParse({ events: [{ event: 'play' }], __unexpectedField: 1 });
    const crash = clientErrorBodySchema.safeParse({ surface: 'game', name: 'Error', value: 'boom', frames: [], __unexpectedField: 1 });
    expect(telemetry.success).toBe(true);
    expect(crash.success).toBe(true);
    if (telemetry.success) expect(telemetry.data).not.toHaveProperty('__unexpectedField');
    if (crash.success) expect(crash.data).not.toHaveProperty('__unexpectedField');
  });
});
