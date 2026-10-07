import { fileURLToPath } from 'node:url';

/** The site folder served next to the API: ../client, resolved from this module so it works from src/ and from the built dist/. */
export const defaultClientDir = (): string => fileURLToPath(new URL('../../../../client', import.meta.url));

/** The landing's Vite build (landing/dist), served at / in front of the site folder. Absent until `npm run landing:build` – then / falls back to client/index.html. */
export const defaultLandingDir = (): string => fileURLToPath(new URL('../../../../landing/dist', import.meta.url));
