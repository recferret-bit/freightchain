// What the localnet money e2e made the escrow program DO on a real validator – every instruction, event and error code, from two sources into one file:
//   · the LEDGER: every transaction that named the program (getSignaturesForAddress, paged), its instructions (by IDL discriminator), the events it emitted
//     (`Program data:` lines through the server's codec) and the program error of a failed one – scanned at the end of each validator's life (the phase-1
//     fixtures validator is torn down, so it is scanned there);
//   · REFUSALS: a transaction refused in simulation never lands, so the scenarios record those themselves (`refused(step, stderr)` – the error code read from
//     the simulation result).
// The report adds the LiteSVM program tests (programs/freightchain_pools/tests/*.rs, static: which `PoolError::X` they assert) and fails unless every
// instruction and event happened on the validator and every error code is asserted somewhere (validator or LiteSVM).
//   module:  const cov = coverage(FILE); cov.refused('pool D: buy while paused', e); await cov.scan(conn, 'phase 2'); cov.save()
//   CLI:     node scripts/localnet-coverage.mjs scan <file> <rpc> <label>   ·   node scripts/localnet-coverage.mjs report <file>
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path'; import { fileURLToPath } from 'node:url';
import { Connection, PublicKey } from '@solana/web3.js';
import { PoolProgramCodec } from '../dist/infrastructure/solana/pool-program.codec.js';
import { POOL_PROGRAM_IDL as IDL } from '../dist/infrastructure/solana/pool-program.idl.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const TESTS = join(ROOT, 'backend/programs/freightchain_pools/tests');
const codec = new PoolProgramCodec(IDL.address);
/** Anchor's own account errors a scenario provokes on purpose (v3: pay_prize to a wallet with no Attestation account fails before the handler runs) */
const ANCHOR_ERRORS = { 2006: 'ConstraintSeeds', 3007: 'AccountOwnedByWrongProgram', 3012: 'AccountNotInitialized' };
/** what cannot happen on a fresh v4 validator – shown in the report with its reason, never silently skipped (a name listed here that DID run counts as covered) */
export const EXEMPT = {
  instructions: { create_pledge: 'v6 refuses PledgesDisabled; legacy accounts still settle/refund (negative validator coverage required)', fail_pool: 'v6 always refuses NotFailable; low sales never release escrow (negative validator coverage required)' },
  events: {
    PledgeCreated: 'historical event: v6 never creates new pledge accounts',
    PoolFailed: 'historical event: v6 has no low-sales failure path',
    AttestationRecorded: 'a v3 event kept in the IDL so old transactions still decode – no v4 instruction emits it (v4: RideAttestationRecorded)',
  },
};
const errName = code => IDL.errors.find(e => e.code === code)?.name ?? ANCHOR_ERRORS[code] ?? null;
const same = (a, b) => a.length >= b.length && b.every((x, i) => a[i] === x);

/** the program error code in a simulation / transaction error ({"InstructionError":[i,{"Custom":6023}]} or the stderr text of pool-admin.mjs) */
export function errorCode(e) {
  const text = typeof e === 'string' ? e : JSON.stringify(e?.err ?? e) + String(e?.stderr ?? e?.message ?? '');
  const m = /"Custom":\s*(\d+)/.exec(text) ?? /custom program error: 0x([0-9a-f]+)/i.exec(text);
  if (!m) return null;
  return m[0].startsWith('custom') ? parseInt(m[1], 16) : Number(m[1]);
}

