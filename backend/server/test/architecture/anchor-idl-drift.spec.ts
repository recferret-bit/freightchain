import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { POOL_PROGRAM_IDL } from '../../src/infrastructure/solana/pool-program.idl.js';
import { SERVER_DIR } from './source-files.js';

/* Pins the committed pool IDL (vendored next to it) and the as-built freightchain_honk instructions.
   The plan's seven names are not the program: mint_checkpoint is mint_ride, burn_honk is burn,
   and set_authority / pause are not instructions (SPL set_authority is an inner CPI; pause is pools). */
const ROOT = join(SERVER_DIR, '../..');
const HONK_SRC = join(ROOT, 'backend/programs/freightchain_honk/src');
const POOL_IDL = join(ROOT, 'backend/programs/idl/freightchain_pools.json');

/** sha256("global:<name>")[0..8], Anchor's instruction discriminator. */
const anchorDisc = (name: string): number[] => [...createHash('sha256').update(`global:${name}`).digest().subarray(0, 8)];

const stripDocs = (v: unknown): unknown => (Array.isArray(v) ? v.map(stripDocs) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'docs').map(([k, x]) => [k, stripDocs(x)])) : v);

interface Layout {
  name: string;
  disc: number[];
  accounts: string[];
  args: { name: string; type: string }[];
}

function argType(type: unknown): string {
  return JSON.stringify(type);
}

function poolLayouts(idl: { instructions: { name: string; discriminator: number[]; accounts: { name: string }[]; args: { name: string; type: unknown }[] }[] }): Layout[] {
  return idl.instructions.map((ix) => ({
    name: ix.name,
    disc: ix.discriminator,
    accounts: ix.accounts.map((a) => a.name),
    args: ix.args.map((a) => ({ name: a.name, type: argType(a.type) })),
  }));
}

/** Canonical pin of the committed freightchain_pools instruction layouts (30, not the old 12). */
const POOL_LAYOUT_SHA = 'c84644ebd07b092d6baaa4c002403333e922077612ce51b3af26a49299b234ed';
const POOL_NAMES = [
  'accept_authority', 'buy_ticket', 'cancel_pool', 'close_attestation', 'close_pool', 'close_ride_attestation',
  'close_sponsor_receipt', 'close_ticket', 'commit_winners', 'create_pledge', 'create_pool', 'expire_pool', 'fail_pool',
  'initialize', 'migrate_config_v4', 'open_next_pool', 'pay_prize', 'propose_authority', 'record_ride_attestation', 'refund',
  'refund_pledge', 'refund_sponsor', 'seal_road', 'set_config', 'set_payout_authority', 'set_pool_rules', 'set_series',
  'settle_pledge', 'sponsor', 'veto_winners',
];

interface HonkPin {
  name: string;
  /** plan alias, when the issue used a name the program does not have */
  alias?: string;
  args: string[];
  accounts: string[];
  /** honk-program.mjs encodes this instruction (the chain adapter only decodes burn and buy_part) */
  encoded: boolean;
  /** export name in scripts/honk-program.mjs */
  fn?: string;
}

