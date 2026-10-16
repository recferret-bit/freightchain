// Rewrites client/shared/entity/seed/index.js from the files in seed/<kind>/ (run after adding or removing a seed entity).
//   node tools/entity-seed-index.mjs
import { readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'shared', 'entity', 'seed');
const out = ["/* Every entity the game ships with: the database's first import (server CLI entities:seed) and the Node tools' fixture.", '   The game loads the published bundle from the API (client/js/world/entities.js). Regenerate: node client/tools/entity-seed-index.mjs */'], names = [];
for (const k of ['vehicle', 'part', 'prop', 'furniture', 'landmark', 'gantry']) for (const f of readdirSync(join(dir, k)).filter(f => f.endsWith('.js')).sort()) {
  const n = `${k}_${f.replace(/\.js$/, '')}`.replace(/\W/g, '_'); names.push(n); out.push(`import ${n} from './${k}/${f}';`);
}
out.push(`export default [${names.join(', ')}];`);
writeFileSync(join(dir, 'index.js'), out.join('\n') + '\n');
console.log(`${names.length} entities → seed/index.js`);
