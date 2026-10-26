export const EVIDENCE_STATUSES = ['disabled', 'unconfigured', 'unavailable', 'invalid_input', 'not_found', 'observed', 'incomplete'] as const;
export type EvidenceStatus = typeof EVIDENCE_STATUSES[number];
/** Provider facts only. They never constitute a penalty or a claim of common ownership. */
export interface NetworkEvidence {
  status: EvidenceStatus;
  asn: string | null;
  mobile: boolean | null;
  hosting: boolean | null;
  anonymous: boolean | null;
  excluded: 'mobile' | null;
}
export const emptyNetworkEvidence = (status: EvidenceStatus): NetworkEvidence => ({ status, asn: null, mobile: null, hosting: null, anonymous: null, excluded: null });
export interface FundingTransfer { counterparty: string; direction: 'in' | 'out'; mint: string; amountRaw: string; signature: string; at: number }
export interface FundingEvidence {
  status: EvidenceStatus;
  source: 'helius-wallet-api';
  funder: { wallet: string; type: string | null; amountRaw: string; signature: string; slot: number; at: number } | null;
  transfers: FundingTransfer[];
  complete: boolean;
  excluded: 'exchange' | null;
}
export const emptyFundingEvidence = (status: EvidenceStatus): FundingEvidence => ({ status, source: 'helius-wallet-api', funder: null, transfers: [], complete: false, excluded: null });
