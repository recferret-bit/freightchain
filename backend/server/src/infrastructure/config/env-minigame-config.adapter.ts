import { Injectable } from '@nestjs/common';
import { MinigameConfigPort } from '../../application/ports/minigames/minigame-config.port.js';
import type { MgRunMode } from '../../domain/minigames/kinds.js';
import { EnvService } from './env.service.js';

@Injectable()
export class EnvMinigameConfigAdapter extends MinigameConfigPort {
  constructor(private readonly env: EnvService) { super(); }

  mode(): MgRunMode { return this.env.minigamesMode; }
  saltVersion(): string { return this.env.mgSaltVersion; }
  secret(): string | undefined { return this.env.mgSecret; }
}
