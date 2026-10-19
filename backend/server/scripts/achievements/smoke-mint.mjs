#!/usr/bin/env node
// Devnet smoke test of the real mint path: mints ONE badge (default first-mile) into the collection to a THROWAWAY wallet, waits for finalization, reads the asset id
// and then tries to TRANSFER it as the owner – a soulbound badge must refuse. Needs an RPC with the DAS API for the last two steps (they are skipped otherwise).
//   node scripts/achievements/smoke-mint.mjs --keypair ~/keys/fc-achievements.json --tree T --collection C [--id first-mile] [--rpc URL] [--yes]
import { getAssetWithProof, mintV2, parseLeafFromMintV2Transaction, transferV2 } from '@metaplex-foundation/mpl-bubblegum';
import { generateSigner, publicKey, some } from '@metaplex-foundation/umi';
import { ACHIEVEMENT_BY_ID } from '../../src/domain/achievements/achievements.ts';
import { NFT_METADATA_URIS } from '../../src/domain/achievements/nft-metadata-uris.ts';
import { EXPLORER, makeUmi, parse } from './lib.mjs';

const v = parse({ tree: { type: 'string' }, collection: { type: 'string' }, id: { type: 'string', default: 'first-mile' } });
if (v.cluster !== 'devnet') throw new Error('the smoke test runs on devnet only');
if (!v.tree || !v.collection) throw new Error('--tree and --collection are required');
const a = ACHIEVEMENT_BY_ID.get(v.id);
if (!a) throw new Error(`unknown achievement ${v.id}`);
const uri = NFT_METADATA_URIS[v.id] ?? 'https://example.invalid/not-uploaded.json';
if (!NFT_METADATA_URIS[v.id]) console.log('! metadata not uploaded: minting with a placeholder uri (fine for the smoke test)');
const umi = makeUmi(v);
const owner = generateSigner(umi); // throwaway: exists only in this process
console.log(`minter ${umi.identity.publicKey} → owner ${owner.publicKey} · ${a.name} (${v.id})`);
if (!v.yes) { console.log('dry run – add --yes to send one devnet transaction'); process.exit(0); }

const { signature } = await mintV2(umi, {
  leafOwner: owner.publicKey, merkleTree: publicKey(v.tree), coreCollection: publicKey(v.collection), collectionAuthority: umi.identity,
  metadata: { name: a.name, uri, sellerFeeBasisPoints: 0, collection: some(publicKey(v.collection)), creators: [] },
}).sendAndConfirm(umi, { confirm: { commitment: 'finalized' } });
const sig = Buffer.from(signature).toString('hex');
const leaf = await parseLeafFromMintV2Transaction(umi, signature);
console.log(`minted · asset ${leaf.id} · tx(hex) ${sig.slice(0, 16)}…\nhttps://explorer.solana.com/address/${leaf.id}${EXPLORER('devnet')}`);

let proof;
try { proof = await getAssetWithProof(umi, leaf.id, { truncateCanopy: true }); } catch (e) { console.log(`DAS unavailable on this RPC (${e.message.split('\n')[0]}) – cannot check the soulbound transfer. Pass --rpc with DAS (Helius / Triton / QuickNode add-on).`); process.exit(0); }
console.log(`DAS: owner ${proof.leafOwner} · frozen/flags: ${JSON.stringify({ flags: proof.flags ?? null })}`);
try {
  await transferV2(umi, { ...proof, authority: owner, newLeafOwner: generateSigner(umi).publicKey, coreCollection: publicKey(v.collection) }).sendAndConfirm(umi);
  console.log('✗ the TRANSFER SUCCEEDED – the badge is NOT soulbound. Do not use this collection.');
  process.exit(2);
} catch (e) {
  console.log(`✓ transfer refused as expected: ${String(e.message).split('\n')[0]}`);
}
