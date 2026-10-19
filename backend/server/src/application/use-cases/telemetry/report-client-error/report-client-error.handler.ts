import { Logger } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { ANON_ID_PATTERN } from '../../../../domain/analytics/client-events.js';
import { CLIENT_ERROR_DAY_LIMIT, CLIENT_ERROR_IP_LIMIT, CLIENT_ERROR_IP_WINDOW_MS, prepareClientError } from '../../../../domain/analytics/client-error.js';
import { clientCrashed } from '../../../services/analytics-events.js';
import { AnalyticsPort } from '../../../ports/analytics/analytics.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { ReportClientErrorCommand, type ClientErrorAckDto } from './report-client-error.command.js';

interface IpWindow { start: number; count: number }

/**
 * Forwards one unhandled browser crash as `$exception` and one `client_crashed`. Noise is dropped.
 * Ten per IP per minute, 2_000 per UTC day. Over the cap the answer is still 200 with accepted 0, so the browser does not retry.
 */
@CommandHandler(ReportClientErrorCommand)
export class ReportClientErrorHandler implements ICommandHandler<ReportClientErrorCommand, ClientErrorAckDto> {
  private readonly log = new Logger(ReportClientErrorHandler.name);
  private readonly ips = new Map<string, IpWindow>();
  private dayKey = '';
  private dayCount = 0;
  private dayWarned = false;
  private ipWarnedAt = 0;

  constructor(
    private readonly analytics: AnalyticsPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ wallet, ip, anonId, report }: ReportClientErrorCommand): Promise<ClientErrorAckDto> {
    let enabled = false;
    try { enabled = this.analytics.enabled(); } catch { return { enabled: false, accepted: 0 }; }
    if (!enabled) return { enabled: false, accepted: 0 };
    const now = this.clock.now();
    if (!this.ipAllows(ip || 'unknown', now.getTime())) {
      this.noteIp(now.getTime());
      return { enabled: true, accepted: 0 };
    }
    const prepared = prepareClientError(report);
    const signedIn = wallet && wallet.trim() ? wallet.trim() : null; // a blank cookie must not become the distinct id
    const distinct = signedIn || (anonId && ANON_ID_PATTERN.test(anonId) ? anonId : null);
    if (!prepared || !distinct) return { enabled: true, accepted: 0 };
    if (!this.dayAllows(now)) {
      this.noteDay();
      return { enabled: true, accepted: 0 };
    }
    const site = prepared.frames.at(-1);
    try {
      this.analytics.captureException({
        distinctId: distinct, timestamp: now, surface: prepared.surface, release: prepared.release,
        type: prepared.type, value: prepared.value, frames: prepared.frames,
      });
      this.analytics.capture(clientCrashed({
        distinctId: distinct, now, surface: prepared.surface, error: prepared.type,
        inApp: site ? site.inApp : null, release: prepared.release,
      }));
    } catch {
      this.dayCount = Math.max(0, this.dayCount - 1); // the client will not retry; do not spend the day's budget on a report that never queued
    }
    return { enabled: true, accepted: 1 };
  }

  private ipAllows(ip: string, nowMs: number): boolean {
    for (const [key, row] of this.ips) {
      if (nowMs - row.start < CLIENT_ERROR_IP_WINDOW_MS) break;
      this.ips.delete(key);
    }
    const row = this.ips.get(ip);
    if (!row || nowMs - row.start >= CLIENT_ERROR_IP_WINDOW_MS) {
      this.ips.delete(ip);
      if (this.ips.size >= 10_000) this.ips.delete(this.ips.keys().next().value as string);
      this.ips.set(ip, { start: nowMs, count: 1 });
      return true;
    }
    if (row.count >= CLIENT_ERROR_IP_LIMIT) return false;
    row.count += 1;
    return true;
  }

  private dayAllows(now: Date): boolean {
    const key = now.toISOString().slice(0, 10);
    if (key !== this.dayKey) { this.dayKey = key; this.dayCount = 0; this.dayWarned = false; }
    if (this.dayCount >= CLIENT_ERROR_DAY_LIMIT) return false;
    this.dayCount += 1;
    return true;
  }

  private noteIp(nowMs: number): void {
    if (nowMs - this.ipWarnedAt < CLIENT_ERROR_IP_WINDOW_MS) return;
    this.ipWarnedAt = nowMs;
    this.log.warn('client-error dropped ip-cap');
  }

  private noteDay(): void {
    if (this.dayWarned) return;
    this.dayWarned = true;
    this.log.warn('client-error dropped day-cap');
  }
}
