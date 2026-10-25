/** Cloudflare Turnstile. A missing secret must not be required for the service to run: the campaign leaves this off unless a test turns it on. */
export abstract class TurnstilePort {
  get required(): boolean { return false; }
  abstract verify(token: string): Promise<boolean>;
}
