/** Load server/.env into process.env (existing variables win). Called by the server entry point and the CLI – never by tests, which set their own environment. */
export function loadDotEnv(file = '.env'): void {
  try {
    process.loadEnvFile(file);
  } catch {
    // no .env file: plain environment
  }
}
