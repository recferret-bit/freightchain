/** `wallet` is omitted for 1-click sign-in: the wallet's sheet supplies the address. */
export class RequestEditorChallengeCommand {
  constructor(public readonly wallet: string | null) {}
}
