import { fileURLToPath } from 'node:url';

/** The site folder served next to the API: ../../frontend/client, resolved from this module so it works from src/ and from the built dist/. */
export const defaultClientDir = (): string => fileURLToPath(new URL('../../../../../frontend/client', import.meta.url));

/** The landing's Vite build (frontend/landing/dist), served at / in front of the site folder. Absent until `npm run landing:build` – then / falls back to client/index.html. */
export const defaultLandingDir = (): string => fileURLToPath(new URL('../../../../../frontend/landing/dist', import.meta.url));
