// Local TEN4 (freightchain_honk) program (docs/spec/ten4.md). Not deployed. The coin is this program's mint, not a keypair mint.
// Instruction data is Anchor: sha256("global:<name>").subarray(0, 8) plus little-endian borsh. Amounts are base units; sol_in is lamports.
import { createHash } from 'node:crypto';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, TokenAccountNotFoundError, getAccount, getAssociatedTokenAddressSync, getMint } from '@solana/spl-token';

export const PROGRAM_ID = new PublicKey('GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx');
const BPF_LOADER_UPGRADEABLE_ID = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const CONFIRMED = { commitment: 'confirmed' };

const disc = (name) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);

function u64(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

/** Zero-pad a short utf8 label to the program's 16-byte slot or item. */
export function pad16(text) {
  const raw = Buffer.from(text, 'utf8');
  if (raw.length > 16) throw new Error(`longer than 16 bytes: ${text}`);
  const out = Buffer.alloc(16);
  raw.copy(out);
  return out;
}

function asPk(x) {
  if (x instanceof PublicKey) return x;
  if (x?.publicKey) return x.publicKey;
  return new PublicKey(x);
}

function pda(seeds) {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}

export function pdas() {
  return {
    programData: PublicKey.findProgramAddressSync([PROGRAM_ID.toBuffer()], BPF_LOADER_UPGRADEABLE_ID)[0],
    config: pda([Buffer.from('config')]),
    authority: pda([Buffer.from('authority')]),
    honkMint: pda([Buffer.from('honk-mint')]),
    vault: pda([Buffer.from('vault')]),
    pool: pda([Buffer.from('pool')]),
    lpMint: pda([Buffer.from('lp-mint')]),
    lpLocker: pda([Buffer.from('lp-locker')]),
    locker: pda([Buffer.from('locker')]),
    emission: pda([Buffer.from('emission')]),
    airdrop: pda([Buffer.from('airdrop')]),
    referral: pda([Buffer.from('referral')]),
    treasury: pda([Buffer.from('treasury')]),
    team: pda([Buffer.from('team')]),
  };
}

function walletDay(rider, dayIndex) {
  const day = Buffer.alloc(8);
  day.writeBigInt64LE(BigInt(dayIndex));
  return pda([Buffer.from('wallet-day'), asPk(rider).toBuffer(), day]);
}

function partPda(buyer, slot, item) {
  return pda([Buffer.from('part'), asPk(buyer).toBuffer(), pad16(slot), pad16(item)]);
}

const w = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const ro = (pubkey) => ({ pubkey, isSigner: false, isWritable: false });

function ix(name, keys, body) {
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data: Buffer.concat([disc(name), ...body]) });
}

function connectionOf(rpc) {
  return new Connection(rpc, 'confirmed');
}

function userHonk(owner) {
  return getAssociatedTokenAddressSync(pdas().honkMint, asPk(owner), false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
}

async function send(connection, tx, signers) {
  tx.feePayer = signers[0].publicKey;
  // initialize creates the mint, the vault, and the pool in one transaction. The default 200k budget is not enough.
  tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }));
  return sendAndConfirmTransaction(connection, tx, signers, CONFIRMED);
}

export async function initialize({ rpc, payer, solIn, emitter, treasury, teamRecipient, teamEnabled = true, teamLinearMonths = 24 }) {
  const p = pdas();
  const who = (k) => (k ? asPk(k) : payer.publicKey);
  const teamOn = !!teamEnabled;
  const team = teamOn ? who(teamRecipient) : PublicKey.default;
  const months = teamOn ? teamLinearMonths : 0;
  const keys = [
    w(payer.publicKey, true), ro(PROGRAM_ID), ro(p.programData), w(p.config), w(p.honkMint), ro(p.authority), w(p.vault), w(p.pool),
    w(p.lpMint), w(p.lpLocker), ro(p.locker), w(p.emission), w(p.airdrop), w(p.referral), w(p.treasury), w(p.team),
    ro(TOKEN_PROGRAM_ID), ro(SystemProgram.programId),
  ];
  const body = [u64(solIn), who(emitter).toBuffer(), who(treasury).toBuffer(), team.toBuffer(), Buffer.from([teamOn ? 1 : 0, months])];
  return send(connectionOf(rpc), new Transaction().add(ix('initialize', keys, body)), [payer]);
}

export async function swapSolForHonk({ rpc, user, solIn, minOut }) {
  const p = pdas();
  const keys = [
    w(user.publicKey, true), w(p.pool), w(p.honkMint), w(p.vault), w(userHonk(user)),
    ro(TOKEN_PROGRAM_ID), ro(SystemProgram.programId), ro(ASSOCIATED_TOKEN_PROGRAM_ID),
  ];
  return send(connectionOf(rpc), new Transaction().add(ix('swap_sol_for_honk', keys, [u64(solIn), u64(minOut)])), [user]);
}

/** The other side of the constant product. `minSolOut` is lamports. The pool keeps its rent. */
export async function swapHonkForSol({ rpc, user, honkIn, minSolOut }) {
  const p = pdas();
  const keys = [
    w(user.publicKey, true), w(p.pool), w(p.honkMint), w(p.vault), w(userHonk(user)), ro(TOKEN_PROGRAM_ID),
  ];
  return send(connectionOf(rpc), new Transaction().add(ix('swap_honk_for_sol', keys, [u64(honkIn), u64(minSolOut)])), [user]);
}

/** LP is burned inside initialize. There is no withdraw. */
export function withdrawLp() {
  throw new Error('LP is burned at initialize; withdraw_lp is gone');
}

