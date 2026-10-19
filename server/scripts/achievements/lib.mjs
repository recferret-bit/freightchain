// Shared by setup-tree.mjs and smoke-mint.mjs: argument parsing, the umi instance and the cluster rules. Never prints key material.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { mplBubblegum } from '@metaplex-foundation/mpl-bubblegum';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createSignerFromKeypair, keypairIdentity } from '@metaplex-foundation/umi';

export const CLUSTERS = { devnet: 'https://api.devnet.solana.com', 'mainnet-beta': null };
export const EXPLORER = (cluster) => (cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`);

export function parse(options) {
  const { values } = parseArgs({
    options: { keypair: { type: 'string' }, cluster: { type: 'string', default: 'devnet' }, rpc: { type: 'string' }, yes: { type: 'boolean', default: false }, 'i-know-mainnet': { type: 'boolean', default: false }, ...options },
  });
  if (!values.keypair) throw new Error('--keypair <path to a solana keypair json> is required (it is read from the file only, never printed)');
  if (!(values.cluster in CLUSTERS)) throw new Error(`--cluster must be devnet or mainnet-beta`);
  if (values.cluster === 'mainnet-beta' && !(values.rpc && values['i-know-mainnet'])) throw new Error('mainnet needs an explicit --rpc and --i-know-mainnet (docs/spec/web3_solana.md: mainnet waits for the devnet tests)');
  return values;
}

export function makeUmi(values) {
  const secret = Uint8Array.from(JSON.parse(readFileSync(values.keypair, 'utf8')));
  const umi = createUmi(values.rpc ?? CLUSTERS[values.cluster], { commitment: 'confirmed' }).use(mplBubblegum()).use(mplCore());
  const signer = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(secret));
  return umi.use(keypairIdentity(signer));
}

export const sol = (lamports) => (Number(lamports.basisPoints) / 1e9).toFixed(4);
