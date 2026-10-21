/** Cloudflare Turnstile. A missing secret must not be required for the service to run: the campaign leaves this off unless a test turns it on. */
export abstract class TurnstilePort {
  abstract verify(token: string): Promise<boolean>;
}
