/** Queue discovery can fail before a job is claimed. Keep the daemon alive through database/cache outages. */
export async function replayWorkerLoop<T extends { processed: number; failed: number }>(options: {
  processBatch: () => Promise<T>;
  stopping: () => boolean;
  intervalMs: number;
  report: (event: Record<string, unknown>) => void;
  wait?: (ms: number) => Promise<void>;
}): Promise<void> {
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  while (!options.stopping()) {
    let waitMs = options.intervalMs;
    try {
      const result = await options.processBatch();
      if (result.processed > 0 || result.failed > 0) options.report({ event: 'replay-worker.batch', ...result });
      if (result.processed > 0) waitMs = 50;
    } catch (error) {
      options.report({ event: 'replay-worker.retry', error: error instanceof Error ? error.message : String(error) });
    }
    if (!options.stopping()) await wait(waitMs);
  }
}
