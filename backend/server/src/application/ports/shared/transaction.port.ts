export type TransactionHandle = { readonly __brand: 'TransactionHandle' };

/** Runs `fn` in one database transaction; repositories take the handle as an optional last argument. */
export abstract class TransactionPort {
  abstract run<T>(fn: (tx: TransactionHandle) => Promise<T>): Promise<T>;
}
