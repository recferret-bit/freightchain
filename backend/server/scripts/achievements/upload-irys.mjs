// Uploads the achievement art + NFT metadata to Irys (Arweave) and writes server/src/domain/achievements/nft-metadata-uris.ts.
//   node scripts/achievements/upload-irys.mjs --keypair <file> --cluster devnet --rpc <url>          dry run: files, bytes, price
//   node scripts/achievements/upload-irys.mjs --keypair <file> --cluster devnet --rpc <url> --yes    upload (funds the Irys balance if needed)
// mainnet additionally needs --i-know-mainnet. --keypair is a Solana keypair file (JSON byte array) or a file holding a base58 secret; its contents are never printed.
// Idempotent: design/achievements/out/irys-cache.json maps content hash → Irys id, so a re-run never pays twice for a file that was uploaded.
// Free tier: Irys charges nothing for a file under 100 KiB – our 1024 px PNGs are ~0.5 MB each, the metadata JSON is tiny, so the images are paid (fractions of a cent each).
// Devnet Irys data is deleted after ~60 days and the devnet gateway differs – a devnet run is for rehearsal, never for URIs that mainnet mints will carry.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import bs58 from 'bs58';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const OUT = join(ROOT, 'frontend/design/achievements/out');
const CACHE = join(OUT, 'irys-cache.json');
const TARGET = join(ROOT, 'backend/server/src/domain/achievements/nft-metadata-uris.ts');

const flag = (name) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? null : (process.argv[i + 1]?.startsWith('--') ? true : process.argv[i + 1] ?? true); };
const keypairPath = flag('keypair'), cluster = flag('cluster') ?? 'devnet', rpc = flag('rpc'), yes = flag('yes') === true;
if (!keypairPath || typeof keypairPath !== 'string') { console.error('--keypair <file> is required'); process.exit(2); }
if (!['devnet', 'mainnet'].includes(cluster)) { console.error('--cluster devnet|mainnet'); process.exit(2); }
if (cluster === 'devnet' && !rpc) { console.error('--rpc <url> is required on devnet (Irys needs the devnet RPC)'); process.exit(2); }
if (cluster === 'mainnet' && yes && flag('i-know-mainnet') !== true) { console.error('mainnet uploads spend real SOL: add --i-know-mainnet'); process.exit(2); }

const GATEWAY = cluster === 'devnet' ? 'https://devnet.irys.xyz' : 'https://gateway.irys.xyz'; // devnet gateway: per Irys docs – check before relying on it
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
const saveCache = () => writeFileSync(CACHE, JSON.stringify(cache, null, 2) + '\n');
const key = (cluster_, hash) => `${cluster_}:${hash}`;

const secret = () => {
  const raw = readFileSync(keypairPath, 'utf8').trim();
  return raw.startsWith('[') ? Uint8Array.from(JSON.parse(raw)) : bs58.decode(raw);
};

// ---- what goes up: images first, then each metadata JSON pointing at its image
const ids = readdirSync(join(OUT, 'metadata')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
const images = ids.map((id) => { const file = join(OUT, 'png', `${id}.png`); if (!existsSync(file)) throw new Error(`missing ${file} – run design/achievements/generate.mjs`); const data = readFileSync(file); return { id, data, hash: sha(data) }; });
const pending = images.filter((i) => !cache[key(cluster, i.hash)]);
const metaBytes = ids.length * 1200; // an estimate: the real bytes are known once the image ids are
const bytes = pending.reduce((n, i) => n + i.data.length, 0) + metaBytes;
console.log(`${ids.length} achievements (+ collection): ${images.length - pending.length} image(s) already uploaded, ${pending.length} to upload (${(bytes / 1024).toFixed(0)} KiB incl. metadata), cluster ${cluster}`);

const { Uploader } = await import('@irys/upload');
const { Solana } = await import('@irys/upload-solana');
let b = Uploader(Solana).withWallet(secret());
if (rpc) b = b.withRpc(rpc);
if (cluster === 'devnet') b = b.devnet();
const irys = await b;
const price = await irys.getPrice(bytes);
const balance = await irys.getLoadedBalance();
console.log(`wallet ${irys.address}: Irys balance ${irys.utils.fromAtomic(balance)} SOL, price ≈ ${irys.utils.fromAtomic(price)} SOL`);
if (!yes) { console.log('dry run – nothing was uploaded; add --yes to upload'); process.exit(0); }

if (balance.lt(price)) {
  const top = price.minus(balance).times(1.1).integerValue();
  console.log(`funding the Irys balance with ${irys.utils.fromAtomic(top)} SOL`);
  await irys.fund(top);
}

const upload = async (data, type, hash) => {
  const hit = cache[key(cluster, hash)];
  if (hit) return hit;
  const res = await irys.upload(data, { tags: [{ name: 'Content-Type', value: type }] });
  cache[key(cluster, hash)] = res.id;
  saveCache(); // after every file: a crash loses nothing that was paid for
  return res.id;
};

const uris = {};
let collectionUri = '';
for (const img of images) {
  const imageId = await upload(img.data, 'image/png', img.hash);
  const json = readFileSync(join(OUT, 'metadata', `${img.id}.json`), 'utf8').replaceAll('__IMAGE__', `${GATEWAY}/${imageId}`);
  JSON.parse(json); // refuse to ship a broken file
  const id = await upload(Buffer.from(json), 'application/json', sha(Buffer.from(json)));
  const uri = `${GATEWAY}/${id}`;
  if (uri.length > 200) throw new Error(`${uri} is longer than the 200 characters a leaf allows`);
  if (img.id === 'collection') collectionUri = uri; else uris[img.id] = uri;
  console.log(`${img.id}: ${uri}`);
}

const body = Object.entries(uris).map(([id, uri]) => `  '${id}': '${uri}',`).join('\n');
writeFileSync(TARGET, `/* GENERATED by server/scripts/achievements/upload-irys.mjs (${cluster}) – the Arweave / Irys URI of each achievement's NFT metadata (the collection's too). The URI is baked into
   every leaf minted, so once a mint went out an entry is FROZEN. Empty until the metadata is uploaded: the mint job leaves an achievement without a URI queued. */
export const NFT_METADATA_URIS: Readonly<Record<string, string>> = {
${body}
};
export const NFT_COLLECTION_URI = '${collectionUri}';
`);
console.log(`wrote ${TARGET}`);
