#!/usr/bin/env node
// Devnet smoke test of the real mint path: mints ONE badge (default first-mile) into the collection to a THROWAWAY wallet, waits for finalization, reads the asset id
// and then tries to TRANSFER it as the owner – a soulbound badge must refuse. Needs an RPC with the DAS API for the last two steps; missing DAS or an unrelated transfer failure fails the test.
//   node scripts/achievements/smoke-mint.mjs --keypair ~/keys/fc-achievements.json --tree T --collection C [--id first-mile] [--rpc URL] [--yes]
import assert from 'node:assert/strict';
import { verifyLeaf } from '@metaplex-foundation/mpl-account-compression';
import { publicKey as keySerializer, u8, u64 } from '@metaplex-foundation/umi/serializers';
import { CollectionIsFrozenError, hash, getAssetWithProof, mintV2, parseLeafFromMintV2Transaction, transferV2 } from '@metaplex-foundation/mpl-bubblegum';
import { generateSigner, publicKey, some } from '@metaplex-foundation/umi';
import { ACHIEVEMENT_BY_ID } from '../../src/domain/achievements/achievements.ts';
import { NFT_METADATA_URIS } from '../../src/domain/achievements/nft-metadata-uris.ts';
import { EXPLORER, makeUmi, parse } from './lib.mjs';

const v = parse({ tree: { type: 'string' }, collection: { type: 'string' }, id: { type: 'string', default: 'first-mile' } });
if (v.cluster !== 'devnet') throw new Error('the smoke test runs on devnet only');
if (!v.tree || !v.collection) throw new Error('--tree and --collection are required');
const a = ACHIEVEMENT_BY_ID.get(v.id);
if (!a) throw new Error(`unknown achievement ${v.id}`);
const uri = NFT_METADATA_URIS[v.id];
if (!uri) throw new Error('badge metadata must be published before the devnet smoke test');
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

const proof = await getAssetWithProof(umi, leaf.id, { truncateCanopy: false });
assert.equal(leaf.__kind, 'V2');
assert.equal(proof.leafOwner, owner.publicKey, 'DAS owner differs from the mint recipient');
assert.equal(proof.merkleTree, publicKey(v.tree), 'DAS returned a different tree');
assert.equal(BigInt(proof.nonce), leaf.nonce, 'DAS returned a different leaf index');
const key = keySerializer();
const leafHash = hash([u8().serialize(2), key.serialize(leaf.id), key.serialize(leaf.owner), key.serialize(leaf.delegate), u64().serialize(leaf.nonce), leaf.dataHash, leaf.creatorHash, leaf.collectionHash, leaf.assetDataHash, u8().serialize(leaf.flags)]);
await verifyLeaf(umi, { merkleTree: proof.merkleTree, root: proof.root, leaf: leafHash, index: proof.index, proof: proof.proof }).sendAndConfirm(umi);
console.log(`DAS owner ${proof.leafOwner}; minted leaf proof verified on chain`);
const compact = await getAssetWithProof(umi, leaf.id, { truncateCanopy: true });
await assert.rejects(
  transferV2(umi, { ...compact, assetDataHash: some(leaf.assetDataHash), flags: some(leaf.flags), authority: owner, newLeafOwner: generateSigner(umi).publicKey, coreCollection: publicKey(v.collection) }).sendAndConfirm(umi),
  error => error instanceof CollectionIsFrozenError,
  'expected the Bubblegum collection-freeze refusal; success or any unrelated error fails this test',
);
console.log('✓ valid owner/proof; transfer refused specifically because the collection is frozen');
