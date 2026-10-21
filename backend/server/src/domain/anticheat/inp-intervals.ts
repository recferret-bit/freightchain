/** Event times (µs) from an inflated inp JSON array or `{ events }`. */
export function eventTimesUs(text: string): number[] {
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { return []; }
  const rows = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && Array.isArray((parsed as { events?: unknown }).events) ? (parsed as { events: unknown[] }).events : [];
  const times: number[] = [];
  for (const row of rows) if (row && typeof row === 'object' && typeof (row as { tUs?: unknown }).tUs === 'number') times.push((row as { tUs: number }).tUs);
  return times;
}

/** Inter-event gaps in milliseconds, in time order. */
export function intervalsFromTimesUs(times: readonly number[]): number[] {
  const sorted = [...times].sort((a, b) => a - b);
  const out: number[] = [];
  for (let i = 1; i < sorted.length; i++) out.push((sorted[i]! - sorted[i - 1]!) / 1000);
  return out;
}
