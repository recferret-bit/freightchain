import { ConvoyService } from '../../src/application/referral/convoy.service.js';
import { MemoryConvoyRepository } from '../../src/infrastructure/social/memory-convoy.repository.js';
import { MemoryAirdropRepository } from '../../src/infrastructure/social/memory-airdrop.repository.js';
import { StubNameServiceAdapter } from './stub-name-service.js';
import { ReferralService } from '../../src/application/services/referral.service.js';
import { MemoryReferralRepository } from './in-memory/memory-referral-repository.js';
import { MemoryPromoRepository } from './in-memory/memory-ledger-repositories.js';
import { unitContext } from './unit-context.js';

export function convoyContext() {
  const ctx = unitContext(), repo = new MemoryConvoyRepository(), campaign = new MemoryAirdropRepository();
  repo.columnPresent = true;
  const legacy = new MemoryReferralRepository(ctx.db);
  const convoy = new ConvoyService(repo, ctx.players, ctx.transactions, ctx.clock, new StubNameServiceAdapter(), new MemoryPromoRepository(ctx.db), campaign, ctx.settings, legacy, ctx.cosmetics);
  const referral = new ReferralService(legacy, ctx.players, ctx.transactions, ctx.clock, ctx.entropy, convoy);
  return { ...ctx, repo, campaign, legacy, convoy, referral };
}
