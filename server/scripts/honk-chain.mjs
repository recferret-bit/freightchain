// Local TEN4 only (docs/agents/ten4-localnet.md). The game balance stays the ledger. Classic SPL for the fungible mint; Token-2022 for a soulbound part.
import { Connection, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ExtensionType, TYPE_SIZE, LENGTH_SIZE, getMintLen,
  createMint, getOrCreateAssociatedTokenAccount, mintTo, transfer, burn, getAccount, getMint,
  getAssociatedTokenAddressSync, createInitializeMint2Instruction, createInitializeMetadataPointerInstruction,
  createInitializeNonTransferableMintInstruction, createAssociatedTokenAccountInstruction, createMintToInstruction,
  getNonTransferable, TokenAccountNotFoundError,
} from '@solana/spl-token';
import { createInitializeInstruction, pack } from '@solana/spl-token-metadata';

const CONFIRMED = { commitment: 'confirmed' };

function connectionOf(rpc) {
  return new Connection(rpc, 'confirmed');
}

function asPk(x) {
  if (x instanceof PublicKey) return x;
  if (x?.publicKey) return x.publicKey;
  return new PublicKey(x);
}

function dedupe(signers) {
  const out = [];
  const seen = new Set();
  for (const s of signers) {
    const id = s.publicKey.toBase58();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(s);
  }
  return out;
}

async function send(connection, tx, signers) {
  return sendAndConfirmTransaction(connection, tx, dedupe(signers), CONFIRMED);
}

function missingAta(e) {
  return e instanceof TokenAccountNotFoundError || e?.name === 'TokenAccountNotFoundError';
}

/** Mint authority is the payer. No freeze authority: a frozen holder could not burn. */
export async function createHonkMint({ rpc, payer, mint }) {
  return createMint(connectionOf(rpc), payer, payer.publicKey, null, 6, mint, CONFIRMED, TOKEN_PROGRAM_ID);
}

/** `amount` is base units. Creates `dest`'s ATA. The payer pays the fee; `authority` signs the mint. */
export async function mintHonk({ rpc, payer, mint, authority, dest, amount }) {
  const connection = connectionOf(rpc);
  const mintPk = asPk(mint);
  const ata = await getOrCreateAssociatedTokenAccount(connection, payer, mintPk, new PublicKey(dest), false, 'confirmed', CONFIRMED, TOKEN_PROGRAM_ID);
  return mintTo(connection, payer, mintPk, ata.address, authority, amount, [], CONFIRMED, TOKEN_PROGRAM_ID);
}

/** `owner` holds the tokens and signs. The payer pays the fee. */
export async function transferHonk({ rpc, payer, mint, owner, dest, amount }) {
  const connection = connectionOf(rpc);
  const mintPk = asPk(mint);
  const ata = await getOrCreateAssociatedTokenAccount(connection, payer, mintPk, new PublicKey(dest), false, 'confirmed', CONFIRMED, TOKEN_PROGRAM_ID);
  const src = getAssociatedTokenAddressSync(mintPk, owner.publicKey, false, TOKEN_PROGRAM_ID);
  return transfer(connection, payer, src, ata.address, owner, amount, [], CONFIRMED, TOKEN_PROGRAM_ID);
}

export async function burnHonk({ rpc, payer, mint, owner, amount }) {
  const connection = connectionOf(rpc);
  const mintPk = asPk(mint);
  const src = getAssociatedTokenAddressSync(mintPk, owner.publicKey, false, TOKEN_PROGRAM_ID);
  return burn(connection, payer, src, mintPk, owner, amount, [], CONFIRMED, TOKEN_PROGRAM_ID);
}

export async function honkBalance({ rpc, mint, owner }) {
  const connection = connectionOf(rpc);
  const mintPk = asPk(mint);
  const ata = getAssociatedTokenAddressSync(mintPk, asPk(owner), false, TOKEN_PROGRAM_ID);
  try {
    const acct = await getAccount(connection, ata, 'confirmed', TOKEN_PROGRAM_ID);
    return acct.amount;
  } catch (e) {
    if (missingAta(e)) return 0n;
    throw e;
  }
}

