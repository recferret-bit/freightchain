import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { AnalyticsPort, type AnalyticsEvent, type ExceptionCapture } from '../../application/ports/analytics/analytics.port.js';
import { EnvService } from '../config/env.service.js';
import { analyticsUuid, isUuid } from './uuid-v5.js';

const FLUSH_MS = 1000;
const FLUSH_AT = 20;
const SHUTDOWN_MS = 500;

/**
 * Best-effort PostHog batch. `capture` enqueues and returns. A full queue or a 1s timer flushes.
 * Shutdown spends 500ms then drops. A flush logs status, count and event names. Never the body or the key.
 */
@Injectable()
export class PostHogAnalyticsAdapter extends AnalyticsPort implements OnApplicationShutdown {
  private readonly log = new Logger(PostHogAnalyticsAdapter.name);
  private readonly queue: { name: string; row: Record<string, unknown> }[] = [];
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
    this.push(event.event, this.wire(event));
  }

  captureException(report: ExceptionCapture): void {
    this.push('$exception', this.wireException(report));
  }

  private push(name: string, row: Record<string, unknown>): void {
    try {
      if (!this.on || !this.key) return;
      this.queue.push({ name, row });
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
        body: JSON.stringify({ api_key: this.key, batch: batch.map((item) => item.row) }),
        signal: budgetMs > 0 ? ac.signal : undefined,
      });
      await res.body?.cancel?.().catch(() => undefined);
      if (res.ok) this.note(res.status, batch);
      else this.warn(res.status, batch);
    } catch {
      this.warn(0, batch);
    } finally {
      if (kill) clearTimeout(kill);
    }
  }

  private note(status: number, batch: { name: string }[]): void {
    this.log.log(this.outcome('ok', status, batch));
  }

  private warn(status: number, batch: { name: string }[]): void {
    this.log.warn(this.outcome('failed', status, batch));
  }

  /** Status, count, names. The request body and the project token never reach the log. */
  private outcome(kind: 'ok' | 'failed', status: number, batch: { name: string }[]): string {
    const names = batch.map((item) => item.name).join(',');
    return `analytics flush ${kind} status=${status} events=${batch.length} name=${names}`;
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

  /** A real `$exception`. Frames are oldest-first; the last one is the throw site. No uuid: PostHog groups the issue. */
  private wireException(report: ExceptionCapture): Record<string, unknown> {
    const properties: Record<string, unknown> = {
      source: 'client', $lib: 'freightchain-web', surface: report.surface, $exception_level: 'error',
      $exception_list: [{
        type: report.type, value: report.value,
        mechanism: { handled: false, synthetic: false, type: 'generic' },
        stacktrace: {
          type: 'raw',
          frames: report.frames.map((frame) => ({
            platform: 'web:javascript', filename: frame.filename, function: frame.function,
            lineno: frame.lineno, colno: frame.colno, in_app: frame.inApp,
          })),
        },
      }],
    };
    if (report.release) properties['release'] = report.release;
    return { event: '$exception', distinct_id: report.distinctId, timestamp: report.timestamp.toISOString(), properties };
  }
}