const HONK: HonkPin[] = [
  { name: 'initialize', args: ['sol_in:u64', 'emitter:pubkey', 'treasury:pubkey', 'team_recipient:pubkey', 'team_enabled:bool', 'team_linear_months:u8'],
    accounts: ['payer', 'program', 'program_data', 'config', 'honk_mint', 'authority', 'vault', 'pool', 'lp_mint', 'lp_locker', 'locker', 'emission_vault', 'airdrop_vault', 'referral_vault', 'treasury_vault', 'team_vault', 'token_program', 'system_program'], encoded: true },
  { name: 'swap_sol_for_honk', fn: 'swapSolForHonk', args: ['sol_in:u64', 'min_out:u64'],
    accounts: ['user', 'pool', 'honk_mint', 'vault', 'user_honk', 'token_program', 'system_program', 'associated_token_program'], encoded: true },
  { name: 'swap_honk_for_sol', fn: 'swapHonkForSol', args: ['honk_in:u64', 'min_sol_out:u64'],
    accounts: ['user', 'pool', 'honk_mint', 'vault', 'user_honk', 'token_program'], encoded: true },
  { name: 'burn', alias: 'burn_honk', args: ['amount:u64'],
    accounts: ['user', 'honk_mint', 'user_honk', 'token_program'], encoded: true },
  { name: 'mint_ride', alias: 'mint_checkpoint', fn: 'mintRide', args: ['ride_id:[u8;16]', 'tier:u8', 'bands:u8', 'day_index:i64', 'expected_amount:option<u64>'],
    accounts: ['emitter', 'config', 'honk_mint', 'authority', 'emission_vault', 'rider', 'rider_honk', 'ride_mint', 'wallet_day', 'token_program', 'system_program', 'associated_token_program'], encoded: true },
  { name: 'pay_referral', fn: 'referralPaymentTransaction', args: ['reward_id:[u8;16]', 'base_amount:u64', 'month_index:i64'],
    accounts: ['emitter', 'config', 'honk_mint', 'authority', 'referral_vault', 'recipient', 'recipient_honk', 'referral_mint', 'wallet_month', 'token_program', 'system_program', 'associated_token_program'], encoded: true },
  { name: 'burn_referral_tail', args: [],
    accounts: ['payer', 'config', 'honk_mint', 'authority', 'referral_vault', 'token_program'], encoded: false },
  { name: 'set_airdrop_root', args: ['campaign:u8', 'root:[u8;32]', 'allocation:u64'],
    accounts: ['emitter', 'config', 'airdrop_campaign', 'system_program'], encoded: false },
  { name: 'claim_airdrop', args: ['campaign:u8', 'amount:u64', 'proof:vec<[u8;32]>'],
    accounts: ['payer', 'config', 'airdrop_campaign', 'honk_mint', 'authority', 'airdrop_vault', 'wallet', 'wallet_honk', 'receipt', 'wallet_airdrop', 'token_program', 'associated_token_program', 'system_program'], encoded: false },
  { name: 'burn_unclaimed', args: ['campaign:u8'],
    accounts: ['payer', 'config', 'airdrop_campaign', 'honk_mint', 'authority', 'airdrop_vault', 'token_program'], encoded: false },
  { name: 'buy_part', fn: 'buyPart', args: ['slot:[u8;16]', 'item:[u8;16]'],
    accounts: ['buyer', 'honk_mint', 'buyer_honk', 'authority', 'nft_mint', 'nft_ata', 'part', 'token_program', 'system_program', 'associated_token_program'], encoded: true },
  { name: 'claim_treasury', args: [],
    accounts: ['payer', 'config', 'honk_mint', 'authority', 'treasury_vault', 'treasury', 'treasury_honk', 'token_program', 'associated_token_program', 'system_program'], encoded: false },
  { name: 'claim_team', args: [],
    accounts: ['payer', 'config', 'honk_mint', 'authority', 'team_vault', 'team_recipient', 'team_honk', 'token_program', 'associated_token_program', 'system_program'], encoded: false },
];

const RUST_TYPE: Record<string, string> = {
  u64: 'u64', u32: 'u32', u16: 'u16', u8: 'u8', i64: 'i64', bool: 'bool', Pubkey: 'pubkey',
};

function borshOf(rust: string): string {
  const array = rust.match(/^\[u8;\s*(\d+)\]$/);
  if (array) return `[u8;${array[1]}]`;
  if (rust === 'Option<u64>') return 'option<u64>';
  if (rust === 'Vec<[u8; 32]>') return 'vec<[u8;32]>';
  const mapped = RUST_TYPE[rust];
  if (!mapped) throw new Error(`unpinned rust type ${rust}`);
  return mapped;
}

