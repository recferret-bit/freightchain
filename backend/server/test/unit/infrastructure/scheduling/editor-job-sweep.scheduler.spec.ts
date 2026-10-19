import type { CommandBus } from '@nestjs/cqrs';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { EditorJobSweepScheduler, editorWorkerHealthPath } from '../../../../src/infrastructure/scheduling/editor-job-sweep.scheduler.js';
import { SweepEditorJobsCommand } from '../../../../src/application/use-cases/editor/sweep-editor-jobs/sweep-editor-jobs.command.js';
import { FakeClock } from '../../../support/fake-clock.js';

vi.mock('node:fs/promises', () => ({ rename: vi.fn(async () => undefined), unlink: vi.fn(async () => undefined), writeFile: vi.fn(async () => undefined) }));
describe('EditorJobSweepScheduler', () => {
  beforeEach(() => vi.clearAllMocks());
  it('successful polls write health atomically; failure removes health; shutdown stops further polls', async () => {
    const sent: SweepEditorJobsCommand[] = [];
    let fail = false;
    const bus = { execute: async (c: SweepEditorJobsCommand) => { sent.push(c); if (fail) throw new Error('db down'); return { failed: 1 }; } } as unknown as CommandBus;
    const clock = new FakeClock(), s = new EditorJobSweepScheduler(bus, clock);
    await s.run();
    const file = editorWorkerHealthPath();
    expect(writeFile).toHaveBeenCalledWith(`${file}.tmp`, JSON.stringify({ checkedAt: clock.now().getTime() }), { mode: 0o600 });
    expect(rename).toHaveBeenCalledWith(`${file}.tmp`, file);
    fail = true; await s.run();
    expect(unlink).toHaveBeenCalledWith(file);
    await s.onApplicationShutdown();
    await s.run();
    expect(sent).toEqual([new SweepEditorJobsCommand(), new SweepEditorJobsCommand()]);
  });

  it('an in-flight poll cannot restore readiness after shutdown', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const s = new EditorJobSweepScheduler({ execute: async () => { await gate; return { failed: 0 }; } } as unknown as CommandBus, new FakeClock());
    const poll = s.run();
    await s.onApplicationShutdown(); release(); await poll;
    expect(writeFile).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
  });
});
