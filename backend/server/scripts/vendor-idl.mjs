// Writes src/infrastructure/solana/pool-program.idl.ts from the committed IDL (docs stripped, one entry per line). Run from server/ after `npm run program:idl`:
//   node scripts/vendor-idl.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const [src, out] = [process.argv[2] ?? '../programs/idl/freightchain_pools.json', process.argv[3] ?? 'src/infrastructure/solana/pool-program.idl.ts'];
const strip = (v) => (Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'docs').map(([k, x]) => [k, strip(x)])) : v);
const idl = strip(JSON.parse(readFileSync(src, 'utf8')));
const list = (xs) => `[\n${xs.map((x) => `    ${JSON.stringify(x)},`).join('\n')}\n  ]`;
const body = `/* The pool program's IDL (programs/idl/freightchain_pools.json, Anchor 1.2.1, spec 0.1.0) without its doc comments – vendored as code because
   \`nest build\` ships no JSON and the deploy image has no programs/ folder. Its spec deep-equals it with the committed file: regenerate it after
   \`npm run program:idl\` with \`node scripts/vendor-idl.mjs\` (from server/). */
import type { Idl } from './borsh.js';

export const POOL_PROGRAM_IDL: Idl = {
  address: ${JSON.stringify(idl.address)},
  metadata: ${JSON.stringify(idl.metadata)},
  instructions: ${list(idl.instructions)},
  accounts: ${list(idl.accounts)},
  events: ${list(idl.events)},
  errors: ${list(idl.errors)},
  types: ${list(idl.types)},
};
`;
writeFileSync(out, body);
