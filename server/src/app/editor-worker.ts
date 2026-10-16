import '../infrastructure/config/dotenv-bootstrap.js';
import { NestFactory } from '@nestjs/core';
import { EditorWorkerModule } from './editor-worker.module.js';
import { EditorJobRunnerService } from '../application/services/editor-job-runner.service.js';
import { EnvService } from '../infrastructure/config/env.service.js';
import { JsonLogger } from '../infrastructure/logging/json-logger.js';
import { EditorJobSweepScheduler } from '../infrastructure/scheduling/editor-job-sweep.scheduler.js';

const env = new EnvService();
if (!env.hasStableJwtSecret) throw new Error('the editor worker requires JWT_SECRET shared with the API');
if (!env.editorMcpToken) throw new Error('the editor worker requires EDITOR_MCP_TOKEN');
const app = await NestFactory.createApplicationContext(EditorWorkerModule, { bufferLogs: true });
app.useLogger(app.get(JsonLogger));
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  // Stop claims and abort providers BEFORE app.close disconnects the infrastructure modules.
  await app.get(EditorJobSweepScheduler).onApplicationShutdown();
  await app.get(EditorJobRunnerService).onApplicationShutdown();
  await app.close();
};
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  void stop().catch(() => { console.error('editor worker shutdown failed'); process.exitCode = 1; });
});
