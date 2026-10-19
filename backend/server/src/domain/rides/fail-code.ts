/**
 * Maps the reason string a failed ride actually stores onto a stable `fail_code`.
 * Null means this reason is not a failure (complete, abandoned, replaced, or no reason).
 */
export function failCode(reason: string | null): string | null {
  if (reason === null) return null;
  if (reason === 'shift complete' || reason.startsWith('shift abandoned') || reason === 'replaced by a paid ride') return null;
  if (reason === 'heartbeat lost') return 'heartbeat_lost';
  if (reason.startsWith('implausible progress (')) return 'implausible_progress';
  if (reason.includes('brakes')) return 'brakes';
  if (reason.includes('blew') || reason.includes('max revs')) return 'engine_blown';
  if (reason.includes('cold')) return 'cold_engine';
  if (reason.includes('hull')) return 'hull';
  if (reason.includes('off the road')) return 'off_road';
  if (reason.includes('collision') || reason.includes('crashed into') || reason.includes('drove into') || reason.includes('ran into')) return 'crash';
  return 'other';
}
