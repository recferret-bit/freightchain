/** A blockhash is valid for 151 blocks (~60–90 s): the conservative end is what a client may plan with before it must rebuild the transaction. */
export const BLOCKHASH_TTL_SECONDS = 60;

/** GET /api/chain/fees – what the lobby shows next to BUY (docs/paid-tickets-plan.md §2.4 / §2.9). */
export interface ChainFeesDto {
  /** the compute-unit price a ticket purchase is built with now (µL/CU) */
  priorityMicrolamports: number;
  /** the compute-unit limit of a purchase */
  computeUnits: number;
  /** what the network charges for it (base fee per signature + priority fee) – paid by the gas sponsor when `sponsored` */
  estimatedFeeLamports: number;
  /** a gas sponsor is configured: the buyer pays only the ticket price */
  sponsored: boolean;
  blockhashTtlSeconds: number;
}
