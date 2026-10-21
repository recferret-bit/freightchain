import type { MgRunMode } from '../../../domain/minigames/kinds.js';

/** MINIGAMES / MG_SECRET / MG_SALT_VERSION. Not part of RulesConfig (that object is compared in full by its adapter spec). */
export abstract class MinigameConfigPort {
  abstract mode(): MgRunMode;
  abstract saltVersion(): string;
  /** Undefined when MINIGAMES is off. Required by the env schema otherwise, at least 32 bytes. */
  abstract secret(): string | undefined;
}