/** Ride reward. The program derives the amount from tier and band bits and pays it from the emission vault. */
export async function mintRide({ rpc, emitter, rider, rideId, tier = 1, bands = 0b111, dayIndex, expectedAmount = null }) {
  const p = pdas();
  const riderPk = asPk(rider);
  const ride = rideId.length === 16 ? rideId : Buffer.from(rideId);
  const day = dayIndex ?? Math.floor(Date.now() / 1000 / 86_400);
  const dayBuf = Buffer.alloc(8);
  dayBuf.writeBigInt64LE(BigInt(day));
  const keys = [
    w(emitter.publicKey, true), w(p.config), ro(p.honkMint), ro(p.authority), w(p.emission), ro(riderPk),
    w(userHonk({ publicKey: riderPk })), w(pda([Buffer.from('ride-mint'), ride])), w(walletDay(riderPk, day)),
    ro(TOKEN_PROGRAM_ID), ro(SystemProgram.programId), ro(ASSOCIATED_TOKEN_PROGRAM_ID),
  ];
  const data = [ride, Buffer.from([tier, bands]), dayBuf, expectedAmount === null ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), u64(expectedAmount)])];
  return send(connectionOf(rpc), new Transaction().add(ix('mint_ride', keys, data)), [emitter]);
}

export async function burn({ rpc, user, amount }) {
  const p = pdas();
  const keys = [w(user.publicKey, true), w(p.honkMint), w(userHonk(user)), ro(TOKEN_PROGRAM_ID)];
  return send(connectionOf(rpc), new Transaction().add(ix('burn', keys, [u64(amount)])), [user]);
}

/** Signed but not broadcast: the worker must persist its signature/expiry before sending. */
export function referralPaymentTransaction({ emitter, recipient, rewardId, baseAmount, monthIndex, blockhash, lastValidBlockHeight }) {
  const p = pdas(), owner = asPk(recipient), month = Buffer.alloc(8);
  month.writeBigInt64LE(BigInt(monthIndex));
  if (rewardId.length !== 16) throw new Error('referral reward id must contain 16 bytes');
  const keys = [
    w(emitter.publicKey, true), w(p.config), ro(p.honkMint), ro(p.authority), w(p.referral), ro(owner),
    w(userHonk(owner)), w(pda([Buffer.from('referral-mint'), rewardId])), w(pda([Buffer.from('wallet-month'), owner.toBuffer(), month])),
    ro(TOKEN_PROGRAM_ID), ro(SystemProgram.programId), ro(ASSOCIATED_TOKEN_PROGRAM_ID),
  ];
  const tx = new Transaction({ feePayer: emitter.publicKey, blockhash, lastValidBlockHeight });
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), ix('pay_referral', keys, [rewardId, u64(baseAmount), month]));
  tx.sign(emitter);
  return tx;
}

/** The program prices the pair. The new mint signs; its authority is cleared and the buyer's account is frozen. */
export async function buyPart({ rpc, buyer, slot, item }) {
  const p = pdas();
  const nft = Keypair.generate();
  const ata = getAssociatedTokenAddressSync(nft.publicKey, buyer.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const keys = [
    w(buyer.publicKey, true), w(p.honkMint), w(userHonk(buyer)), w(p.authority), w(nft.publicKey, true), w(ata),
    w(partPda(buyer, slot, item)), ro(TOKEN_PROGRAM_ID), ro(SystemProgram.programId), ro(ASSOCIATED_TOKEN_PROGRAM_ID),
  ];
  const data = [pad16(slot), pad16(item)];
  const signature = await send(connectionOf(rpc), new Transaction().add(ix('buy_part', keys, data)), [buyer, nft]);
  return { mint: nft.publicKey.toBase58(), ata: ata.toBase58(), signature };
}

/** LP is burned inside initialize. There is no release. */
export function releaseLp() {
  throw new Error('LP is burned at initialize; release_lp is gone');
}

export async function emissionBalance({ rpc }) {
  return (await getAccount(connectionOf(rpc), pdas().emission, 'confirmed', TOKEN_PROGRAM_ID)).amount;
}

export async function honkBalance({ rpc, owner, mint }) {
  const mintPk = mint ? asPk(mint) : pdas().honkMint;
  const ata = getAssociatedTokenAddressSync(mintPk, asPk(owner), false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  try {
    return (await getAccount(connectionOf(rpc), ata, 'confirmed', TOKEN_PROGRAM_ID)).amount;
  } catch (e) {
    if (e instanceof TokenAccountNotFoundError || e?.name === 'TokenAccountNotFoundError') return 0n;
    throw e;
  }
}

export async function mintState({ rpc, mint }) {
  const info = await getMint(connectionOf(rpc), mint ? asPk(mint) : pdas().honkMint, 'confirmed', TOKEN_PROGRAM_ID);
  return {
    supply: info.supply,
    decimals: info.decimals,
    mintAuthority: info.mintAuthority ? info.mintAuthority.toBase58() : null,
    freezeAuthority: info.freezeAuthority ? info.freezeAuthority.toBase58() : null,
  };
}

export async function tokenAccount({ rpc, mint, owner }) {
  const address = getAssociatedTokenAddressSync(asPk(mint), asPk(owner), false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const acct = await getAccount(connectionOf(rpc), address, 'confirmed', TOKEN_PROGRAM_ID);
  return { address: address.toBase58(), amount: acct.amount, isFrozen: acct.isFrozen, owner: acct.owner.toBase58() };
}

export async function vaultBalance({ rpc }) {
  return (await getAccount(connectionOf(rpc), pdas().vault, 'confirmed', TOKEN_PROGRAM_ID)).amount;
}

export async function poolLamports({ rpc }) {
  const info = await connectionOf(rpc).getAccountInfo(pdas().pool, 'confirmed');
  if (!info) throw new Error('pool account missing');
  return info.lamports;
}
