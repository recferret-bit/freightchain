import type { NetworkEvidence } from '../../../domain/trust/evidence.js';
export abstract class NetworkEvidencePort { abstract lookup(ip: string | null): Promise<NetworkEvidence>; }
