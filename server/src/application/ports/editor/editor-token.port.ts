import type { SignedToken } from '../../../domain/auth/auth-challenge.entity.js';

/** The 3D model editor's session: its own token (own key, own audience) – never a player's or an admin's. */
export abstract class EditorTokenPort {
  abstract sign(wallet: string): Promise<SignedToken>;
  /** the wallet of a valid, unexpired EDITOR token; null otherwise */
  abstract verify(token: string): Promise<string | null>;
}
