// Program v4 (audit L4) for the localnet scripts: a new pool's road is sealed by `seal_road` from the hash of a slot SEAL_DELAY_SLOTS (8, ~3 s) after it
// opened; until then the server serves no ride on it (409 road_not_sealed). The server's crank does this on its schedule – the money / payout / chaos scenarios
// run the crank by hand, so they seal each pool they create themselves, right after it (before pool:register, so the mirror reads a sealed account).
//   import { sealRoad } from './localnet-seal.mjs';  await sealRoad({ conn, codec, admintool, id, keyfile })   → the seal-road JSON, or null (sealed already)
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** waits until the chain is past the pool's seal_slot (SlotHashes then holds an entry at or after it), then sends seal_road; retried while TooEarly */
export async function sealRoad({ conn, codec, admintool, id, keyfile, timeoutMs = 30_000 }) {
  const t0 = Date.now();
  for (;;) {
    const info = await conn.getAccountInfo(codec.poolPda(id), 'confirmed');
    const p = info ? codec.decodeAccount('Pool', info.data) : null;
    if (!p) throw new Error(`seal: no pool ${id}`);
    const target = Number(p.sealSlot ?? 0);
    if (!target) return null;
    while ((await conn.getSlot('confirmed')) <= target + 1) await sleep(300);
    try { return admintool(['seal-road', '--pool', String(id), '-k', keyfile]); } catch (e) {
      if (!/TooEarly|0x177a|"Custom":6010/.test(String(e.stderr ?? e)) || Date.now() - t0 > timeoutMs) throw e;
      await sleep(800);
    }
  }
}
