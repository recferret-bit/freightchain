import { sourceFiles } from './source-files.js';

/* Statistics are running totals, so every code path that can END a ride must add it to them (StatsService.recordRide) – a path that forgets makes the landing's
   numbers drift for ever. The domain methods that end a ride are named here; whoever calls one in application code must also call recordRide in the same file. */
const ENDING_CALLS = [/\.failHeartbeatLost\(/, /\.finish\(/, /\.applyReport\(/];

describe('statistics hooks', () => {
  const application = sourceFiles().filter((f) => f.layer === 'application');

  it('every use case that ends a ride records it in the statistics', () => {
    const offenders = application.filter((f) => ENDING_CALLS.some((re) => re.test(f.text)) && !/stats\.recordRide\(/.test(f.text));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it('every place that creates a donation event records it in the statistics', () => {
    const offenders = application.filter((f) => /RideEvent\.donation\(/.test(f.text) && !/stats\.recordDonation\(/.test(f.text));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });
});
