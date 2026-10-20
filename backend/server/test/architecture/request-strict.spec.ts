import type { ZodTypeAny } from 'zod';
import * as admin from '../../src/presentation/admin/dto/admin.dto.js';
import * as adminDirectory from '../../src/presentation/admin/dto/admin-directory.dto.js';
import * as adminPools from '../../src/presentation/admin/dto/admin-pools.dto.js';
import * as adminPromos from '../../src/presentation/admin/dto/admin-promos.dto.js';
import * as adminSettings from '../../src/presentation/admin/dto/admin-settings.dto.js';
import * as auth from '../../src/presentation/auth/dto/auth.dto.js';
import * as editor from '../../src/presentation/editor/dto/editor.dto.js';
import * as honk from '../../src/presentation/honk/honk.http.controller.js';
import * as referrals from '../../src/presentation/referrals/dto/referrals.dto.js';
import * as live from '../../src/presentation/live/dto/live.dto.js';
import * as rides from '../../src/presentation/rides/dto/rides.dto.js';
import * as pools from '../../src/presentation/economy/dto/pools.dto.js';
import * as pledges from '../../src/presentation/economy/dto/pledges.dto.js';
import * as chain from '../../src/presentation/chain/dto/chain.dto.js';
import * as common from '../../src/presentation/common/dto/common.dto.js';

/* forward-compat: telemetry and client-error drop unknown keys (API-M-03). Also non-strict: actions, solana-pay, sns, lobby, prize, entities, stats, public economy queries, garage (loadout's inner object is already strict), and the chain webhook (provider payloads are not an object). */
const MODULES: Record<string, Record<string, unknown>> = {
  admin, adminDirectory, adminPools, adminPromos, adminSettings, auth, editor, honk, referrals, live, rides, pools, pledges, chain, common,
};

interface ZodDef { typeName?: string; unknownKeys?: string; shape?: () => Record<string, ZodTypeAny>; type?: ZodTypeAny; innerType?: ZodTypeAny; schema?: ZodTypeAny; options?: ZodTypeAny[] | Map<unknown, ZodTypeAny>; left?: ZodTypeAny; right?: ZodTypeAny; items?: ZodTypeAny[]; getter?: () => ZodTypeAny; in?: ZodTypeAny }

describe('strict request objects', () => {
  it('admin, editor, mcp, auth, and money object schemas reject unknown keys', () => {
    const missing: string[] = [];
    for (const [mod, exports] of Object.entries(MODULES)) {
      for (const [name, value] of Object.entries(exports)) {
        if (!isSchema(value)) continue;
        walk(value, `${mod}.${name}`, missing);
      }
    }
    expect(missing).toEqual([]);
  });

  it('an unknown field on a strict money body is a ZodError (400 validation_error)', () => {
    expect(rides.createRideBodySchema.safeParse({ tier: 'free', __extra: true }).success).toBe(false);
    expect(auth.verifyBodySchema.safeParse({ wallet: 'x', signature: 'y', __extra: true }).success).toBe(false);
  });
});

function isSchema(value: unknown): value is ZodTypeAny {
  return !!value && typeof value === 'object' && '_def' in value && typeof (value as { safeParse?: unknown }).safeParse === 'function';
}

function walk(schema: ZodTypeAny, path: string, missing: string[]): void {
  const def = (schema as unknown as { _def: ZodDef })._def;
  if (!def?.typeName) return;
  if (def.typeName === 'ZodObject') {
    if (def.unknownKeys !== 'strict') missing.push(path);
    for (const [key, child] of Object.entries(def.shape?.() ?? {})) walk(child, `${path}.${key}`, missing);
    return;
  }
  if (def.typeName === 'ZodArray' && def.type) return walk(def.type, `${path}[]`, missing);
  if (def.typeName === 'ZodTuple') return def.items?.forEach((item, index) => walk(item, `${path}[${index}]`, missing));
  if (def.innerType && ['ZodOptional', 'ZodNullable', 'ZodDefault', 'ZodCatch', 'ZodBranded', 'ZodReadonly'].includes(def.typeName)) return walk(def.innerType, path, missing);
  if (def.schema && (def.typeName === 'ZodEffects' || def.typeName === 'ZodPipeline')) return walk(def.schema, path, missing);
  if (def.typeName === 'ZodUnion' || def.typeName === 'ZodDiscriminatedUnion') {
    const options = Array.isArray(def.options) ? def.options : [...(def.options?.values() ?? [])];
    options.forEach((option, index) => walk(option, `${path}|${index}`, missing));
  }
  if (def.typeName === 'ZodIntersection' && def.left && def.right) { walk(def.left, path, missing); walk(def.right, path, missing); }
  if (def.typeName === 'ZodLazy' && def.getter) walk(def.getter(), path, missing);
}
