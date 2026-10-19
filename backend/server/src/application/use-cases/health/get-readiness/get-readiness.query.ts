export class GetReadinessQuery {}

export interface ReadinessDto {
  status: 'ok' | 'degraded';
  checks: { database: { status: 'up' | 'down'; latencyMs?: number } };
}
