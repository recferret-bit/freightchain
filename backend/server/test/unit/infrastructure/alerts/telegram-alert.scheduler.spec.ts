import { TelegramAlertScheduler } from '../../../../src/infrastructure/alerts/telegram-alert.scheduler.js';
import type { AlertOutboxRepositoryPort } from '../../../../src/application/ports/admin/alert-outbox.repository.port.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';
import { FakeClock } from '../../../support/fake-clock.js';

describe('TelegramAlertScheduler', () => {
  it('leaves a row pending when Telegram is not configured and does not log a token', async () => {
    const rows = [{ id: 'a', kind: 'auth.signin', text: 'signed in', money: false, status: 'pending', attempts: 0, nextAttemptAt: new Date(0), lastError: null, createdAt: new Date(0), sentAt: null, requestId: null }];
    const alerts = { due: async () => rows, markSent: async () => {}, markRetry: async () => {}, insert: async () => {}, active: async () => [], countUndelivered: async () => 0 } as AlertOutboxRepositoryPort;
    const env = { adminAlertTelegramBotToken: undefined, adminAlertTelegramChatId: undefined } as EnvService;
    const scheduler = new TelegramAlertScheduler(alerts, env, new FakeClock());
    await scheduler.dispatch();
    expect(rows[0]?.status).toBe('pending');
  });
});
