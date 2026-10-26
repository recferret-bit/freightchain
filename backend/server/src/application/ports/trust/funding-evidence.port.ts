import type { FundingEvidence } from '../../../domain/trust/evidence.js';
export abstract class FundingEvidencePort { abstract lookup(wallet: string): Promise<FundingEvidence>; }
