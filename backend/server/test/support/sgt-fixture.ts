import { PublicKey, Keypair } from '@solana/web3.js';
import { AccountLayout, MintLayout, MetadataPointerLayout, ExtensionType, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { SGT_GROUP } from '../../src/infrastructure/solana/sgt-ownership.adapter.js';

const tlv = (kind: number, bytes: Buffer): Buffer => { const head = Buffer.alloc(4); head.writeUInt16LE(kind); head.writeUInt16LE(bytes.length, 2); return Buffer.concat([head, bytes]); };
export const raw = (data: Buffer, owner = TOKEN_2022_PROGRAM_ID.toBase58()) => ({ owner, data: [data.toString('base64'), 'base64'], executable: false, lamports: 1, rentEpoch: 0 });
export function sgtFixture(wallet = Keypair.generate().publicKey, mint = Keypair.generate().publicKey) {
  const token = Buffer.alloc(AccountLayout.span), base = Buffer.alloc(166), pointer = Buffer.alloc(64), member = Buffer.alloc(72);
  AccountLayout.encode({ mint, owner: wallet, amount: 1n, delegateOption: 0, delegate: PublicKey.default, state: 2, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, token);
  MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: 1n, decimals: 0, isInitialized: true, freezeAuthorityOption: 1, freezeAuthority: Keypair.generate().publicKey }, base);
  base[165] = 1;
  MetadataPointerLayout.encode({ authority: PublicKey.default, metadataAddress: new PublicKey(SGT_GROUP) }, pointer);
  mint.toBuffer().copy(member); new PublicKey(SGT_GROUP).toBuffer().copy(member, 32); member.writeBigUInt64LE(1n, 64);
  const account = Keypair.generate().publicKey;
  return { wallet, mint, account, token, base, pointer, member,
    tokenData: () => raw(token), mintData: () => raw(Buffer.concat([base, tlv(ExtensionType.MetadataPointer, pointer), tlv(ExtensionType.TokenGroupMember, member)])),
  };
}
export function sgtRpc(f: ReturnType<typeof sgtFixture>, options: { discovery?: unknown; snapshot?: unknown; genesis?: unknown } = {}) {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { method: string };
    const result = request.method === 'getGenesisHash' ? (options.genesis ?? '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
      : request.method === 'getTokenAccountsByOwner' ? (options.discovery ?? { context: { slot: 100 }, value: [{ pubkey: f.account.toBase58(), account: f.tokenData() }] })
        : options.snapshot ?? { context: { slot: 101 }, value: [f.tokenData(), f.mintData()] };
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  });
}
