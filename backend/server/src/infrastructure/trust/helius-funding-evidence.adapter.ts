import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { FundingEvidencePort } from '../../application/ports/trust/funding-evidence.port.js';
import { emptyFundingEvidence, type FundingEvidence } from '../../domain/trust/evidence.js';
import { isWalletAddress } from '../../domain/players/wallet-address.js';
import { EnvService } from '../config/env.service.js';
import { evidenceJson } from './evidence-fetch.js';
const wallet = z.string().refine(isWalletAddress), signature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/), raw = z.string().regex(/^\d{1,30}$/), timestamp = z.number().int().nonnegative().max(8_640_000_000_000);
const funding = z.object({ funder: wallet, funderType: z.string().max(80).nullable(), amountRaw: raw, signature, slot: z.number().int().nonnegative().safe(), timestamp });
const transfers = z.object({ data: z.array(z.object({ counterparty: wallet, direction: z.enum(['in', 'out']), mint: wallet, amountRaw: raw, signature, timestamp })).max(100), pagination: z.object({ hasMore: z.boolean(), nextCursor: z.string().max(300).nullable().optional() }) });

@Injectable()
export class HeliusFundingEvidenceAdapter extends FundingEvidencePort {
  constructor(private readonly env: EnvService) { super(); }
  async lookup(address: string): Promise<FundingEvidence> {
    if (!this.env.heliusApiKey) return emptyFundingEvidence('unconfigured');
    if (!isWalletAddress(address)) return emptyFundingEvidence('invalid_input');
    const base = `https://api.helius.xyz/v1/wallet/${address}`, headers = { 'X-Api-Key': this.env.heliusApiKey };
    try {
      const response = await evidenceJson(`${base}/funded-by`, headers);
      if (response.status === 404) return await this.fallback(base, headers);
      const parsed = funding.safeParse(response.data);
      if (response.status !== 200 || !parsed.success) return emptyFundingEvidence('unavailable');
      const r = parsed.data;
      return { ...emptyFundingEvidence('observed'), funder: { wallet: r.funder, type: r.funderType, amountRaw: r.amountRaw, signature: r.signature, slot: r.slot, at: r.timestamp * 1000 }, complete: true, excluded: r.funderType === 'exchange' ? 'exchange' : null };
    } catch { return emptyFundingEvidence('unavailable'); }
  }
  private async fallback(base: string, headers: Record<string, string>): Promise<FundingEvidence> {
    // One page only: this is observed transfer evidence, never a fabricated first funder or a complete transfer graph.
    const response = await evidenceJson(`${base}/transfers?limit=100`, headers);
    const parsed = transfers.safeParse(response.data);
    if (response.status !== 200 || !parsed.success) return emptyFundingEvidence('unavailable');
    const r = parsed.data;
    return { ...emptyFundingEvidence(r.pagination.hasMore ? 'incomplete' : r.data.length ? 'observed' : 'not_found'), transfers: r.data.map(t => ({ counterparty: t.counterparty, direction: t.direction, mint: t.mint, amountRaw: t.amountRaw, signature: t.signature, at: t.timestamp * 1000 })), complete: !r.pagination.hasMore };
  }
}
