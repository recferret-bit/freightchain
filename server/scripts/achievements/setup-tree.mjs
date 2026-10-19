#!/usr/bin/env node
// Creates the badge collection (MPL-Core, soulbound) and the Bubblegum v2 Merkle tree, with ONE keypair that then becomes ACHIEVEMENT_MINT_SECRET.
// Dry-run by default (balance + cost); --yes sends. Devnet by default; mainnet needs --rpc and --i-know-mainnet. docs/spec/web3_solana.md
//   node scripts/achievements/setup-tree.mjs --keypair ~/keys/fc-achievements.json [--cluster devnet] [--rpc URL] [--depth 16 --buffer 64 --canopy 10] [--thaw-authority] [--yes]
import { createCollection } from '@metaplex-foundation/mpl-core';
import { createTreeV2 } from '@metaplex-foundation/mpl-bubblegum';
import { generateSigner } from '@metaplex-foundation/umi';
import { EXPLORER, makeUmi, parse, sol } from './lib.mjs';
import { NFT_COLLECTION_URI } from '../../src/domain/achievements/nft-metadata-uris.ts';

const v = parse({ depth: { type: 'string', default: '16' }, buffer: { type: 'string', default: '64' }, canopy: { type: 'string', default: '10' }, 'thaw-authority': { type: 'boolean', default: false } });
const umi = makeUmi(v);
const depth = Number(v.depth), buffer = Number(v.buffer), canopy = Number(v.canopy);
const balance = await umi.rpc.getBalance(umi.identity.publicKey);
console.log(`cluster ${v.cluster} · key ${umi.identity.publicKey} · balance ${sol(balance)} SOL`);
console.log(`tree: depth ${depth} (${(2 ** depth).toLocaleString('en')} badges), buffer ${buffer}, canopy ${canopy} · collection: soulbound, ${v['thaw-authority'] ? 'the update authority can thaw' : 'NOBODY can ever thaw (permanent)'}`);
if (!NFT_COLLECTION_URI) console.log('! collection metadata is not uploaded yet (NFT_COLLECTION_URI is empty – run scripts/achievements/upload-irys.mjs first); the collection would have an empty uri.');
if (!v.yes) { console.log('dry run – nothing sent. Add --yes.'); process.exit(0); }
if (balance.basisPoints < 600_000_000n && v.cluster === 'devnet') console.log('! balance under 0.6 SOL – a depth-16 tree needs ~0.7 SOL of rent; fund the key above (devnet faucet) if this fails');

const collection = generateSigner(umi);
const c = await createCollection(umi, {
  collection, name: 'Freight Chain Achievements', uri: NFT_COLLECTION_URI,
  plugins: [{ type: 'BubblegumV2' }, { type: 'PermanentFreezeDelegate', frozen: true, authority: v['thaw-authority'] ? { type: 'UpdateAuthority' } : { type: 'None' } }],
}).sendAndConfirm(umi);
console.log(`collection ${collection.publicKey}`);
const merkleTree = generateSigner(umi);
const t = await (await createTreeV2(umi, { merkleTree, maxDepth: depth, maxBufferSize: buffer, canopyDepth: canopy, public: false })).sendAndConfirm(umi);
console.log(`tree ${merkleTree.publicKey}`);
void c; void t;
console.log(`\nexplorer: https://explorer.solana.com/address/${merkleTree.publicKey}${EXPLORER(v.cluster)}\n\nset in server/.env (or deploy/.env) – the SECRET is this keypair file's contents as a base58 string / json array, copy it yourself, it is not printed:\nACHIEVEMENT_TREE=${merkleTree.publicKey}\nACHIEVEMENT_COLLECTION=${collection.publicKey}\nACHIEVEMENT_MINT_SECRET=<${v.keypair}>`);
