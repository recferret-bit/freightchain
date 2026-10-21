export class GetPoolResultsQuery {
  constructor(readonly poolId: number, readonly wallet: string | null) {}
}

export interface PoolResultMine {
  rideId: string;
  effectiveDurationMs: number;
  finished: boolean;
  damageTotal: number;
}

export interface PoolResultRank extends PoolResultMine {
  rank: number;
  wallet: string;
  damageHoles: number;
  damageVehicles: number;
  damageProps: number;
  damageCold: number;
  damageOther: number;
  redLights: number;
  mgWrong: number;
  mgMissed: number;
  mgPenaltySeconds: number;
  scoreFormulaVersion: number;
}

export interface PoolResultsDto {
  poolId: number;
  revealed: boolean;
  payoutAt: number;
  scoreFormulaVersion: number;
  participants: number;
  mine: PoolResultMine | null;
  ranks: PoolResultRank[];
}
