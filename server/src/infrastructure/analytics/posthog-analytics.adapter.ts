import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { AnalyticsPort, type AnalyticsEvent } from '../../application/ports/analytics/analytics.port.js';
import { EnvService } from '../config/env.service.js';
import { analyticsUuid, isUuid } from './uuid-v5.js';

const FLUSH_MS = 1000;
const FLUSH_AT = 20;
const SHUTDOWN_MS = 500;

/**
 * Best-effort PostHog batch. `capture` enqueues and returns. A full queue or a 1s timer flushes.
 * Shutdown spends 500ms then drops. A failed flush logs the event name and the HTTP status, never the body.
 */
@Injectable()
export class PostHogAnalyticsAdapter extends AnalyticsPort implements OnApplicationShutdown {
  private readonly log = new Logger(PostHogAnalyticsAdapter.name);
  private readonly queue: AnalyticsEvent[] = [];
  private readonly fetchImpl: typeof fetch;
  private readonly key: string | null;
  private readonly host: string;
  private readonly on: boolean;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(env: EnvService) {
    super();
    this.fetchImpl = globalThis.fetch.bind(globalThis);
    this.key = env.posthogKey;
    this.host = env.posthogHost.replace(/\/$/, '');
    this.on = env.analyticsEnabled;
    if (this.on) this.log.log(`analytics enabled host=${this.host}`);
    else this.log.log('analytics disabled');
  }

  enabled(): boolean { return this.on; }

  capture(event: AnalyticsEvent): void {
    try {
      if (!this.on || !this.key) return;
      this.queue.push(event);
      if (this.queue.length >= FLUSH_AT) {
        void this.flush();
        return;
      }
      if (!this.timer) {
        this.timer = setTimeout(() => { void this.flush(); }, FLUSH_MS);
        this.timer.unref?.();
      }
    } catch { /* never throw into a handler */ }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.flush(SHUTDOWN_MS);
  }

  private async flush(budgetMs = 0): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.key || this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    const ac = new AbortController();
    const kill = budgetMs > 0 ? setTimeout(() => ac.abort(), budgetMs) : null;
    kill?.unref?.();
    try {
      const res = await this.fetchImpl(`${this.host}/batch/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ api_key: this.key, batch: batch.map((event) => this.wire(event)) }),
        signal: budgetMs > 0 ? ac.signal : undefined,
      });
      await res.body?.cancel?.().catch(() => undefined);
      if (!res.ok) this.warn(res.status, batch);
    } catch {
      this.warn(0, batch);
    } finally {
      if (kill) clearTimeout(kill);
    }
  }

  private warn(status: number, batch: AnalyticsEvent[]): void {
    const names = batch.map((event) => event.event).join(',');
    this.log.warn(`analytics flush failed status=${status} events=${batch.length} name=${names}`);
  }

  private wire(event: AnalyticsEvent): Record<string, unknown> {
    const source = event.properties['source'] === 'client' ? 'client' : 'server';
    const properties: Record<string, unknown> = { ...event.properties, source, $lib: source === 'client' ? 'freightchain-web' : 'freightchain-server' };
    if (event.dedupeKey) properties['dedupe_key'] = event.dedupeKey;
    if (event.set) properties['$set'] = event.set;
    if (event.setOnce) properties['$set_once'] = event.setOnce;
    const uuid = event.uuid ?? (event.dedupeKey ? analyticsUuid(event.dedupeKey) : null);
    const row: Record<string, unknown> = { event: event.event, distinct_id: event.distinctId, timestamp: event.timestamp.toISOString(), properties };
    if (uuid && isUuid(uuid)) row['uuid'] = uuid;
    return row;
  }
}
