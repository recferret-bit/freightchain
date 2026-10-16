/** Mints a verified ride's HONK on the local program. No emitter key: the ledger stands alone. */
export abstract class HonkEmissionPort {
  abstract enabled(): boolean;
  abstract mint(rideId: string, wallet: string, amount: bigint): Promise<void>;
}
