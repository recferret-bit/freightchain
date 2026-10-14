import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Where the MCP finds the repo pieces it serves: the entity core (client/shared/entity) and the 3d-assets skill. In the Docker image both are
   copied next to /app/mcp exactly as in the repo (deploy/Dockerfile.mcp), so the same relative paths hold. FC_REPO overrides the root. */
export const REPO = process.env.FC_REPO ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ENTITY = join(REPO, 'client', 'shared', 'entity');
export const SEED = join(ENTITY, 'seed');
export const SKILL = join(REPO, '.claude', 'skills', '3d-assets');
export const FORMAT = join(dirname(fileURLToPath(import.meta.url)), 'entity-format.md');
