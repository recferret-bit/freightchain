import type { CommandBus } from '@nestjs/cqrs';
import { EditorJobSweepScheduler } from '../../../../src/infrastructure/scheduling/editor-job-sweep.scheduler.js';
import { SweepEditorJobsCommand } from '../../../../src/application/use-cases/editor/sweep-editor-jobs/sweep-editor-jobs.command.js';

describe('EditorJobSweepScheduler', () => {
  it('boot: sweeps every orphan (all); then the timed sweeps; stops on shutdown; a failing sweep does not stop it', async () => {
    const sent: SweepEditorJobsCommand[] = [];
    let fail = false;
    const bus = { execute: async (c: SweepEditorJobsCommand) => { sent.push(c); if (fail) throw new Error('db down'); return { failed: 1 }; } } as unknown as CommandBus;
    const s = new EditorJobSweepScheduler(bus);
    await s.run(true);
    fail = true; await s.run();
    s.onApplicationShutdown();
    expect(sent).toEqual([new SweepEditorJobsCommand(true), new SweepEditorJobsCommand(false)]);
  });
});
