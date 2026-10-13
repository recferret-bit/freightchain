import { Logger } from '@nestjs/common';

/* The compute-unit price for a transaction (docs/agents/escrow.md "Priority fees"): the fee market is per HOT ACCOUNT (every buyer writes the Pool and its
   vault), so the price is a percentile of what recently landed while writing those accounts, clamped to [PRIORITY_FEE_MIN, PRIORITY_FEE_MAX]:
     1. QuickNode's `qn_estimatePriorityFees` (over the last 100 blocks, for the hottest account) when the endpoint offers it – remembered as unsupported otherwise;
     2. the standard `getRecentPrioritizationFees(hot accounts)` (the last ~150 slots): the percentile over every sample, zeros included (a quiet account is cheap).
   The floor is 0 on devnet and ~1 000 µL/CU on mainnet (env). Quotes are cached briefly per account set so a public route cannot hammer the RPC. */

export interface PriorityFeeConfig { percentile: number; minMicrolamports: number; maxMicrolamports: number }

/** QuickNode's answer (api_version 2): per-compute-unit levels and, on newer endpoints, explicit percentiles. */
export interface QnPriorityFees { per_compute_unit?: { extreme?: number; high?: number; medium?: number; low?: number; percentiles?: Record<string, number> } }

export interface PriorityFeeRpc {
  /** 'unsupported' = the endpoint does not know the method; throws on any other failure */
  qnEstimate(account: string): Promise<QnPriorityFees | 'unsupported'>;
  /** the prioritization fees (µL/CU) of recent slots for transactions that wrote all of `accounts` */
  recentFees(accounts: string[]): Promise<number[]>;
}

export const BASE_FEE_LAMPORTS_PER_SIGNATURE = 5_000;

/** Nearest-rank percentile (p in 1..99) of the samples; 0 for none. */
export function percentileOf(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

/** What the network will charge: 5 000 lamports per signature + the CU price on the whole CU limit (rounded up). */
export const estimateFeeLamports = (signatures: number, microlamportsPerCu: number, computeUnits: number): number =>
  signatures * BASE_FEE_LAMPORTS_PER_SIGNATURE + Math.ceil((microlamportsPerCu * computeUnits) / 1_000_000);

/** QuickNode level for a percentile (its low / medium / high / extreme are the 25th / 50th / 75th / 95th). */
function fromQuickNode(q: QnPriorityFees, p: number): number | null {
  const pcu = q.per_compute_unit;
  if (!pcu) return null;
  const exact = pcu.percentiles?.[String(p)];
  if (typeof exact === 'number') return exact;
  const level = p >= 95 ? pcu.extreme : p >= 75 ? pcu.high : p >= 50 ? pcu.medium : pcu.low;
  return typeof level === 'number' && Number.isFinite(level) ? level : null;
}

export class FeeEstimator {
  private readonly logger = new Logger(FeeEstimator.name);
  private quickNode: 'unknown' | 'supported' | 'unsupported' = 'unknown';
  private readonly cache = new Map<string, { at: number; value: number }>();

  constructor(
    private readonly rpc: PriorityFeeRpc,
    private readonly cfg: PriorityFeeConfig,
    private readonly now: () => number,
    private readonly ttlMs = 10_000,
  ) {}

  /** µL per compute unit for a transaction writing `hotAccounts` (most contended first). RPC failures propagate (the caller maps them to 503). */
  async priorityMicrolamports(hotAccounts: readonly string[]): Promise<number> {
    const key = hotAccounts.join(',');
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value;
    const value = this.clamp(await this.raw(hotAccounts));
    this.cache.set(key, { at: this.now(), value });
    return value;
  }

  private async raw(hotAccounts: readonly string[]): Promise<number> {
    if (this.quickNode !== 'unsupported' && hotAccounts.length > 0) {
      try {
        const q = await this.rpc.qnEstimate(hotAccounts[0]!);
        if (q === 'unsupported') {
          this.quickNode = 'unsupported';
        } else {
          this.quickNode = 'supported';
          const v = fromQuickNode(q, this.cfg.percentile);
          if (v !== null) return v;
        }
      } catch (e) {
        this.logger.debug(`qn_estimatePriorityFees failed, using getRecentPrioritizationFees: ${(e as Error).message}`);
      }
    }
    return percentileOf(await this.rpc.recentFees([...hotAccounts]), this.cfg.percentile);
  }

  private clamp(v: number): number {
    return Math.min(this.cfg.maxMicrolamports, Math.max(this.cfg.minMicrolamports, Math.round(v)));
  }
}
