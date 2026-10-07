import { Controller, Get, Query } from '@nestjs/common';
import { PoolService } from './pool.service.js';
import { PriceService } from '../solana/price.service.js';
import { TIERS, config } from '../config.js';
import { lamportsFor } from '../economy.js';

/* Public (no session): everything the landing page and the lobby show before / without a wallet. */
@Controller('api')
export class PublicController {
  constructor(private readonly pool: PoolService, private readonly price: PriceService) {}

  private async quote() { try { return await this.price.solUsd(); } catch { return null; } }

  @Get('tiers')
  async tiers() {
    const q = await this.quote(), paid = !!config.treasury;
    return {
      solUsd: q?.usd ?? null, treasury: config.treasury || null,
      tiers: Object.entries(TIERS).map(([id, t]) => ({
        id, usd: t.usd, seconds: t.seconds, lamports: t.usd > 0 && q ? lamportsFor(t.usd, q.usd) : null,
        available: t.usd === 0 || (paid && !!q),
      })),
    };
  }

  /** The current prize pool. Lamports are the truth; usd is "≈ at the current price". */
  @Get('pool')
  async poolInfo() {
    const q = await this.quote(), s = this.pool.summary(), usd = (l: number) => (q ? Math.round((l / 1e9) * q.usd * 100) / 100 : null);
    return { ...s, solUsd: q?.usd ?? null, usd: { grand: usd(s.split.grand), top20: usd(s.split.top20), nextSeed: usd(s.split.nextSeed), fees: usd(s.split.fees), entries: usd(s.split.entries) } };
  }

  @Get('leaderboard')
  leaderboard(@Query('board') board?: string) { return { board: board === 'free' ? 'free' : 'round', rows: this.pool.leaderboard(board ?? 'round') }; }
}