export async function honkSupply({ rpc, mint }) {
  const info = await getMint(connectionOf(rpc), asPk(mint), 'confirmed', TOKEN_PROGRAM_ID);
  return info.supply;
}

/** One non-transferable Token-2022 token. `mintKeypair` is the caller's (a retry of the same key must not mint a second one). */
export async function mintPartNft({ rpc, payer, authority, owner, name, uri, mintKeypair }) {
  const connection = connectionOf(rpc);
  const mintPk = mintKeypair.publicKey;
  const existing = await connection.getAccountInfo(mintPk, 'confirmed');
  if (existing) {
    const view = await partNft({ rpc, mint: mintPk });
    if (view.supply === 1n && view.owner === owner) return { mint: mintPk.toBase58(), signature: null, owner };
    throw new Error(`part mint ${mintPk.toBase58()} exists but ${owner} does not hold 1`);
  }
  const meta = { updateAuthority: authority.publicKey, mint: mintPk, name, symbol: 'TEN4', uri, additionalMetadata: [] };
  const extensions = [ExtensionType.NonTransferable, ExtensionType.MetadataPointer];
  const mintLen = getMintLen(extensions);
  // The metadata TLV is written after the mint exists, and that realloc must stay rent-exempt. The extra bytes cover TLV padding.
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen + TYPE_SIZE + LENGTH_SIZE + pack(meta).length + 128);
  const ownerPk = new PublicKey(owner);
  const ata = getAssociatedTokenAddressSync(mintPk, ownerPk, false, TOKEN_2022_PROGRAM_ID);
  const tx = new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mintPk, space: mintLen, lamports, programId: TOKEN_2022_PROGRAM_ID }),
    createInitializeMetadataPointerInstruction(mintPk, authority.publicKey, mintPk, TOKEN_2022_PROGRAM_ID),
    createInitializeNonTransferableMintInstruction(mintPk, TOKEN_2022_PROGRAM_ID),
    createInitializeMint2Instruction(mintPk, 0, authority.publicKey, null, TOKEN_2022_PROGRAM_ID),
    createInitializeInstruction({ programId: TOKEN_2022_PROGRAM_ID, metadata: mintPk, updateAuthority: authority.publicKey, mint: mintPk, mintAuthority: authority.publicKey, name, symbol: 'TEN4', uri }),
    createAssociatedTokenAccountInstruction(payer.publicKey, ata, ownerPk, mintPk, TOKEN_2022_PROGRAM_ID),
    createMintToInstruction(mintPk, ata, authority.publicKey, 1n, [], TOKEN_2022_PROGRAM_ID),
  );
  const signature = await send(connection, tx, [payer, mintKeypair, authority]);
  return { mint: mintPk.toBase58(), signature, owner };
}

/** `transferable` is false when the NonTransferable extension is on the mint. `owner` is the holder of the supply. */
export async function partNft({ rpc, mint }) {
  const connection = connectionOf(rpc);
  const mintPk = asPk(mint);
  const info = await getMint(connection, mintPk, 'confirmed', TOKEN_2022_PROGRAM_ID);
  const rows = await connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, { commitment: 'confirmed', filters: [{ memcmp: { offset: 0, bytes: mintPk.toBase58() } }] });
  let owner = null;
  for (const row of rows) {
    try {
      const acct = await getAccount(connection, row.pubkey, 'confirmed', TOKEN_2022_PROGRAM_ID);
      if (acct.amount > 0n) owner = acct.owner.toBase58();
    } catch { /* a memcmp hit that is not a token account */ }
  }
  return { supply: info.supply, owner, decimals: info.decimals, transferable: getNonTransferable(info) === null };
}
