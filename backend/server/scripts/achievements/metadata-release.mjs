import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Local release inventory. Published leaf URIs are immutable, including the collection. */
export function metadataRelease({ catalogue, existing, collectionUri, out, cluster }) {
  const earnable = catalogue.filter(a => a.measure !== null);
  const expected = new Set(earnable.map(a => a.id));
  const gateway = cluster === 'devnet' ? 'https://devnet.irys.xyz/' : 'https://gateway.irys.xyz/';
  for (const [id, uri] of Object.entries({ ...existing, ...(collectionUri ? { collection: collectionUri } : {}) })) {
    if (id !== 'collection' && !expected.has(id)) throw new Error(`unknown published badge ${id}`);
    if (typeof uri !== 'string' || !uri.startsWith(gateway) || uri.length > 200 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(uri.slice(gateway.length))) throw new Error(`published ${id} URI does not match ${cluster}; use a separate reviewed release map for another cluster`);
  }
  const assets = [...earnable, { id: 'collection', name: 'Freight Chain Achievements' }].map(a => {
    const json = JSON.parse(readFileSync(join(out, 'metadata', `${a.id}.json`), 'utf8'));
    if (json.name !== a.name || json.image !== '__IMAGE__' || !json.properties?.files?.some(f => f.uri === '__IMAGE__' && f.type === 'image/png')) throw new Error(`invalid metadata for ${a.id}`);
    const data = readFileSync(join(out, 'png', `${a.id}.png`));
    if (data.length < 24 || data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || data.readUInt32BE(16) !== 1024 || data.readUInt32BE(20) !== 1024) throw new Error(`invalid 1024px PNG for ${a.id}`);
    return { id: a.id, data, hash: createHash('sha256').update(data).digest('hex') };
  });
  const missing = assets.filter(a => a.id === 'collection' ? !collectionUri : !existing[a.id]);
  return { earnable: earnable.length, published: Object.keys(existing).length, missing, assets };
}

export function mergeMetadataUris(existing, additions) {
  for (const [id, uri] of Object.entries(additions)) if (existing[id] && existing[id] !== uri) throw new Error(`cannot replace frozen metadata URI for ${id}`);
  return Object.fromEntries(Object.entries({ ...existing, ...additions }).sort(([a], [b]) => a.localeCompare(b)));
}
