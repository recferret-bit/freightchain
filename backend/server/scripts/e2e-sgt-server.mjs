// Isolated referral browser bootstrap: fixture RPC responses, real SGT adapter/API/database.
import { createServer } from 'node:http';
import { Keypair, PublicKey } from '@solana/web3.js';
import { AccountLayout, MintLayout, MetadataPointerLayout, ExtensionType, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
const build = process.argv[2], database = process.env.DATABASE_URL;
if (!/^\.e2e-build-\d+$/.test(build ?? '') || process.env.NODE_ENV === 'production' || !database || !['localhost', '127.0.0.1'].includes(new URL(database).hostname) || !/^\/freightchain_e2e_\d+$/.test(new URL(database).pathname)) throw new Error('isolated e2e runner required');
const group = new PublicKey('GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te'), mint = Keypair.generate().publicKey, account = Keypair.generate().publicKey;
let holder = PublicKey.default, mode = 'empty';
const raw = data => ({ owner: TOKEN_2022_PROGRAM_ID.toBase58(), data: [data.toString('base64'), 'base64'], executable: false, lamports: 1 });
const tlv = (kind, bytes) => { const head = Buffer.alloc(4); head.writeUInt16LE(kind); head.writeUInt16LE(bytes.length, 2); return Buffer.concat([head, bytes]); };
const base = Buffer.alloc(166), pointer = Buffer.alloc(64), member = Buffer.alloc(72);
MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: 1n, decimals: 0, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, base); base[165] = 1;
MetadataPointerLayout.encode({ authority: PublicKey.default, metadataAddress: group }, pointer);
mint.toBuffer().copy(member); group.toBuffer().copy(member, 32); member.writeBigUInt64LE(1n, 64);
const mintData = raw(Buffer.concat([base, tlv(ExtensionType.MetadataPointer, pointer), tlv(ExtensionType.TokenGroupMember, member)]));
const tokenData = () => { const data = Buffer.alloc(AccountLayout.span); AccountLayout.encode({ mint, owner: holder, amount: 1n, delegateOption: 0, delegate: PublicKey.default, state: 2, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, data); return raw(data); };
const rpc = createServer(async (req, res) => {
  let text = ''; for await (const chunk of req) text += chunk;
  try {
    const { method, params = [] } = JSON.parse(text);
    let result;
    if (method === 'fixture') { holder = new PublicKey(params[0]); mode = params[1]; result = true; }
    else if (mode === 'outage') { res.writeHead(503); res.end('{}'); return; }
    else if (method === 'getGenesisHash') result = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
    else if (method === 'getTokenAccountsByOwner') result = { context: { slot: 100 }, value: mode === 'held' && params[0] === holder.toBase58() ? [{ pubkey: account.toBase58(), account: tokenData() }] : [] };
    else if (method === 'getMultipleAccounts') result = { context: { slot: 101 }, value: [tokenData(), mintData] };
    else throw new Error('unknown fixture method');
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
  } catch { res.writeHead(400); res.end('{}'); }
});
await new Promise(resolve => rpc.listen(Number(process.env.SGT_FIXTURE_PORT), '127.0.0.1', resolve));
process.env.SGT_RPC_URL = `http://127.0.0.1:${rpc.address().port}`;
await import(new URL(`../${build}/main.js`, import.meta.url));
