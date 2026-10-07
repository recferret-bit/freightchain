// Needs NO SOL: fetches real recent devnet transactions that use the Memo program and checks that our payment check understands what the RPC really returns
// (programId as PublicKey, memo as a plain string, System transfer info, accountKeys[0].signer) – the part a fake chain can't prove. Run after `npm run build`.
import { Connection, PublicKey, SystemProgram } from '@solana/web3.js';
import { checkPayment, MEMO_PROGRAM } from '../dist/rides/payments.service.js';
const conn = new Connection(process.env.SOLANA_RPC || 'https://api.devnet.solana.com', { commitment: 'confirmed', disableRetryOnRateLimit: true }), sleep = ms => new Promise(r => setTimeout(r, ms));   // public RPC: go slowly
const sigs = await conn.getSignaturesForAddress(MEMO_PROGRAM, { limit: 40 }, 'confirmed');
console.log(`${sigs.length} recent memo-program signatures; first entry as listed (note the memo field):`, JSON.stringify(sigs[0]));
let found = 0;
for (const { signature, err } of sigs) {
  if (err) continue;
  await sleep(1200);
  let tx; try { tx = await conn.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }); } catch (e) { console.log(`(skipped one: ${String(e.message).slice(0, 60)})`); await sleep(4000); continue; }
  if (!tx || tx.meta?.err) continue;
  const ixs = tx.transaction.message.instructions, memoIx = ixs.find(i => i.programId?.equals?.(MEMO_PROGRAM) && 'parsed' in i), xfer = ixs.find(i => 'parsed' in i && i.programId.equals(SystemProgram.programId) && i.parsed?.type === 'transfer');
  if (!memoIx || !xfer) continue;
  found++;
  const k0 = tx.transaction.message.accountKeys[0], info = xfer.parsed.info;
  console.log('\nshape:', JSON.stringify({ memoProgramIdIsPublicKey: memoIx.programId instanceof PublicKey, memoParsedType: typeof memoIx.parsed, memoParsed: memoIx.parsed, transfer: { type: xfer.parsed.type, lamportsType: typeof info.lamports, ...info }, key0: { pubkey: k0.pubkey.toBase58(), signer: k0.signer }, metaErr: tx.meta.err }));
  const own = checkPayment(tx, info.source, info.destination, Number(info.lamports), memoIx.parsed);
  const wrongMemo = checkPayment(tx, info.source, info.destination, Number(info.lamports), memoIx.parsed + 'x');
  const tooMuch = checkPayment(tx, info.source, info.destination, Number(info.lamports) + 1, memoIx.parsed);
  console.log(`checkPayment(own values) → ${own}  (must be null)\n  wrong memo → "${wrongMemo}"\n  1 lamport too much → "${tooMuch}"`);
  if (own !== null || !wrongMemo || !tooMuch || k0.pubkey.toBase58() !== info.source) { console.log('MISMATCH between the real RPC shape and checkPayment'); process.exit(1); }
  if (found >= 2) break;
}
if (!found) { console.log('no recent devnet transaction with both a memo and a system transfer found – try again later or raise the limit'); process.exit(2); }
console.log(`\nok – ${found} real transaction(s) understood`);
