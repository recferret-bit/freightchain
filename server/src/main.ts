import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { config } from './config.js';

const app = await NestFactory.create(AppModule);
app.enableShutdownHooks();
await app.listen(config.port);
console.log(`Freight Chain server on http://localhost:${config.port}`);
