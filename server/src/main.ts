import './infrastructure/config/dotenv-bootstrap.js'; // FIRST: .env must be in process.env before any other module reads it
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module.js';
import { configureApp } from './app/configure-app.js';
import { EnvService } from './infrastructure/config/env.service.js';

const app = await NestFactory.create(AppModule, { bufferLogs: true }); // boot lines are held until configureApp installs the JSON logger
configureApp(app);
const env = app.get(EnvService, { strict: false });
await app.listen(env.port);
new Logger('Bootstrap').log(`Freight Chain server on http://localhost:${env.port} (env=${env.nodeEnv})`);
