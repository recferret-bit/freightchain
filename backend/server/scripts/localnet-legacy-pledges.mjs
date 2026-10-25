// Historical escrow is explicit genesis state: v6 cannot create it. Attestations are made by the real program in phase 1;
// phase 2 exercises the unchanged permissionless settlement/refund paths and checks every lamport and duplicate guard.
import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { PublicKey } from '@solana/web3.js';

const MAX = 2_000_000, RATE = 1_000_000;
const bytes = id => { const b = Buffer.alloc(32); Buffer.from(id.replaceAll('-', ''), 'hex').copy(b); return b; };
export function recordLegacyAttestations({ admin, pool, driver, keyfile }) {
  const rides = ['verified', 'flagged', 'absent'].map(status => ({ status, rideId: crypto.randomUUID() }));
  for (const r of rides.filter(r => r.status !== 'absent')) admin(['record-ride-attestation', '--pool', String(pool), '--ride', r.rideId, '--driver', driver, '--km', r.status === 'verified' ? '1' : '0', '--status', r.status, '-k', keyfile]);
  return rides;
}
export async function dumpLegacyPledges({ conn, codec, idl, out, pool, sponsor, driver, rides, back, dumps, dump, check }) {
  const poolKey = codec.poolPda(pool), sponsorKey = new PublicKey(sponsor);
  const legacy = [];
  for (const r of rides) {
    const ride = bytes(r.rideId);
    const [address, bump] = PublicKey.findProgramAddressSync([Buffer.from('pledge'), ride, sponsorKey.toBuffer()], codec.programId);
    const data = Buffer.alloc(182); // discriminator + frozen Pledge layout
    let o = 0;
    for (const b of [Buffer.from(idl.accounts.find(a => a.name === 'Pledge').discriminator), ride, sponsorKey.toBuffer(), new PublicKey(driver).toBuffer(), poolKey.toBuffer()]) { b.copy(data, o); o += b.length; }
    data.writeBigUInt64LE(BigInt(MAX), o); o += 8; data.writeBigUInt64LE(BigInt(RATE), o); o += 8;
    data.writeUInt32LE(2, o); o += 4; o += 1 + 8 + 8; data.writeBigInt64LE(BigInt(back - 60), o); o += 8; data[o] = bump;
    const decoded = codec.decodeAccount('Pledge', data), rent = await conn.getMinimumBalanceForRentExemption(data.length);
    check(`historical ${r.status} pledge genesis decodes at its PDA`, address.equals(codec.pledgePda(ride, sponsor)) && decoded?.maxLamports === MAX && decoded.driver === driver && decoded.sponsor === sponsor && !decoded.settled && decoded.bump === bump);
    const file = `${out}/pledge-legacy-${r.status}.json`;
    writeFileSync(file, JSON.stringify({ pubkey: address.toBase58(), account: { lamports: MAX + rent, data: [data.toString('base64'), 'base64'], owner: codec.programId.toBase58(), executable: false, rentEpoch: 0, space: data.length } }));
    dumps.push({ label: `pledge-legacy-${r.status}`, address: address.toBase58(), file, data });
    if (r.status !== 'absent') await dump(`ride-attestation-legacy-${r.status}`, codec.rideAttestationPda(pool, ride), d => { d.writeBigInt64LE(BigInt(back), 141); d.writeBigInt64LE(BigInt(back), 149); });
    legacy.push({ ...r, address: address.toBase58(), rent, max: MAX });
  }
  const p = dumps.find(d => d.label === 'pool-grace'), j = JSON.parse(readFileSync(p.file, 'utf8'));
  p.data.writeUInt32LE(legacy.length, 355); j.account.data[0] = p.data.toString('base64'); writeFileSync(p.file, JSON.stringify(j));
  check('historical pool open_pledges matches the three genesis escrows', codec.decodeAccount('Pool', p.data)?.openPledges === legacy.length);
  return { pool, sponsor, driver, pledges: legacy };
}
export async function settleLegacyPledges({ conn, codec, admin, legacy, caller, cov, check }) {
  const bal = address => conn.getBalance(new PublicKey(address), 'confirmed');
  const before = { sponsor: await bal(legacy.sponsor), driver: await bal(legacy.driver) };
  const args = p => ['--pool', String(legacy.pool), '--ride', p.rideId, '--sponsor', legacy.sponsor, '--driver', legacy.driver, '-k', caller];
  const refuse = (name, command, want) => { try { admin(command); check(name, false, 'unexpected success'); } catch (e) { check(name, cov.refused(name, e) === want); } };
  refuse('legacy decided attestation cannot be refunded', ['refund-pledge', ...args(legacy.pledges[0])], 'AttestationExists');
  for (const p of legacy.pledges) {
    const command = p.status === 'absent' ? 'refund-pledge' : 'settle-pledge';
    const s0 = await bal(legacy.sponsor), d0 = await bal(legacy.driver);
    const result = admin([command, ...args(p)]);
    const tx = await conn.getTransaction(result.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    const lines = codec.programData(tx.meta.logMessages), events = lines === 'truncated' ? [] : lines.map(l => codec.decodeEvent(l.bytes)).filter(Boolean);
    const event = events.find(e => e.name === (p.status === 'absent' ? 'PledgeRefunded' : 'PledgeSettled'))?.fields;
    const earned = p.status === 'verified' ? RATE : 0;
    check(`legacy ${p.status}: exact driver earning, sponsor refund and rent; escrow closed`, !tx.meta.err && event?.refundedLamports === MAX - earned && (p.status === 'absent' || event?.earnedLamports === earned)
      && await bal(legacy.driver) - d0 === earned && await bal(legacy.sponsor) - s0 === MAX - earned + p.rent && await conn.getAccountInfo(new PublicKey(p.address)) === null);
    refuse(`legacy ${p.status}: cannot pay twice`, [command, ...args(p)], 'AccountNotInitialized');
  }
  const pool = codec.decodeAccount('Pool', (await conn.getAccountInfo(codec.poolPda(legacy.pool))).data);
  check('legacy recovery conserves every escrowed lamport and clears the open count', pool.openPledges === 0 && await bal(legacy.driver) - before.driver === RATE
    && await bal(legacy.sponsor) - before.sponsor === 3 * MAX - RATE + legacy.pledges.reduce((s, p) => s + p.rent, 0));
}
export async function closeLegacyAttestations({ conn, codec, admin, legacy, caller, rentTo, check }) {
  const before = await conn.getBalance(new PublicKey(rentTo)); let rent = 0;
  for (const p of legacy.pledges.filter(p => p.status !== 'absent')) {
    const address = codec.rideAttestationPda(legacy.pool, bytes(p.rideId));
    rent += (await conn.getAccountInfo(address)).lamports;
    admin(['close-ride-attestation', '--pool', String(legacy.pool), '--ride', p.rideId, '-k', caller]);
    check(`legacy ${p.status} attestation closes after the pool settles`, await conn.getAccountInfo(address) === null);
  }
  check('legacy attestation rent returns to its original payer', await conn.getBalance(new PublicKey(rentTo)) - before === rent);
}
