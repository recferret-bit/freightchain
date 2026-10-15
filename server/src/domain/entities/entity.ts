import { ID, parseSource, printSource, SourceError, validateEntity, type EntityConfig } from '../shared/entity.js';
import { BadRequestError, UnprocessableEntityError } from '../shared/errors.js';

/* A 3D model of the game is an ENTITY: a data-only JS module (`export default { … }`, client/shared/entity/). The code ships every model as a seed
   (client/shared/entity/seed/); the database (`asset` schema) keeps the editor's history on top: append-only revisions, a HEAD (what the editor works on)
   and a PUBLISHED revision (what every player draws). The bundle the game loads = the seed with every published revision on top. */

export type { EntityConfig };
export const SEED_AUTHOR = 'seed';
export const ENTITY_ID = ID;

export interface EntityRecord {
  id: string;
  kind: EntityConfig['kind'];
  label: string | null;
  headRevisionId: string | null;
  publishedRevisionId: string | null;
  /** bumped on every pointer move */
  version: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RevisionRecord {
  id: string;
  entityId: string;
  /** 1, 2, … per entity, append-only */
  seq: number;
  parentId: string | null;
  /** the file text, as `printSource` prints it (canonical) */
  source: string;
  config: EntityConfig;
  /** sha256 hex of `source` */
  hash: string;
  authorWallet: string;
  jobId: string | null;
  message: string;
  createdAt: Date;
}

/** a revision in a list: no source, plus the prompt of the job that made it */
export type RevisionSummary = Omit<RevisionRecord, 'source' | 'config'> & { prompt: string | null };

export const MAX_MESSAGE = 500;

/**
 * Reads an entity file WITHOUT executing it (literal-only parser), checks that it is the entity the route names and validates it against the rest of the
 * catalogue (`lookup`: the other entities' head configs). → the config and its canonical text. Every refusal is a 422 with the reasons.
 */
export function checkEntitySource(source: string, id: string, lookup: (id: string) => EntityConfig | null | undefined): { config: EntityConfig; source: string; warnings: string[] } {
  if (!ENTITY_ID.test(id)) throw new BadRequestError('an entity id is lower-case letters, digits and dashes', 'bad_entity_id');
  let value: unknown;
  try { value = parseSource(source); } catch (e) {
    if (e instanceof SourceError) throw new UnprocessableEntityError('the entity file is not plain data', 'entity_invalid', [e.message]);
    throw e;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new UnprocessableEntityError('the entity file must export an object', 'entity_invalid', ['the file must export an object']);
  const config = value as EntityConfig;
  if (config.id !== id) throw new UnprocessableEntityError(`the file is entity '${String(config.id)}', not '${id}'`, 'entity_invalid', [`id: must be '${id}'`]);
  const result = validateEntity(config, { lookup });
  if (!result.ok) throw new UnprocessableEntityError(`entity '${id}' does not validate`, 'entity_invalid', result.errors, result.warnings);
  return { config, source: printSource(config), warnings: result.warnings };
}

/** an entity's kind is fixed once it exists (the roster pins the game's ones; a viewer-only one keeps its own) */
export function assertSameKind(existing: EntityRecord | null, config: EntityConfig, seed: EntityConfig | null): void {
  const was = existing?.kind ?? seed?.kind;
  if (was && was !== config.kind) throw new UnprocessableEntityError(`'${config.id}' is a ${was} – its kind cannot change`, 'entity_invalid', [`kind: must stay '${was}'`]);
}

export const seedSource = (config: EntityConfig): string => printSource(config);

/** does this config `use` / `ref` that entity anywhere in its parts? */
export function refersTo(config: unknown, id: string): boolean {
  if (Array.isArray(config)) return config.some((x) => refersTo(x, id));
  if (!config || typeof config !== 'object') return false;
  const o = config as Record<string, unknown>;
  return o['use'] === id || o['ref'] === id || Object.values(o).some((v) => refersTo(v, id));
}

/**
 * Publishing must leave a bundle the game can build: the revision is validated against the PUBLISHED set (a part it uses must be published first), and
 * so is every published entity that uses / refs it (a part's new revision must not break them). 422 entity_invalid with the reasons.
 */
export function assertPublishable(config: EntityConfig, published: readonly EntityConfig[]): void {
  const next = new Map(published.map((e) => [e.id, e])); next.set(config.id, config);
  const touched = new Set<string>([config.id]);
  for (let added = true; added; ) {
    added = false;
    for (const p of published) if (!touched.has(p.id) && [...touched].some((id) => refersTo(p.parts, id))) { touched.add(p.id); added = true; }
  }
  const errors: string[] = [];
  for (const e of [config, ...published.filter((p) => p.id !== config.id && touched.has(p.id))]) {
    const r = validateEntity(e, { lookup: (x) => next.get(x) ?? null });
    if (!r.ok) errors.push(...r.errors.map((m) => (e.id === config.id ? m : `${e.id} (published, uses '${config.id}'): ${m}`)));
  }
  if (errors.length) throw new UnprocessableEntityError(`publishing '${config.id}' would leave models the game cannot build – publish the parts it uses first`, 'entity_invalid', errors.slice(0, 20));
}
