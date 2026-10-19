/* Types of the shared entity core (client/shared/entity/, plain JS) as the server uses it. */
export interface EntityConfig {
  id: string;
  kind: 'prop' | 'furniture' | 'landmark' | 'vehicle' | 'gantry' | 'part';
  v: number;
  label?: string;
  note?: string;
  [key: string]: unknown;
}
export interface EntityValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  measures: Record<string, unknown> | null;
}
export function validateEntity(entity: unknown, options?: { lookup?: (id: string) => EntityConfig | null | undefined }): EntityValidation;
export function parseSource(text: string): unknown;
export function printSource(value: unknown): string;
export class SourceError extends Error {}
export const MAX_SOURCE: number;
export const KINDS: readonly EntityConfig['kind'][];
export const ID: RegExp;
export function rosterOf(id: string): { kind: string; lock: unknown } | null;
export const SEED_ENTITIES: readonly EntityConfig[];
