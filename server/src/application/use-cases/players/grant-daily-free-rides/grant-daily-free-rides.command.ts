export class GrantDailyFreeRidesCommand {}

export interface GrantDailyFreeRidesResultDto {
  /** the UTC day the grant was for (YYYY-MM-DD) */
  day: string;
  /** players whose day was advanced (0 = already granted today) */
  players: number;
}
