// Real validator acceptance for TEN4 distribution. The second genesis is explicitly historical test state.
// No API campaign payout is implied: the application's campaign claim currently settles on its ledger.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, openSync } from 'node:fs';
import { validatorPorts } from '../../../infra/deploy/scripts/local-validator-ports.mjs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAccount, getAssociatedTokenAddressSync, getMint } from '@solana/spl-token';
import { pdas, PROGRAM_ID } from './honk-program.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const out = mkdtempSync(join(tmpdir(), 'fc-honk-distribution-'));
const artifact = process.env.HONK_ARTIFACT || join(process.env.PROGRAM_ARTIFACT_DIR || join(root, 'backend/programs/target/deploy'), 'freightchain_honk.so');
const PIN = '53be1807bacd5fe564bb72c2364182ab09117734b6f4dc636290e962d743e4aa';
const UNIT = 1_000_000n, SUPPLY = 100_000_000n * UNIT, MONTH = 30 * 86400;
const keys = Object.fromEntries(['admin', 'player', 'second', 'treasury', 'team'].map(name => [name, Keypair.generate()]));
for (const [name, key] of Object.entries(keys)) writeFileSync(join(out, `${name}.json`), JSON.stringify([...key.secretKey]), { mode: 0o600 });
const p = pdas(), checks = [], transactions = [], refusals = [], mutations = [];
const result = { passed: false, output: out, checks, transactions, refusals, historicalMutations: mutations, scope: 'contract instructions on scratch validators; no real distribution or API campaign settlement' };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = value => createHash('sha256').update(value).digest();
const u64 = value => { const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(BigInt(value)); return bytes; };
const u32 = value => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes; };
const address = (...seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const campaign = id => address(Buffer.from('airdrop'), Buffer.from([id]));
const ata = wallet => getAssociatedTokenAddressSync(p.honkMint, wallet);
const writable = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const readonly = pubkey => ({ pubkey, isSigner: false, isWritable: false });
const instruction = (name, accounts, data = []) => new TransactionInstruction({ programId: PROGRAM_ID, keys: accounts, data: Buffer.concat([sha(`global:${name}`).subarray(0, 8), ...data]) });
const leaf = (id, wallet, amount) => sha(Buffer.concat([Buffer.from('fc:airdrop:v1'), Buffer.from([id]), wallet.toBuffer(), u64(amount)]));
const parent = (a, b) => sha(Buffer.concat([Buffer.from([1]), ...[a, b].sort(Buffer.compare)]));
const setRoot = (id, root, allocation, signer = keys.admin) => instruction('set_airdrop_root', [writable(signer.publicKey, true), writable(p.config), writable(campaign(id)), readonly(SystemProgram.programId)], [Buffer.from([id]), root, u64(allocation)]);
const claim = (id, wallet, amount, proof = []) => instruction('claim_airdrop', [writable(wallet, true), writable(p.config), writable(campaign(id)), readonly(p.honkMint), readonly(p.authority), writable(p.airdrop), readonly(wallet), writable(ata(wallet)), writable(address(Buffer.from('airdrop'), Buffer.from([id]), wallet.toBuffer())), writable(address(Buffer.from('wallet-airdrop'), wallet.toBuffer())), readonly(TOKEN_PROGRAM_ID), readonly(ASSOCIATED_TOKEN_PROGRAM_ID), readonly(SystemProgram.programId)], [Buffer.from([id]), u64(amount), u32(proof.length), ...proof]);
const burnUnclaimed = id => instruction('burn_unclaimed', [writable(keys.player.publicKey, true), writable(p.config), writable(campaign(id)), writable(p.honkMint), readonly(p.authority), writable(p.airdrop), readonly(TOKEN_PROGRAM_ID)], [Buffer.from([id])]);
const burnTail = () => instruction('burn_referral_tail', [writable(keys.player.publicKey, true), writable(p.config), writable(p.honkMint), readonly(p.authority), writable(p.referral), readonly(TOKEN_PROGRAM_ID)]);
const vest = (team, recipient = keys[team ? 'team' : 'treasury'].publicKey) => instruction(team ? 'claim_team' : 'claim_treasury', [writable(keys.player.publicKey, true), writable(p.config), readonly(p.honkMint), readonly(p.authority), writable(p[team ? 'team' : 'treasury']), readonly(recipient), writable(ata(recipient)), readonly(TOKEN_PROGRAM_ID), readonly(ASSOCIATED_TOKEN_PROGRAM_ID), readonly(SystemProgram.programId)]);
const check = name => { checks.push(name); console.log(`ok   ${name}`); };
let validator, conn, stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stopping = true; validator?.kill('SIGTERM'); });
async function stop() {
  const child = validator; validator = undefined;
  if (!child || child.exitCode !== null || child.signalCode) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(10000)]);
  if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL');
}
async function start(name, accounts = []) {
  const { rpcPort, faucetPort, gossipPort } = await validatorPorts(), dynamic = randomInt(21000, 39000);
  const rpc = `http://127.0.0.1:${rpcPort}`;
  const log = openSync(join(out, `${name}.log`), 'a', 0o600);
  validator = spawn('solana-test-validator', ['--reset', '--quiet', '--ledger', join(out, `ledger-${name}`), '--bind-address', '127.0.0.1', '--rpc-port', String(rpcPort), '--faucet-port', String(faucetPort), '--gossip-port', String(gossipPort), '--dynamic-port-range', `${dynamic}-${dynamic + 30}`, '--mint', keys.admin.publicKey.toBase58(), '--upgradeable-program', PROGRAM_ID.toBase58(), artifact, keys.admin.publicKey.toBase58(), ...accounts.flatMap(row => ['--account', row.pubkey, row.file])], { stdio: ['ignore', log, log] });
  let error; validator.once('error', e => { error = e; });
  conn = new Connection(rpc, 'confirmed');
  for (let i = 0; i < 90; i++) {
    if (error) throw error;
    if (stopping || validator.exitCode !== null) throw new Error(`validator stopped; see ${name}.log`);
    try { if (await conn.getVersion()) return rpc; } catch {}
    await sleep(1000);
  }
  throw new Error(`validator not ready; see ${name}.log`);
}
async function send(ix, signer = keys.player, name = 'transaction') {
  const tx = new Transaction({ feePayer: signer.publicKey, ...await conn.getLatestBlockhash() }).add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ix); tx.sign(signer);
  const signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  for (let n = 0; n < 120; n++) {
    const s = (await conn.getSignatureStatuses([signature])).value[0];
    assert(!s?.err, `${name}: ${JSON.stringify(s?.err)}`);
    if (['confirmed', 'finalized'].includes(s?.confirmationStatus)) { transactions.push({ name, signature }); return signature; }
    await sleep(250);
  }
  throw new Error(`${name} confirmation timeout`);
}
async function refuse(name, ix, expected, signer = keys.player) {
  const supply = (await getMint(conn, p.honkMint)).supply;
  let error;
  try { await send(ix, signer, name); } catch (e) { error = e; }
  assert(error, `${name} unexpectedly succeeded`);
  const text = `${error.message}\n${(error.logs || []).join('\n')}`;
  assert.match(text, expected, name);
  assert.equal((await getMint(conn, p.honkMint)).supply, supply, `${name} changed supply`);
  refusals.push(name); check(name);
}
const balance = async address => (await getAccount(conn, address)).amount;
async function conservation() {
  let total = 0n;
  for (const row of await conn.getProgramAccounts(TOKEN_PROGRAM_ID)) if (row.account.data.length === 165 && row.account.data.subarray(0, 32).equals(p.honkMint.toBuffer())) total += row.account.data.readBigUInt64LE(64);
  assert.equal(total, (await getMint(conn, p.honkMint)).supply);
}
async function snapshot() {
  const rows = [...await conn.getProgramAccounts(PROGRAM_ID), ...await conn.getProgramAccounts(TOKEN_PROGRAM_ID)];
  for (const key of Object.values(keys).filter(k => k !== keys.admin)) rows.push({ pubkey: key.publicKey, account: await conn.getAccountInfo(key.publicKey) });
  const now = Math.floor(Date.now() / 1000), distributed = 3_984_375n * UNIT;
  for (const row of rows) {
    const data = Buffer.from(row.account.data);
    const change = (field, offset, value, signed = false) => {
      const before = signed ? data.readBigInt64LE(offset) : data.readBigUInt64LE(offset);
      if (signed) data.writeBigInt64LE(BigInt(value), offset); else data.writeBigUInt64LE(BigInt(value), offset);
      mutations.push({ account: row.pubkey.toBase58(), field, before: String(before), after: String(value) });
    };
    if (row.pubkey.equals(p.config)) {
      assert.equal(data.length, 211); assert(data.subarray(0, 8).equals(sha('account:Config').subarray(0, 8)));
      change('opened_at (40 historical months)', 187, now - 40 * MONTH, true);
      change('referral_emitted (historical era-eight allocation)', 131, distributed);
    }
    for (const id of [0, 1]) if (row.pubkey.equals(campaign(id))) {
      assert.equal(data.length, 75);
      change('opened_at (historical 90-day campaign)', 57, now - 91 * 86400, true);
      change('ends_at (historical expiry)', 65, now - 1, true);
    }
    // Keep supply and all token balances coherent: the historical referral distribution left the vault and reached a wallet.
    if (row.pubkey.equals(p.referral)) change('token amount (historical referral tail)', 64, 4_000_000n * UNIT - distributed);
    if (row.pubkey.equals(ata(keys.player.publicKey))) change('token amount (historical referral recipient)', 64, data.readBigUInt64LE(64) + distributed);
    const file = join(out, `account-${row.pubkey.toBase58()}.json`);
    writeFileSync(file, JSON.stringify({ pubkey: row.pubkey.toBase58(), account: { lamports: row.account.lamports, data: [data.toString('base64'), 'base64'], owner: row.account.owner.toBase58(), executable: row.account.executable, rentEpoch: 0 } }), { mode: 0o600 });
    row.file = file;
  }
  return rows.map(row => ({ pubkey: row.pubkey.toBase58(), file: row.file }));
}

