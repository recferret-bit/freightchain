// The player signs a TEN4 (freightchain_honk) program transaction. Used only when GET /api/honk returns chain.programId.
// The local suite signs with its own keys. A browser wallet sends on its own cluster, which is not the local validator.
import { payingWallet, ensureAccount } from './wallet.js';
import { publicRpc } from './pools.js';

const WEB3 = 'https://cdn.jsdelivr.net/npm/@solana/web3.js@1.99.0/lib/index.iife.min.js';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
let web3p;
const loadWeb3 = () => web3p ??= new Promise((ok, no) => {
  if (window.solanaWeb3) return ok(window.solanaWeb3);
  const s = document.createElement('script'); s.src = WEB3; s.onload = () => ok(window.solanaWeb3); s.onerror = () => { web3p = undefined; no(new Error('could not load web3.js (offline?)')); }; document.head.append(s);
});

function pad16(text) {
  const raw = new TextEncoder().encode(text);
  if (raw.length > 16) throw new Error('part name is too long');
  const out = new Uint8Array(16); out.set(raw); return out;
}
const disc = async (name) => {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(`global:${name}`)));
  return digest.slice(0, 8);
};
const u64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };

async function send(programId, owner, build) {
  const web3 = await loadWeb3();
  const program = new web3.PublicKey(programId);
  const ownerPk = new web3.PublicKey(owner);
  const rpc = (typeof window !== 'undefined' && window.__HONK_RPC) || publicRpc();
  const connection = new web3.Connection(rpc, 'confirmed');
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const tx = new web3.Transaction({ feePayer: ownerPk, recentBlockhash: blockhash });
  const extra = await build(web3, program, ownerPk, tx);
  if (extra) tx.partialSign(extra);
  const p = await payingWallet(owner);
  if (!p) throw Object.assign(new Error('No Solana wallet found – install Phantom or Solflare'), { code: 'no_wallet' });
  await ensureAccount(p, owner);
  const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  const r = await p.signAndSendTransaction(p.standard ? Uint8Array.from(bytes) : web3.Transaction.from(bytes));
  return typeof r === 'string' ? r : r.signature;
}

function pda(web3, program, seed) {
  return web3.PublicKey.findProgramAddressSync([new TextEncoder().encode(seed)], program)[0];
}

/** Burn `amount` base units. Returns the signature. */
export async function signHonkBurn({ programId, owner, amount }) {
  const dataDisc = await disc('burn');
  return send(programId, owner, (web3, program, ownerPk, tx) => {
    const honkMint = pda(web3, program, 'honk-mint');
    const ata = web3.PublicKey.findProgramAddressSync(
      [ownerPk.toBuffer(), new web3.PublicKey(TOKEN).toBuffer(), honkMint.toBuffer()],
      new web3.PublicKey(ATA),
    )[0];
    const data = new Uint8Array(16); data.set(dataDisc); data.set(u64(amount), 8);
    tx.add(new web3.TransactionInstruction({
      programId: program,
      keys: [
        { pubkey: ownerPk, isSigner: true, isWritable: true },
        { pubkey: honkMint, isSigner: false, isWritable: true },
        { pubkey: ata, isSigner: false, isWritable: true },
        { pubkey: new web3.PublicKey(TOKEN), isSigner: false, isWritable: false },
      ],
      data,
    }));
    return null;
  });
}

/** Buy one part. The new mint signs here; the wallet signs the burn. Returns the signature. */
export async function signHonkPart({ programId, owner, slot, item }) {
  const dataDisc = await disc('buy_part');
  return send(programId, owner, (web3, program, ownerPk, tx) => {
    const honkMint = pda(web3, program, 'honk-mint');
    const authority = pda(web3, program, 'authority');
    const nft = web3.Keypair.generate();
    const buyerHonk = web3.PublicKey.findProgramAddressSync(
      [ownerPk.toBuffer(), new web3.PublicKey(TOKEN).toBuffer(), honkMint.toBuffer()],
      new web3.PublicKey(ATA),
    )[0];
    const nftAta = web3.PublicKey.findProgramAddressSync(
      [ownerPk.toBuffer(), new web3.PublicKey(TOKEN).toBuffer(), nft.publicKey.toBuffer()],
      new web3.PublicKey(ATA),
    )[0];
    const part = web3.PublicKey.findProgramAddressSync(
      [new TextEncoder().encode('part'), ownerPk.toBuffer(), pad16(slot), pad16(item)],
      program,
    )[0];
    const body = new Uint8Array(8 + 32); body.set(dataDisc); body.set(pad16(slot), 8); body.set(pad16(item), 24);
    const token = new web3.PublicKey(TOKEN);
    const system = web3.SystemProgram.programId;
    const ataProg = new web3.PublicKey(ATA);
    tx.add(new web3.TransactionInstruction({
      programId: program,
      keys: [
        { pubkey: ownerPk, isSigner: true, isWritable: true },
        { pubkey: honkMint, isSigner: false, isWritable: true },
        { pubkey: buyerHonk, isSigner: false, isWritable: true },
        { pubkey: authority, isSigner: false, isWritable: false },
        { pubkey: nft.publicKey, isSigner: true, isWritable: true },
        { pubkey: nftAta, isSigner: false, isWritable: true },
        { pubkey: part, isSigner: false, isWritable: true },
        { pubkey: token, isSigner: false, isWritable: false },
        { pubkey: system, isSigner: false, isWritable: false },
        { pubkey: ataProg, isSigner: false, isWritable: false },
      ],
      data: body,
    }));
    return nft;
  });
}
