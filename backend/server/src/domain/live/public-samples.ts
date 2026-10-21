import { SAMPLE_INPUT_COL } from '../telemetry/telemetry-rules.js';

/** The public replay keeps the column layout and zeroes the input bits, so a watcher cannot train on the driver's controls. */
export function withoutPublicInputs(samples: readonly (readonly number[])[]): number[][] {
  return samples.map((row) => {
    if (row.length <= SAMPLE_INPUT_COL) return [...row];
    const next = [...row];
    next[SAMPLE_INPUT_COL] = 0;
    return next;
  });
}
