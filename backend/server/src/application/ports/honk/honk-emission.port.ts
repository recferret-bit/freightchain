/** Pays a released ride from the emission vault. The program derives the amount from tier and band bits. No emitter key: the ledger stands alone. */
export abstract class HonkEmissionPort {
  abstract enabled(): boolean;
  abstract mint(rideId: string, wallet: string, tier: string, bands: number, dayIndex: number, expectedAmount?: bigint): Promise<void>;
}
