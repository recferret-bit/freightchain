import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { ANON_ID_PATTERN, allowClientProperties, isClientEvent } from '../../../../domain/analytics/client-events.js';
import { SERVER_EVENT_SET } from '../../../../domain/analytics/server-events.js';
import { AnalyticsPort, type AnalyticsEvent } from '../../../ports/analytics/analytics.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { emitAnalytics } from '../../../services/analytics-emit.js';
import { RecordTelemetryCommand, type TelemetryAckDto } from './record-telemetry.command.js';

const ANON_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Forwards an allowlisted client batch. Server event names are dropped (HTTP 200).
 * `$create_alias` is emitted only for `session_restored` when the cookie wallet, a v4 `anon_id`, and `request_alias: true` all hold.
 */
@CommandHandler(RecordTelemetryCommand)
export class RecordTelemetryHandler implements ICommandHandler<RecordTelemetryCommand, TelemetryAckDto> {
  constructor(
    private readonly analytics: AnalyticsPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ wallet, anonId, events }: RecordTelemetryCommand): Promise<TelemetryAckDto> {
    const enabled = this.analytics.enabled();
    if (!enabled) return { enabled: false, accepted: 0, dropped: 0 };
    if (events.length === 0) return { enabled: true, accepted: 0, dropped: 0 };
    const anon = anonId && ANON_ID_PATTERN.test(anonId) ? anonId : null;
    const distinct = wallet ?? anon;
    const now = this.clock.now();
    let accepted = 0;
    let dropped = 0;
    for (const raw of events) {
      if (!distinct || !isClientEvent(raw.event) || SERVER_EVENT_SET.has(raw.event)) { dropped++; continue; }
      const props = allowClientProperties(raw.event, raw.properties);
      if (!props) { dropped++; continue; }
      const eventName = raw.event;
      emitAnalytics(this.analytics, () => ({
        event: eventName, distinctId: distinct, uuid: null, dedupeKey: null, timestamp: now, properties: { ...props, source: 'client' },
      }));
      accepted++;
      if (eventName === 'session_restored' && wallet && anon && props['request_alias'] === true && ANON_V4.test(anon.slice('anon_'.length))) {
        const aliasDistinct = anon;
        const aliasWallet = wallet;
        emitAnalytics(this.analytics, (): AnalyticsEvent => ({
          event: '$create_alias', distinctId: aliasDistinct, uuid: null, dedupeKey: null, timestamp: now, properties: { alias: aliasWallet, source: 'server' },
        }));
      }
    }
    return { enabled, accepted, dropped };
  }
}
