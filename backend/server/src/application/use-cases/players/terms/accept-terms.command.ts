export class AcceptTermsCommand {
  constructor(readonly wallet: string, readonly termsVersion: number, readonly privacyVersion: number) {}
}
