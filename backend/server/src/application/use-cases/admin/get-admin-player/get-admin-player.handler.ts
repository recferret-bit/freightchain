import { TrustEvidenceService } from '../../../services/trust-evidence.service.js';
import { Optional } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { AdminPlayerDetailDto } from '../../../../domain/admin/admin.dto.js';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { toStatsDto } from '../../../../domain/stats/stats.js';
import { AdminActionRepositoryPort } from '../../../ports/admin/admin-action.repository.port.js';
import { AdminQueryPort } from '../../../ports/admin/admin-query.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { SignInRepositoryPort } from '../../../ports/auth/sign-in.repository.port.js';
import { PaymentRepositoryPort } from '../../../ports/economy/payment.repository.port.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { RideTicketRepositoryPort } from '../../../ports/players/ride-ticket.repository.port.js';
import { StatsRepositoryPort } from '../../../ports/stats/stats.repository.port.js';
import { toAdminRideRow } from '../admin-ride-row.js';
import { GetAdminPlayerQuery } from './get-admin-player.query.js';

const RECENT = 10;

/** One rider on one screen: balances, statistics, tickets and their ledger, what they paid, the latest sign-ins and rides. 404 for a wallet that never signed in. */
@QueryHandler(GetAdminPlayerQuery)
export class GetAdminPlayerHandler implements IQueryHandler<GetAdminPlayerQuery, AdminPlayerDetailDto> {
  constructor(
    private readonly players: PlayerRepositoryPort,
    private readonly stats: StatsRepositoryPort,
    private readonly tickets: RideTicketRepositoryPort,
    private readonly payments: PaymentRepositoryPort,
    private readonly signIns: SignInRepositoryPort,
    private readonly admin: AdminQueryPort,
    @Optional() private readonly audit?: AdminActionRepositoryPort,
    @Optional() private readonly clock?: ClockPort,
    @Optional() private readonly evidence?: TrustEvidenceService,
  ) {}

  async execute({ wallet, actor }: GetAdminPlayerQuery): Promise<AdminPlayerDetailDto> {
    const player = await this.players.findByWallet(wallet);
    if (!player) throw new NotFoundError('this wallet has never signed in');
    const [stats, tickets, grants, payments, signIns, rides] = await Promise.all([
      this.stats.findPlayer(wallet), this.tickets.listByWallet(wallet), this.tickets.recentGrants(wallet, RECENT), this.payments.totalsOf(wallet),
      this.signIns.recent(RECENT, wallet), this.admin.rides({ wallet, limit: RECENT }),
    ]);
    if (actor && this.audit && this.clock) {
      await this.audit.insert({
        wallet: actor, action: 'read.player', target: wallet, role: 'admin', requestId: null, at: this.clock.now(),
        beforeState: null, afterState: { wallet }, detail: {},
      });
    }
    return {
      ...(this.evidence ? { fundingEvidence: await this.evidence.fundingOf(wallet) } : {}),
      player: { wallet, freeRides: player.freeRides, freeRidesMax: player.freeRidesMax, freeDay: player.freeDay, createdAt: player.createdAt.getTime(), tutorialPassedAt: player.tutorialPassedAt?.getTime() ?? null, age18At: player.age18At?.getTime() ?? null, lossAt: player.lossAt?.getTime() ?? null },
      stats: stats ? toStatsDto(stats.totals) : null,
      tickets: tickets.map((t) => ({ poolId: t.poolId, balance: t.balance, bought: t.bought })),
      grants: grants.map((g) => ({ poolId: g.poolId, delta: g.delta, source: g.source, ref: g.ref, at: g.at.getTime() })),
      payments,
      signIns: signIns.map((s) => ({ wallet: s.wallet, at: s.at.getTime(), ipHash: s.ipHash, ...(s.network ? { network: s.network } : {}) })),
      rides: rides.map(toAdminRideRow),
    };
  }
}
