import { fileURLToPath } from 'node:url';

/** The site folder served next to the API: ../client, resolved from this module so it works from src/ and from the built dist/. */
export const defaultClientDir = (): string => fileURLToPath(new URL('../../../../client', import.meta.url));
