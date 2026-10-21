// Parity gate for the entity conversion: builds the 3D catalogue (tools/parity/entry.mjs)
// with a recording three.js (three-rec.mjs) and a recording canvas (scene-shim.mjs), and compares every object tree bit for bit.
//   node tools/parity/run.mjs --save          write tools/parity/golden.txt from the working tree
//   node tools/parity/run.mjs                 compare the working tree to golden.txt
//   node tools/parity/run.mjs <commit>        compare the working tree to that commit (tools/parity/BASE is the old pin)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, copyFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), client = join(here, '..', '..'), repo = join(client, '..', '..');
const goldenPath = join(here, 'golden.txt');
const arg = process.argv[2];
const save = arg === '--save';
const tmp = mkdtempSync(join(tmpdir(), 'fc-parity-'));
function tree(name, fill) {
  const root = join(tmp, name); mkdirSync(root, { recursive: true }); fill(root);
  const par = join(root, 'client', 'tools', 'parity'); mkdirSync(par, { recursive: true });
  for (const f of readdirSync(here)) if (f.endsWith('.mjs')) copyFileSync(join(here, f), join(par, f));
  copyFileSync(join(here, 'scene-shim.mjs'), join(root, 'client', 'js', 'world', 'scene.js'));
  const ents = join(root, 'client', 'js', 'world', 'entities.js');
  if (!existsSync(ents)) writeFileSync(ents, 'export async function loadEntities() {}\n');   // a base from before the entities
  const out = join(tmp, name + '.mjs');
  execFileSync('npx', ['esbuild', join(par, 'entry.mjs'), '--bundle', '--format=esm', '--platform=node', `--alias:three=${join(par, 'three-rec.mjs')}`, `--outfile=${out}`, '--log-level=error'], { cwd: client, stdio: 'inherit' });
  return execFileSync('node', [out], { maxBuffer: 1 << 30 }).toString().trimEnd().split('\n');
}
const now = tree('current', root => { mkdirSync(join(root, 'client'), { recursive: true }); for (const d of ['js', 'shared']) cpSync(join(client, d), join(root, 'client', d), { recursive: true }); });
if (save) {
  writeFileSync(goldenPath, now.join('\n') + '\n');
  console.log(`wrote ${now.length} objects to ${goldenPath}`);
  process.exit(0);
}
const base = arg && arg !== '--save' ? arg : (existsSync(goldenPath) ? 'golden.txt' : readFileSync(join(here, 'BASE'), 'utf8').trim());
const legacy = base === 'golden.txt'
  ? readFileSync(goldenPath, 'utf8').trimEnd().split('\n')
  : tree('legacy', root => execFileSync('sh', ['-c', `if git -C "${repo}" cat-file -e "${base}:frontend/client" 2>/dev/null; then git -C "${repo}" archive "${base}" frontend/client | tar -x --strip-components=1 -C "${root}"; else git -C "${repo}" archive "${base}" client | tar -x -C "${root}"; fi`]));
const A = new Map(legacy.map(l => l.split('\t'))), B = new Map(now.map(l => l.split('\t')));
let diffs = 0;
for (const [k, a] of A) {
  const b = B.get(k);
  if (b === a) continue;
  if (++diffs > 8) continue;
  console.log(`\nDIFF ${k}`);
  if (b === undefined) { console.log('  missing in the working tree'); continue; }
  const pa = a.split(' | '), pb = b.split(' | ');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if (pa[i] !== pb[i]) { console.log(`  base: ${pa[i] ?? '(none)'}\n  now:  ${pb[i] ?? '(none)'}`); break; }
}
for (const k of B.keys()) if (!A.has(k)) { diffs++; if (diffs <= 8) console.log(`\nEXTRA ${k} only in the working tree`); }
writeFileSync(join(tmp, 'legacy.txt'), legacy.join('\n')); writeFileSync(join(tmp, 'current.txt'), now.join('\n'));
console.log(`\n${A.size} objects compared against ${base}: ${diffs ? diffs + ' differ' : 'identical'}   (dumps: ${tmp})`);
process.exit(diffs ? 1 : 0);
