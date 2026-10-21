import type { MiniGameStatus } from './close.js';
import { MG_RULES } from './kinds.js';

export interface AttemptLogEntry {
  n: number;
  hash: string;
  outcome: string;
  penaltyS: number;
}

/** mgDetail may hold a buy amount (disabled kinds) and the attempt log. Never the raw SMS code. */
export interface MiniGameDetail {
  amount?: number;
  attempts?: AttemptLogEntry[];
}

export interface RideMiniGameProps {
  id: string;
  rideId: string;
  ordinal: number;
  kind: string;
  status: MiniGameStatus;
  variantSeq: number;
  trigger: string;
  armedAtMs: number;
  bayDeadlineMs: number | null;
  slotS: number | null;
  windowMs: number;
  revealedAt: Date | null;
  answeredAt: Date | null;
  attempts: number;
  outcome: string | null;
  penaltyS: number;
  answerHash: string | null;
  clientSafe: boolean | null;
  nonce: string | null;
  mgDetail: MiniGameDetail | null;
  rulesVersion: string;
}

export class RideMiniGame {
  private constructor(private readonly p: RideMiniGameProps) {}

  static arm(props: Pick<RideMiniGameProps, 'id' | 'rideId' | 'ordinal' | 'kind' | 'trigger' | 'armedAtMs' | 'bayDeadlineMs' | 'windowMs' | 'answerHash'>): RideMiniGame {
    return new RideMiniGame({
      ...props, status: 'armed', variantSeq: 0, slotS: null, revealedAt: null, answeredAt: null, attempts: 0, outcome: null, penaltyS: 0,
      clientSafe: null, nonce: null, mgDetail: null, rulesVersion: MG_RULES,
    });
  }

  static restore(props: RideMiniGameProps): RideMiniGame {
    return new RideMiniGame({ ...props, rulesVersion: props.rulesVersion || MG_RULES, mgDetail: props.mgDetail ?? null, slotS: props.slotS ?? null });
  }

  get id(): string { return this.p.id; }
  get rideId(): string { return this.p.rideId; }
  get ordinal(): number { return this.p.ordinal; }
  get kind(): string { return this.p.kind; }
  get status(): MiniGameStatus { return this.p.status; }
  get variantSeq(): number { return this.p.variantSeq; }
  get trigger(): string { return this.p.trigger; }
  get armedAtMs(): number { return this.p.armedAtMs; }
  get bayDeadlineMs(): number | null { return this.p.bayDeadlineMs; }
  get slotS(): number | null { return this.p.slotS; }
  get windowMs(): number { return this.p.windowMs; }
  get revealedAt(): Date | null { return this.p.revealedAt; }
  get attempts(): number { return this.p.attempts; }
  get outcome(): string | null { return this.p.outcome; }
  get penaltyS(): number { return this.p.penaltyS; }
  get answerHash(): string | null { return this.p.answerHash; }
  get clientSafe(): boolean | null { return this.p.clientSafe; }
  get nonce(): string | null { return this.p.nonce; }
  get detail(): MiniGameDetail | null { return this.p.mgDetail; }

  setStatus(status: MiniGameStatus): void { this.p.status = status; }

  reveal(variantSeq: number, nonce: string, answerHash: string, windowMs: number, clientSafe: boolean | null, at: Date): void {
    this.p.variantSeq = variantSeq;
    this.p.nonce = nonce;
    this.p.answerHash = answerHash;
    this.p.windowMs = windowMs;
    if (this.p.revealedAt === null) this.p.revealedAt = at;
    if (clientSafe !== null) this.p.clientSafe = clientSafe;
    this.p.status = 'revealed';
  }

  /** Same attempt and same answer hash: the stored outcome. A different answer at that attempt is a conflict. */
  priorAttempt(n: number, hash: string): AttemptLogEntry | 'conflict' | null {
    const hit = this.p.mgDetail?.attempts?.find((a) => a.n === n);
    if (!hit) return null;
    return hit.hash === hash ? hit : 'conflict';
  }

  recordAttempt(entry: AttemptLogEntry, terminal: boolean, at: Date): void {
    const attempts = [...(this.p.mgDetail?.attempts ?? []), entry];
    this.p.mgDetail = { ...(this.p.mgDetail ?? {}), attempts };
    this.p.attempts = entry.n;
    this.p.outcome = terminal ? entry.outcome : null;
    this.p.penaltyS = entry.penaltyS;
    if (terminal) {
      this.p.status = 'answered';
      this.p.answeredAt = at;
    }
  }

  snapshot(): RideMiniGameProps { return { ...this.p, mgDetail: this.p.mgDetail ? { ...this.p.mgDetail, attempts: this.p.mgDetail.attempts ? [...this.p.mgDetail.attempts] : undefined } : null }; }
}
