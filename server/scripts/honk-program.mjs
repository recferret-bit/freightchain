// Local HONK program (docs/agents/honk-program.md). Not deployed. The coin is this program's mint, not a keypair mint.
// Instruction data is Anchor: sha256("global:<name>").subarray(0, 8) plus little-endian borsh. Amounts are base units; sol_in is lamports.
import { createHash } from 'node:crypto';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, TokenAccountNotFoundError, getAccount, getAssociatedTokenAddressSync, getMint } from '@solana/spl-token';

export const PROGRAM_ID = new PublicKey('GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx');
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
    config: pda([Buffer.from('config')]),
    authority: pda([Buffer.from('authority')]),
    honkMint: pda([Buffer.from('honk-mint')]),
    vault: pda([Buffer.from('vault')]),
    pool: pda([Buffer.from('pool')]),
    lpMint: pda([Buffer.from('lp-mint')]),
    lpLocker: pda([Buffer.from('lp-locker')]),
    locker: pda([Buffer.from('locker')]),
  };
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

export async function initialize({ rpc, payer, solIn }) {
  const p = pdas();
  const keys = [
    w(payer.publicKey, true), w(p.config), w(p.honkMint), w(p.authority), w(p.vault), w(p.pool),
    w(p.lpMint), w(p.lpLocker), w(p.locker), ro(TOKEN_PROGRAM_ID), ro(SystemProgram.programId),
  ];
  return send(connectionOf(rpc), new Transaction().add(ix('initialize', keys, [u64(solIn)])), [payer]);
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

/** Burn LP for that share of the vault and the SOL reserve. The locker holds the LP until `release_lp`. */
export async function withdrawLp({ rpc, user, lpIn, minHonk, minSol }) {
  const p = pdas();
  const owner = asPk(user.publicKey ?? user);
  const keys = [
    w(owner, true), w(p.pool), w(p.honkMint), w(p.vault), w(userHonk({ publicKey: owner })),
    w(p.lpMint), w(getAssociatedTokenAddressSync(p.lpMint, owner, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)),
    ro(TOKEN_PROGRAM_ID), ro(SystemProgram.programId), ro(ASSOCIATED_TOKEN_PROGRAM_ID),
  ];
  return send(connectionOf(rpc), new Transaction().add(ix('withdraw_lp', keys, [u64(lpIn), u64(minHonk), u64(minSol)])), [user]);
}

/** Ride reward. The emitter signs. The vault is not a party to this instruction. */
export async function mintRide({ rpc, emitter, rider, rideId, amount }) {
  const p = pdas();
  const riderPk = asPk(rider);
  const ride = rideId.length === 16 ? rideId : Buffer.from(rideId);
  const keys = [
    w(emitter.publicKey, true), w(p.config), w(p.honkMint), w(p.authority), ro(riderPk),
    w(userHonk({ publicKey: riderPk })), w(pda([Buffer.from('ride-mint'), ride])),
    ro(TOKEN_PROGRAM_ID), ro(SystemProgram.programId), ro(ASSOCIATED_TOKEN_PROGRAM_ID),
  ];
  const data = [ride, u64(amount)];
  return send(connectionOf(rpc), new Transaction().add(ix('mint_ride', keys, data)), [emitter]);
}

export async function burn({ rpc, user, amount }) {
  const p = pdas();
  const keys = [w(user.publicKey, true), w(p.honkMint), w(userHonk(user)), ro(TOKEN_PROGRAM_ID)];
  return send(connectionOf(rpc), new Transaction().add(ix('burn', keys, [u64(amount)])), [user]);
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

/** The contract lists no accounts. This is the program's order: the time check runs only after the recipient's LP ATA is in the list. */
export async function releaseLp({ rpc, payer }) {
  const p = pdas();
  const recipientLp = getAssociatedTokenAddressSync(p.lpMint, payer.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const keys = [
    w(payer.publicKey, true), ro(p.pool), ro(p.lpMint), w(p.lpLocker), ro(p.locker), w(recipientLp),
    ro(TOKEN_PROGRAM_ID), ro(ASSOCIATED_TOKEN_PROGRAM_ID), ro(SystemProgram.programId),
  ];
  return send(connectionOf(rpc), new Transaction().add(ix('release_lp', keys, [])), [payer]);
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
