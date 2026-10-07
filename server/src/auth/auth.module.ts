import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthGuard } from './auth.guard.js';
import { UsersModule } from '../users/users.module.js';
import { config } from '../config.js';

if (config.production && !config.jwtSecret) throw new Error('JWT_SECRET must be set in production');
// dev: a fresh secret per boot (sessions don't survive a restart – set JWT_SECRET to keep them)
const secret = config.jwtSecret || randomBytes(32).toString('hex');

@Module({
  imports: [UsersModule, JwtModule.register({ secret, signOptions: { expiresIn: `${config.sessionDays}d` } })],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}
