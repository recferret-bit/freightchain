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

describe('Telegram alert timer outage boundary', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('contains a due-query outage and retries on the next timer tick without exposing error details', async () => {
    vi.useFakeTimers();
    const due = vi.fn().mockRejectedValueOnce(new Error('postgres://secret')).mockResolvedValue([]);
    const scheduler = new TelegramAlertScheduler({ due } as unknown as AlertOutboxRepositoryPort, {} as EnvService, new FakeClock());
    const log = vi.spyOn((scheduler as unknown as { log: { error: (entry: unknown) => void } }).log, 'error').mockImplementation(() => {});
    scheduler.onModuleInit();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(due).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith({ event: 'admin-alert.dispatch-failed', message: 'Error' });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(due).toHaveBeenCalledTimes(2);
    scheduler.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(due).toHaveBeenCalledTimes(2);
  });

  it('contains failed retry persistence and successfully delivers on the next pass', async () => {
    const row = { id: 'a', kind: 'auth.signin', text: 'fixture', attempts: 0 };
    const alerts = { due: vi.fn().mockResolvedValue([row]), markSent: vi.fn().mockResolvedValue(undefined), markRetry: vi.fn().mockRejectedValue(new Error('database unavailable')) };
    const send = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', send);
    const scheduler = new TelegramAlertScheduler(alerts as unknown as AlertOutboxRepositoryPort, { adminAlertTelegramBotToken: 'fixture-only', adminAlertTelegramChatId: 'fixture' } as EnvService, new FakeClock());
    await expect(scheduler.dispatch()).resolves.toBeUndefined();
    await expect(scheduler.dispatch()).resolves.toBeUndefined();
    expect(alerts.markSent).toHaveBeenCalledWith('a', expect.any(Date));
  });

  it('does not overlap passes while the outbox query is pending', async () => {
    let finish!: (rows: never[]) => void;
    const due = vi.fn().mockImplementation(() => new Promise<never[]>(resolve => { finish = resolve; }));
    const scheduler = new TelegramAlertScheduler({ due } as unknown as AlertOutboxRepositoryPort, {} as EnvService, new FakeClock());
    const running = scheduler.dispatch();
    await scheduler.dispatch();
    expect(due).toHaveBeenCalledTimes(1);
    finish([]);
    await running;
  });
});
