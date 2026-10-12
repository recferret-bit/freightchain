export type SolanaPayKind = 'ride' | 'order' | 'donation';

/** Label and icon for a transaction request. The id is part of the URL the wallet fetched; GET does not look the order up. */
export class GetSolanaPayLinkQuery {
  constructor(public readonly id: string) {}
}

export interface SolanaPayLinkDto {
  label: string;
  icon: string;
}

/** The same unsigned transaction the desktop signs, for the account the phone wallet sent. */
export class GetSolanaPayTransactionQuery {
  constructor(
    public readonly kind: SolanaPayKind,
    public readonly id: string,
    public readonly account: string,
  ) {}
}

export interface SolanaPayTransactionDto {
  transaction: string;
  message: string;
}
