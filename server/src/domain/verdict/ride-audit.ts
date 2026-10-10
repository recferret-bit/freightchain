import { roadPlanFor, type PlannedHole } from '../road/road-plan.js';
import type { Ride } from '../rides/ride.entity.js';
import { summariseBatch } from '../telemetry/batch-summary.js';
import type { BatchFacts, RideBatch } from '../telemetry/ride-batch.entity.js';
import type { HolePass } from '../telemetry/world-facts.js';
import { RideVerdict } from './ride-verdict.entity.js';
import { isPhoneInput } from '../telemetry/telemetry-rules.js';
import { RULES_VERSION } from './verdict-rules.js';
import type { VerdictReason, VerdictStatus } from './verdict.dto.js';
import { classifyPass, firstPasses, holeOutcomes, offroadPeak, type HoleOutcome, type PassKind } from './world-checks.js';

/* A full AUDIT of one ride's stream – the tool behind the `ride-audit` skill (server/scripts/ride-audit.mjs). Unlike judging, it trusts nothing that was
   stored: every batch is measured again from its raw samples (summary AND the world facts, against the road rebuilt from the seed right now), the chain is
   taken as the caller re-hashed it, and the verdict is judged afresh at the current rules – then compared with the verdict on record. Pure: the script
   loads the rows (local database or production, read-only) and prints the report. */

export interface StoredVerdict { status: string; reasons: { code: string; severity?: string }[]; rulesVersion: number; overriddenBy: string | null }

export interface AuditHole extends HoleOutcome {
  lat: number;
  /** every axle pass of the hole, as measured, with what it shows */
  passes: (HolePass & { kind: PassKind; expected: number; got: number })[];
}

export interface RideAuditReport {
  ride: { id: string; wallet: string; tier: string; status: string; seed: number; route: string | null; distance: number; driveSeconds: number; hull: number | null; startedAt: string | null; endedAt: string | null };
  recording: { batches: number; samples: number; inputs: number; phoneEvents: number; presses: number; gasPresses: number; recordedSeconds: number; fromS: number; toS: number; hashesReproduced: number; replayColumns: boolean };
  road: { planned: number; reached: number; holes: AuditHole[]; notReached: PlannedHole[] };
  offroadPeakSeconds: number;
  gasless: [number, number][];
  verdict: { status: VerdictStatus; reasons: VerdictReason[]; rulesVersion: number };
  stored: StoredVerdict | null;
  /** the fresh verdict says the same as the one on record (status + reason codes) */
  agrees: boolean | null;
  /** verified now */
  ok: boolean;
}

export function auditRide(ride: Ride, batches: readonly RideBatch[], now: Date, stored: StoredVerdict | null = null): RideAuditReport {
  const plan = roadPlanFor(ride.seed, ride.trip), ordered = [...batches].sort((a, b) => a.seq - b.seq);
  const facts: BatchFacts[] = ordered.map((b, i) => {
    const prev = ordered[i - 1], prefix = prev && prev.seq === b.seq - 1 ? prev.body.samples : []; // as on upload: the tail of the batch before is measured with it
    return { seq: b.seq, prevHash: b.prevHash, hash: b.hash, hashOk: b.hashOk, t0: b.t0, t1: b.t1, summary: summariseBatch(b.seq, b.t0, b.t1, b.body.samples, b.body.inputs, plan, prefix) };
  });
  const verdict = RideVerdict.judge(ride, facts, now).toDto();
  const rows = ordered.flatMap((b) => b.body.samples), inputs = ordered.flatMap((b) => b.body.inputs), driving = inputs.filter((e) => !isPhoneInput(e)); // the phone's events are listed apart: not driving
  const sValues = rows.map((r) => r[1] ?? 0).filter(Number.isFinite), fromS = sValues.length ? Math.min(...sValues) : 0, toS = sValues.length ? Math.max(...sValues) : 0;
  const passes = firstPasses(facts), outcomes = holeOutcomes(passes.filter((p) => p.dir > 0));
  const planned = plan.holesBetween(Math.max(0, fromS), toS + 1), reached = new Set(outcomes.map((o) => o.hole));
  const holes: AuditHole[] = outcomes.map((o) => ({
    ...o, lat: planned.find((h) => h.id === o.hole)?.lat ?? plan.holeAt(Number(o.hole.slice(1)))?.lat ?? 0,
    passes: passes.filter((p) => p.hole === o.hole).map((p) => ({ ...p, ...classifyPass(p) })),
  })).sort((a, b) => a.s - b.s);
  const codes = (r: readonly { code: string }[]) => r.map((x) => x.code).sort().join(',');
  return {
    ride: {
      id: ride.id, wallet: ride.wallet, tier: ride.tier, status: ride.status, seed: ride.seed, route: ride.route, distance: Math.round(ride.distance), driveSeconds: Math.round(ride.driveSeconds), hull: ride.hull,
      startedAt: ride.startedAt?.toISOString() ?? null, endedAt: ride.endedAt?.toISOString() ?? null,
    },
    recording: {
      batches: ordered.length, samples: rows.length, inputs: driving.length, phoneEvents: inputs.length - driving.length, presses: driving.filter((e) => e[2] === 1).length, gasPresses: driving.filter((e) => e[2] === 1 && (e[1] === 'KeyW' || e[1] === 'ArrowUp')).length,
      recordedSeconds: Math.round(ordered.reduce((a, b) => a + Math.max(0, b.t1 - b.t0), 0) * 10) / 10, fromS: Math.round(fromS), toS: Math.round(toS), hashesReproduced: ordered.filter((b) => b.hashOk).length,
      replayColumns: rows.some((r) => r.length > 14),
    },
    road: { planned: planned.length, reached: reached.size, holes, notReached: planned.filter((h) => !reached.has(h.id)) },
    offroadPeakSeconds: Math.round(offroadPeak(facts.flatMap((f) => f.summary.world?.offroad ?? [])) * 10) / 10,
    gasless: facts.flatMap((f) => f.summary.world?.gasless ?? []),
    verdict: { status: verdict.status, reasons: verdict.reasons, rulesVersion: RULES_VERSION },
    stored,
    agrees: stored ? stored.status === verdict.status && codes(stored.reasons) === codes(verdict.reasons) : null,
    ok: verdict.status === 'verified',
  };
}
