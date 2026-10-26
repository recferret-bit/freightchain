import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AlertOutboxRepositoryPort } from '../../application/ports/admin/alert-outbox.repository.port.js';
import { ClockPort } from '../../application/ports/shared/clock.port.js';
import { EnvService } from '../config/env.service.js';

const RETRY_MS = [30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000];

/** Delivers admin.AlertOutbox to Telegram. A missing token leaves the row pending. The bot token is never logged. */
@Injectable()
export class TelegramAlertScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('AdminAlert');
  private dispatching = false;
  private stopped = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly alerts: AlertOutboxRepositoryPort,
    private readonly env: EnvService,
    private readonly clock: ClockPort,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => { void this.dispatch(); }, 30_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  async dispatch(): Promise<void> {
    if (this.stopped || this.dispatching) return;
    this.dispatching = true;
    try {
      await this.deliverDue();
    } catch (error) {
      // Database errors can contain connection details; keep the timer boundary diagnostic redacted.
      this.log.error({ event: 'admin-alert.dispatch-failed', message: error instanceof Error ? error.name : 'unknown' });
    } finally {
      this.dispatching = false;
    }
  }

  private async deliverDue(): Promise<void> {
    const token = this.env.adminAlertTelegramBotToken;
    const chat = this.env.adminAlertTelegramChatId;
    const now = this.clock.now();
    const due = await this.alerts.due(now, 20);
    for (const row of due) {
      if (!token || !chat) continue;
      try {
        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chat, text: row.text.slice(0, 4000) }),
          signal: AbortSignal.timeout(5_000),
        });
        if (response.ok) { await this.alerts.markSent(row.id, now); continue; }
        await this.retry(row.id, row.attempts + 1, `http ${response.status}`, now);
      } catch (error) {
        const message = error instanceof Error ? error.name : 'network';
        this.log.error({ event: 'admin-alert.undelivered', id: row.id, kind: row.kind, message });
        await this.retry(row.id, row.attempts + 1, message, now);
      }
    }
  }

  private async retry(id: string, attempts: number, error: string, now: Date): Promise<void> {
    const pause = RETRY_MS[Math.min(attempts, RETRY_MS.length - 1)] ?? 1_800_000;
    await this.alerts.markRetry(id, attempts, new Date(now.getTime() + pause), error.slice(0, 200));
    if (attempts >= 48) this.log.error({ event: 'admin-alert.undelivered', id, message: 'gave up' });
  }
}
