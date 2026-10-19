/** The hello button. The client still sends `account`; the reply does not use it. */
export class SayHelloActionCommand {
  constructor(readonly account: string) {}
}
