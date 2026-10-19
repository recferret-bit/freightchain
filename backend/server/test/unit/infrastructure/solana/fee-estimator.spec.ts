import { FeeEstimator, estimateFeeLamports, percentileOf, type PriorityFeeRpc, type QnPriorityFees } from '../../../../src/infrastructure/solana/fee-estimator.js';

/* Real answer shapes: getRecentPrioritizationFees (an array of { slot, prioritizationFee } – the adapter hands over the fees) and QuickNode's
   qn_estimatePriorityFees api_version 2 (per_compute_unit levels, optional percentiles). */
const RECENT = [0, 0, 0, 1_000, 2_000, 5_000, 8_000, 12_000, 40_000, 90_000]; // 10 slots
const QN: QnPriorityFees = { per_compute_unit: { extreme: 1_686_993, high: 260_140, medium: 50_000, low: 10_714 } };

function rpc(over: Partial<PriorityFeeRpc> = {}) {
  const calls = { qn: 0, recent: [] as string[][] };
  const r: PriorityFeeRpc = {
    qnEstimate: over.qnEstimate ?? (async () => { calls.qn++; return 'unsupported'; }),
    recentFees: async (accounts) => { calls.recent.push(accounts); return over.recentFees ? over.recentFees(accounts) : RECENT; },
  };
  return { r, calls };
}
const cfg = { percentile: 75, minMicrolamports: 0, maxMicrolamports: 50_000 };

describe('percentileOf / estimateFeeLamports', () => {
  it('nearest rank, zeros included, empty = 0', () => {
    expect(percentileOf(RECENT, 75)).toBe(12_000);
    expect(percentileOf(RECENT, 50)).toBe(2_000);
    expect(percentileOf(RECENT, 99)).toBe(90_000);
    expect(percentileOf(RECENT, 1)).toBe(0);
    expect(percentileOf([], 75)).toBe(0);
    expect(percentileOf([7], 75)).toBe(7);
  });

  it('5 000 lamports per signature + the CU price on the whole limit, rounded up', () => {
    expect(estimateFeeLamports(1, 0, 30_000)).toBe(5_000);
    expect(estimateFeeLamports(2, 12_000, 30_000)).toBe(10_360);
    expect(estimateFeeLamports(1, 1, 1)).toBe(5_001);
  });
});

describe('FeeEstimator', () => {
  let t = 0;
  const now = () => t;
  beforeEach(() => { t = 1_000_000; });

  it('falls back to getRecentPrioritizationFees over the hot accounts when QuickNode is not there – and stops asking', async () => {
    const { r, calls } = rpc();
    const est = new FeeEstimator(r, cfg, now);
    expect(await est.priorityMicrolamports(['pool', 'vault'])).toBe(12_000);
    expect(calls.recent).toEqual([['pool', 'vault']]);
    t += 60_000;
    await est.priorityMicrolamports(['pool', 'vault']);
    expect(calls.qn).toBe(1); // remembered as unsupported
  });

  it('uses QuickNode when available: explicit percentile, else the level for it', async () => {
    const { r, calls } = rpc({ qnEstimate: async () => QN });
    expect(await new FeeEstimator(r, { ...cfg, maxMicrolamports: 10_000_000 }, now).priorityMicrolamports(['pool'])).toBe(260_140); // p75 = high
    expect(await new FeeEstimator(r, { ...cfg, percentile: 50, maxMicrolamports: 10_000_000 }, now).priorityMicrolamports(['pool'])).toBe(50_000);
    expect(await new FeeEstimator(r, { ...cfg, percentile: 95, maxMicrolamports: 10_000_000 }, now).priorityMicrolamports(['pool'])).toBe(1_686_993);
    expect(await new FeeEstimator(r, { ...cfg, percentile: 10, maxMicrolamports: 10_000_000 }, now).priorityMicrolamports(['pool'])).toBe(10_714);
    const withPct = rpc({ qnEstimate: async () => ({ per_compute_unit: { ...QN.per_compute_unit, percentiles: { '75': 33_333 } } }) });
    expect(await new FeeEstimator(withPct.r, cfg, now).priorityMicrolamports(['pool'])).toBe(33_333);
    expect(calls.recent).toEqual([]);
  });

  it('a QuickNode hiccup (or an empty answer) falls back for that call', async () => {
    const down = rpc({ qnEstimate: async () => { throw new Error('502'); } });
    expect(await new FeeEstimator(down.r, cfg, now).priorityMicrolamports(['pool'])).toBe(12_000);
    const empty = rpc({ qnEstimate: async () => ({}) });
    expect(await new FeeEstimator(empty.r, cfg, now).priorityMicrolamports(['pool'])).toBe(12_000);
  });

  it('clamps to [min, max]: the mainnet floor, the ceiling, the devnet floor 0', async () => {
    const quiet = rpc({ recentFees: async () => [0, 0, 0] });
    expect(await new FeeEstimator(quiet.r, { ...cfg, minMicrolamports: 1_000 }, now).priorityMicrolamports(['p'])).toBe(1_000);
    expect(await new FeeEstimator(quiet.r, cfg, now).priorityMicrolamports(['p'])).toBe(0);
    const hot = rpc({ recentFees: async () => [9_999_999] });
    expect(await new FeeEstimator(hot.r, cfg, now).priorityMicrolamports(['p'])).toBe(50_000);
  });

  it('caches a quote for 10 s per account set (a public route must not hammer the RPC)', async () => {
    const { r, calls } = rpc();
    const est = new FeeEstimator(r, cfg, now);
    await est.priorityMicrolamports(['a']);
    await est.priorityMicrolamports(['a']);
    await est.priorityMicrolamports(['b']);
    expect(calls.recent.length).toBe(2);
    t += 10_000;
    await est.priorityMicrolamports(['a']);
    expect(calls.recent.length).toBe(3);
  });

  it('an RPC failure propagates (the adapter turns it into 503)', async () => {
    const { r } = rpc({ recentFees: async () => { throw new Error('down'); } });
    await expect(new FeeEstimator(r, cfg, now).priorityMicrolamports(['a'])).rejects.toThrow('down');
  });
});
