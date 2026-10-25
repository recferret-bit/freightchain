// Test-only bootstrap: exercise grant issuance during an open ranked week on every calendar day.
// The production entrypoint and SystemClock are unchanged. All persistence must be disposable and local.
import { NestFactory } from '@nestjs/core';
const build = process.argv[2], database = process.env.DATABASE_URL;
if (!/^\.e2e-build-\d+$/.test(build ?? '') || process.env.NODE_ENV === 'production' || !database || !['localhost', '127.0.0.1'].includes(new URL(database).hostname) || !/^\/freightchain_e2e_\d+$/.test(new URL(database).pathname)) throw new Error('use the isolated e2e.sh weekly runner');
const load = path => import(new URL(`../${build}/${path}`, import.meta.url));
await load('infrastructure/config/dotenv-bootstrap.js');
const [{ AppModule }, { configureApp }, { EnvService }, { ClockPort }] = await Promise.all([
  load('app/app.module.js'), load('app/configure-app.js'), load('infrastructure/config/env.service.js'), load('application/ports/shared/clock.port.js'),
]);
const app = await NestFactory.create(AppModule, { bufferLogs: true });
const realStart = Date.now(), at = Date.parse('2036-10-08T12:00:00Z'); // Wednesday, inside ranked entry.
app.get(ClockPort).now = () => new Date(at + Date.now() - realStart);
configureApp(app);
await app.listen(app.get(EnvService).port);
console.log('weekly browser fixture clock: Wednesday 2036-10-08, advancing in real seconds');