export function coverage(file) {
  const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { ledger: {}, refused: [] };
  const save = () => writeFileSync(file, JSON.stringify(data, null, 1));
  return {
    data, save,
    /** a refusal the scenario provoked on purpose: returns the error NAME (null when the text holds no program error) */
    refused(step, e) {
      const code = errorCode(e), name = code === null ? null : errName(code);
      data.refused.push({ step, code, error: name }); save();
      return name;
    },
    /** everything that LANDED on this validator, under `label` (replaces an earlier scan with the same label) */
    async scan(conn, label) {
      const program = new PublicKey(IDL.address), sigs = [];
      for (let before; ;) {
        const page = await conn.getSignaturesForAddress(program, { limit: 1000, ...(before && { before }) }, 'confirmed');
        sigs.push(...page.map(p => p.signature));
        if (page.length < 1000) break;
        before = page.at(-1).signature;
      }
      const out = { transactions: sigs.length, instructions: {}, events: {}, errors: {}, cu: {} };   // cu: max compute units of a landed transaction with ONE instruction of the program
      const bump = (m, k) => { m[k] = (m[k] ?? 0) + 1; };
      for (const sig of sigs) {
        const tx = await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
        if (!tx) continue;
        const msg = tx.transaction.message, keys = msg.staticAccountKeys ?? msg.accountKeys, mine = [];
        for (const ix of msg.compiledInstructions) {
          if (!keys[ix.programIdIndex].equals(program)) continue;
          const data = Uint8Array.from(ix.data), def = IDL.instructions.find(i => same(data, i.discriminator));
          bump(out.instructions, `${def?.name ?? 'unknown'}${tx.meta?.err ? ' (failed)' : ''}`);
          mine.push(def?.name ?? 'unknown');
        }
        const units = tx.meta?.computeUnitsConsumed;
        if (mine.length === 1 && !tx.meta?.err && typeof units === 'number') out.cu[mine[0]] = Math.max(out.cu[mine[0]] ?? 0, units);
        const lines = codec.programData(tx.meta?.logMessages ?? []);
        if (lines !== 'truncated') for (const { bytes } of lines) bump(out.events, codec.decodeEvent(bytes)?.name ?? 'unknown');
        const code = tx.meta?.err ? errorCode(tx.meta.err) : null;
        if (code !== null) bump(out.errors, errName(code) ?? `code ${code}`);
      }
      data.ledger[label] = out; save();
      return out;
    },
  };
}

