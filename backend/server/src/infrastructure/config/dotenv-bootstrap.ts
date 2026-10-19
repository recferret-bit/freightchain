import { loadDotEnv } from './load-dotenv.js';

/* Import this FIRST in an entry point (main.ts, cli/index.ts). ESM runs every static import before the importing file's own body, so loading .env from main()
   would be too late for modules that read process.env when they are imported (the auth rate limit). An import side effect runs in import order. */
// ENV_FILE picks another file (relative to the working directory) – `ENV_FILE=.env.devnet` = the local devnet profile (scripts/devnet.sh)
loadDotEnv(process.env.ENV_FILE || '.env');