function rustPrograms(): { name: string; args: string[]; accounts: string[] }[] {
  const lib = readFileSync(join(HONK_SRC, 'lib.rs'), 'utf8');
  const structs = new Map<string, string[]>();
  for (const file of ['initialize.rs', 'swap.rs', 'burn.rs', 'mint_ride.rs', 'referral.rs', 'airdrop.rs', 'buy_part.rs', 'claim.rs']) {
    const src = readFileSync(join(HONK_SRC, 'instructions', file), 'utf8');
    for (const m of src.matchAll(/pub struct (\w+)<'info> \{([\s\S]*?)\n\}/g)) {
      structs.set(m[1]!, [...m[2]!.matchAll(/\n\s*pub (\w+):/g)].map((a) => a[1]!));
    }
  }
  const out: { name: string; args: string[]; accounts: string[] }[] = [];
  for (const m of lib.matchAll(/pub fn (\w+)\(([\s\S]*?)\) -> Result/g)) {
    const ctx = m[2]!.match(/Context<(\w+)>/);
    if (!ctx) throw new Error(`no context on ${m[1]}`);
    const args = [...m[2]!.matchAll(/(\w+)\s*:\s*(\[[^\]]+\]|(?:Vec|Option)<[^>]+>|[A-Za-z0-9_]+)/g)]
      .filter((a) => a[1] !== 'ctx')
      .map((a) => `${a[1]}:${borshOf(a[2]!.replace(/\s+/g, ' ').trim())}`);
    const accounts = structs.get(ctx[1]!);
    if (!accounts) throw new Error(`no accounts for ${ctx[1]}`);
    out.push({ name: m[1]!, args, accounts });
  }
  return out;
}

function encoderKeyCount(src: string, name: string): number | null {
  const at = src.indexOf(`function ${name}(`);
  if (at < 0) return null;
  const keys = src.slice(at).match(/const keys = \[([\s\S]*?)\];/);
  if (!keys) return null;
  return keys[1]!.match(/\b(?:w|ro)\(/g)?.length ?? 0;
}

describe('freightchain_pools IDL drift', () => {
  const committed = JSON.parse(readFileSync(POOL_IDL, 'utf8')) as { instructions: Layout & { discriminator: number[]; accounts: { name: string }[]; args: { name: string; type: unknown }[] }[] };

  it('the vendored IDL is the committed file without doc comments', () => {
    expect(POOL_PROGRAM_IDL).toEqual(stripDocs(committed));
  });

  it('pins every instruction discriminator, account order and Borsh args', () => {
    const layouts = poolLayouts(committed as never);
    expect(layouts.map((l) => l.name)).toEqual(POOL_NAMES);
    for (const ix of layouts) expect(ix.disc, ix.name).toEqual(anchorDisc(ix.name));
    const blob = JSON.stringify(layouts);
    expect(createHash('sha256').update(blob).digest('hex')).toBe(POOL_LAYOUT_SHA);
  });
});

describe('freightchain_honk IDL drift', () => {
  const rust = rustPrograms();

  it('pins initialize, swap_sol_for_honk, buy_part, mint_ride (not mint_checkpoint), burn (not burn_honk); set_authority and pause are not instructions', () => {
    expect(rust.map((r) => r.name)).toEqual(HONK.map((h) => h.name));
    expect(rust.map((r) => r.name)).not.toContain('mint_checkpoint');
    expect(rust.map((r) => r.name)).not.toContain('burn_honk');
    expect(rust.map((r) => r.name)).not.toContain('set_authority');
    expect(rust.map((r) => r.name)).not.toContain('pause');
    for (const pin of HONK) {
      const got = rust.find((r) => r.name === pin.name)!;
      expect(got.args, pin.name).toEqual(pin.args);
      expect(got.accounts, pin.name).toEqual(pin.accounts);
      expect(anchorDisc(pin.name), pin.name).toEqual([...createHash('sha256').update(`global:${pin.name}`).digest().subarray(0, 8)]);
    }
  });

  it('the server encoder account order matches the program for the instructions it builds', () => {
    const encoder = readFileSync(join(SERVER_DIR, 'scripts/honk-program.mjs'), 'utf8');
    const adapter = readFileSync(join(SERVER_DIR, 'src/infrastructure/solana/honk-chain.adapter.ts'), 'utf8');
    for (const pin of HONK.filter((h) => h.encoded)) {
      expect(encoderKeyCount(encoder, pin.fn ?? pin.name), pin.name).toBe(pin.accounts.length);
      expect(encoder.includes(`ix('${pin.name}'`), pin.name).toBe(true);
    }
    expect(adapter.includes("disc('burn')")).toBe(true);
    expect(adapter.includes("disc('buy_part')")).toBe(true);
    expect(anchorDisc('burn')).toEqual([...createHash('sha256').update('global:burn').digest().subarray(0, 8)]);
    expect(anchorDisc('buy_part')).toEqual([...createHash('sha256').update('global:buy_part').digest().subarray(0, 8)]);
  });
});