try {
  result.executableHash = execFileSync('solana-verify', ['get-executable-hash', artifact], { encoding: 'utf8' }).trim();
  assert.equal(result.executableHash, PIN, 'review the new executable before changing its pin');
  result.artifactSha256 = sha(readFileSync(artifact)).toString('hex');
  await start('fresh');
  for (const key of [keys.player, keys.second, keys.treasury, keys.team]) await send(SystemProgram.transfer({ fromPubkey: keys.admin.publicKey, toPubkey: key.publicKey, lamports: 10e9 }), keys.admin, 'fund scratch wallet');
  await send(instruction('initialize', [writable(keys.admin.publicKey, true), readonly(PROGRAM_ID), readonly(p.programData), writable(p.config), writable(p.honkMint), readonly(p.authority), writable(p.vault), writable(p.pool), writable(p.lpMint), writable(p.lpLocker), readonly(p.locker), writable(p.emission), writable(p.airdrop), writable(p.referral), writable(p.treasury), writable(p.team), readonly(TOKEN_PROGRAM_ID), readonly(SystemProgram.programId)], [u64(50e9), keys.admin.publicKey.toBuffer(), keys.treasury.publicKey.toBuffer(), keys.team.publicKey.toBuffer(), Buffer.from([1, 24])]), keys.admin, 'initialize six allocation buckets');
  const mint = await getMint(conn, p.honkMint); assert.equal(mint.supply, SUPPLY); assert.equal(mint.mintAuthority, null); assert.equal(mint.freezeAuthority, null);
  for (const [name, amount] of Object.entries({ vault: 15_000_000, emission: 55_000_000, airdrop: 8_000_000, referral: 4_000_000, treasury: 10_000_000, team: 8_000_000 })) assert.equal(await balance(p[name]), BigInt(amount) * UNIT);
  await conservation(); check('fresh 100M premint, revoked authorities and six-bucket conservation');
  const first = leaf(0, keys.player.publicKey, 1000n * UNIT), second = leaf(0, keys.second.publicKey, 500n * UNIT), root = parent(first, second);
  await refuse('stranger cannot publish an airdrop root', setRoot(9, root, 2000n * UNIT, keys.player), /BadAuthority|0x177a/);
  await send(setRoot(0, root, 2000n * UNIT), keys.admin, 'set_airdrop_root 0');
  const info = (await conn.getAccountInfo(campaign(0))).data;
  assert.equal(info.readBigInt64LE(65) - info.readBigInt64LE(57), 90n * 86400n); check('published campaign has the real 90-day window');
  await refuse('Merkle claim binds the exact wallet and amount', claim(0, keys.player.publicKey, 999n * UNIT, [second]), /BadMerkleProof|0x177f/);
  await send(claim(0, keys.player.publicKey, 1000n * UNIT, [second]), keys.player, 'claim_airdrop player');
  await send(claim(0, keys.second.publicKey, 500n * UNIT, [first]), keys.second, 'claim_airdrop second');
  assert.equal(await balance(ata(keys.player.publicKey)), 1000n * UNIT); assert.equal(await balance(ata(keys.second.publicKey)), 500n * UNIT);
  assert.equal(await balance(p.airdrop), (8_000_000n - 1500n) * UNIT); await conservation(); check('two wallet-signed Merkle claims move exact allocation amounts without minting');
  await refuse('a campaign claim cannot be replayed', claim(0, keys.player.publicKey, 1000n * UNIT, [second]), /already in use|already initialized/);
  await send(setRoot(1, leaf(1, keys.player.publicKey, 1001n * UNIT), 1001n * UNIT), keys.admin, 'set_airdrop_root 1');
  await refuse('lifetime 2000 TEN4 wallet cap spans campaigns', claim(1, keys.player.publicKey, 1001n * UNIT), /WalletCap|0x1778/);
  await refuse('unclaimed allocation cannot burn before expiry', burnUnclaimed(0), /TooEarly|0x1772/);
  await refuse('team payout cannot bypass the 12-month cliff', vest(true), /TooEarly|0x1772/);
  await refuse('treasury payout cannot redirect the fixed recipient', vest(false, keys.player.publicKey), /ConstraintAddress|0x7dc/);
  await refuse('referral tail cannot burn before era eight', burnTail(), /TooEarly|0x1772/);
  const accounts = await snapshot(); await stop();
  await start('historical', accounts); await conservation(); check('historical genesis preserves total supply and coherent allocation balances');
  await refuse('an expired airdrop refuses a new claim', claim(1, keys.player.publicKey, 1001n * UNIT), /AirdropClosed|0x1780/);
  const supply = (await getMint(conn, p.honkMint)).supply;
  await send(burnUnclaimed(0), keys.player, 'burn_unclaimed expired campaign');
  assert.equal((await getMint(conn, p.honkMint)).supply, supply - 500n * UNIT); check('expired campaign burns only its unclaimed 500 TEN4');
  await refuse('unclaimed allocation cannot burn twice', burnUnclaimed(0), /ZeroAmount|0x1770/);
  await send(vest(false), keys.player, 'claim_treasury fully vested');
  assert.equal(await balance(ata(keys.treasury.publicKey)), 10_000_000n * UNIT); assert.equal(await balance(p.treasury), 0n);
  await send(vest(true), keys.player, 'claim_team fully vested');
  assert.equal(await balance(ata(keys.team.publicKey)), 8_000_000n * UNIT); assert.equal(await balance(p.team), 0n);
  assert.equal((await getMint(conn, p.honkMint)).supply, supply - 500n * UNIT); check('mature treasury/team vesting pays only fixed recipients without minting');
  await refuse('fully paid treasury cannot claim twice', vest(false), /TooEarly|0x1772/);
  await refuse('fully paid team cannot claim twice', vest(true), /TooEarly|0x1772/);
  const tail = await balance(p.referral); assert.equal(tail, 15_625n * UNIT);
  await send(burnTail(), keys.player, 'burn_referral_tail era eight');
  assert.equal(await balance(p.referral), 0n); assert.equal((await getMint(conn, p.honkMint)).supply, supply - 500n * UNIT - tail);
  await conservation(); check('era-eight referral tail burns its exact remainder and conserves all other balances');
  await refuse('referral tail cannot burn twice', burnTail(), /ZeroAmount|0x1770/);
  result.passed = true;
} catch (error) { result.error = error.message; console.error(error); process.exitCode = 1; }
finally { await stop(); writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 }); console.log(`evidence: ${out}`); }