/** what the LiteSVM tests assert: `PoolError::X` per error, instruction builders / names per instruction (static – they run in `npm run program:test`) */
function liteSvm() {
  if (!existsSync(TESTS)) return { errors: new Set(), instructions: new Set(), files: 0 };
  const files = []; const walk = d => { for (const f of readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(join(d, f.name)) : f.name.endsWith('.rs') && files.push(join(d, f.name)); };
  walk(TESTS);
  const src = files.map(f => readFileSync(f, 'utf8')).join('\n');
  const camel = s => s.replace(/_(\w)/g, (_, c) => c.toUpperCase()).replace(/^\w/, c => c.toUpperCase());
  return {
    files: files.length,
    errors: new Set(IDL.errors.map(e => e.name).filter(n => new RegExp(`PoolError::${n}\\b`).test(src))),
    instructions: new Set(IDL.instructions.map(i => i.name).filter(n => new RegExp(`instruction::${camel(n)}\\b`).test(src))),
  };
}

export function report(file) {
  const { ledger, refused } = JSON.parse(readFileSync(file, 'utf8'));
  const scans = Object.values(ledger);
  const sum = key => { const m = {}; for (const s of scans) for (const [k, n] of Object.entries(s[key])) m[k] = (m[k] ?? 0) + n; return m; };
  const ix = sum('instructions'), ev = sum('events'), landedErr = sum('errors');
  const cu = {}; for (const sc of scans) for (const [k, n] of Object.entries(sc.cu ?? {})) cu[k] = Math.max(cu[k] ?? 0, n);
  const svm = liteSvm();
  const refusedBy = {}; for (const r of refused) if (r.error) (refusedBy[r.error] ??= []).push(r.step);
  const lines = [], missing = [];
  const pad = (s, n) => String(s).padEnd(n);
  lines.push(`escrow program coverage – ${scans.reduce((a, s) => a + s.transactions, 0)} transactions on the validator(s) (${Object.keys(ledger).join(', ')}), ${refused.length} refusals, LiteSVM ${svm.files} test files`);
  lines.push('', `INSTRUCTIONS (${IDL.instructions.length})                validator  LiteSVM`);
  for (const { name } of IDL.instructions) {
    const n = ix[name] ?? 0, failed = ix[`${name} (failed)`] ?? 0, s = svm.instructions.has(name);
    const ex = !n && EXEMPT.instructions[name];
    if (!n && !ex) missing.push(`instruction ${name} never succeeded on the validator`);
    lines.push(`  ${n ? '✓' : ex ? '○' : '✗'} ${pad(name, 28)}${pad(n + (failed ? ` (+${failed} failed)` : ''), 11)}${pad(s ? 'yes' : '–', 9)}${ex ? `exempt: ${ex}` : ''}`);
  }
  lines.push('', `EVENTS (${IDL.events.length})                      validator`);
  for (const { name } of IDL.events) {
    const n = ev[name] ?? 0;
    const ex = !n && EXEMPT.events[name];
    if (!n && !ex) missing.push(`event ${name} never emitted on the validator`);
    lines.push(`  ${n ? '✓' : ex ? '○' : '✗'} ${pad(name, 28)}${pad(n, 11)}${ex ? `exempt: ${ex}` : ''}`);
  }
  lines.push('', `ERRORS (${IDL.errors.length})                      validator             LiteSVM  where on the validator`);
  let onValidator = 0;
  for (const { name, code } of IDL.errors) {
    const v = (refusedBy[name]?.length ?? 0) + (landedErr[name] ?? 0), s = svm.errors.has(name);
    if (v) onValidator++;
    if (!v && !s) missing.push(`error ${name} (${code}) is asserted nowhere`);
    const where = [...(refusedBy[name] ?? []), ...(landedErr[name] ? [`${landedErr[name]}× in a landed transaction`] : [])];
    lines.push(`  ${v || s ? '✓' : '✗'} ${pad(`${name} ${code}`, 28)}${pad(v ? `${v}×` : '–', 22)}${pad(s ? 'yes' : '–', 9)}${where.slice(0, 2).join(' · ').slice(0, 90)}`);
  }
  for (const name of ['NotFailable', 'PledgesDisabled']) if (!refusedBy[name]?.length && !landedErr[name]) missing.push(`tombstone refusal ${name} missing on validator`);
  const unexpected = refused.filter(r => !r.error);
  if (unexpected.length) missing.push(`${unexpected.length} refusal(s) without a program error: ${unexpected.map(r => r.step).join(' · ')}`);
  const unknown = Object.keys(ix).filter(k => k.startsWith('unknown')).concat(Object.keys(ev).filter(k => k === 'unknown'));
  if (unknown.length) missing.push(`undecodable instructions / events on the ledger: ${unknown.join(', ')}`);
  lines.push('', `COMPUTE UNITS (max of a landed one-instruction transaction, ComputeBudget instructions included): ${Object.entries(cu).sort().map(([k, n]) => `${k} ${n}`).join(' · ')}`);
  const exI = IDL.instructions.filter(i => !ix[i.name] && EXEMPT.instructions[i.name]).length, exE = IDL.events.filter(e => !ev[e.name] && EXEMPT.events[e.name]).length;
  lines.push('', `instructions ${IDL.instructions.filter(i => ix[i.name]).length}/${IDL.instructions.length} on the validator${exI ? ` (+${exI} exempt ○)` : ''} · events ${IDL.events.filter(e => ev[e.name]).length}/${IDL.events.length}${exE ? ` (+${exE} exempt ○)` : ''} · errors ${onValidator}/${IDL.errors.length} on the validator, ${IDL.errors.filter(e => svm.errors.has(e.name) || refusedBy[e.name] || landedErr[e.name]).length}/${IDL.errors.length} with LiteSVM`);
  return { text: lines.join('\n'), missing };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, file, rpc, label] = process.argv.slice(2);
  if (cmd === 'scan' && file && rpc && label) { const r = await coverage(file).scan(new Connection(rpc, 'confirmed'), label); console.log(`scanned ${r.transactions} program transactions (${label})`); }
  else if (cmd === 'report' && file) {
    const { text, missing } = report(file);
    console.log(text);
    console.log(missing.length ? `\n✗ coverage incomplete:\n  ${missing.join('\n  ')}` : '\n✓ 100 %: every instruction and event ran on the validator, every error code is asserted');
    process.exit(missing.length ? 1 : 0);
  } else { console.error('usage: localnet-coverage.mjs scan <file> <rpc> <label> | report <file>'); process.exit(2); }
}
