import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { LogoutCommand, type LogoutResultDto } from './logout.command.js';

/** Sessions are stateless JWTs in an httpOnly cookie: signing out = the controller's interceptor clears the cookie. */
@CommandHandler(LogoutCommand)
export class LogoutHandler implements ICommandHandler<LogoutCommand, LogoutResultDto> {
  async execute(): Promise<LogoutResultDto> {
    return { ok: true };
  }
}
