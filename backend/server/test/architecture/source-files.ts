import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export const SERVER_DIR = resolve(import.meta.dirname, '../..');
export const SRC_DIR = join(SERVER_DIR, 'src');

export interface SourceFile {
  /** path relative to src/, with forward slashes (e.g. "domain/rides/ride.entity.ts") */
  path: string;
  text: string;
  layer: string;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Every production .ts file under src/ with its layer (the first folder; '' for files directly in src/). */
export function sourceFiles(): SourceFile[] {
  return walk(SRC_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .map((full) => {
      const path = relative(SRC_DIR, full).split('\\').join('/');
      return { path, text: readFileSync(full, 'utf8'), layer: path.includes('/') ? (path.split('/')[0] ?? '') : '' };
    });
}

/** Module specifiers a file imports (`from '…'`, `import '…'`, `import('…')`).
    Whitespace is required before a static specifier: a quoted property named `from` is not an import. */
export function importsOf(text: string): string[] {
  const found: string[] = [];
  for (const re of [/\bfrom\s+['"]([^'"]+)['"]/g, /\bimport\s+['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]/g]) {
    for (const m of text.matchAll(re)) if (m[1]) found.push(m[1]);
  }
  return found;
}

/** The src/-relative path an import of `spec` made from `from` points at (relative imports only). */
export function resolveImport(from: string, spec: string): string {
  const parts = [...from.split('/').slice(0, -1), ...spec.split('/')];
  const out: string[] = [];
  for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.') out.push(p); }
  return out.join('/');
}

/** The text without comments (so a rule about code never trips over prose that mentions it). */
export const codeOf = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
