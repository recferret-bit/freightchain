import { AXLES, HOLE_TYPES, OFFROAD_FAIL_SECONDS, ROAD_PLAN_MAX_SPAN, ROAD_PLAN_WINDOW, holeDamage } from '../../../../src/domain/road/road-rules.js';

/* The game's numbers the server judges on (road-drift.spec.ts holds them to client/js); here: what they mean. */
describe('the road rules', () => {
  it('the game\'s hole damage: ∝ v², rear axles × .6, nothing when crawling or below the game\'s smallest hurt', () => {
    const T = HOLE_TYPES.sinkhole!;
    expect(holeDamage(T, 28, 0)).toBeCloseTo(14);
    expect(holeDamage(T, 14, 0)).toBeCloseTo(3.5);
    expect(holeDamage(T, 28, 2)).toBeCloseTo(8.4);
    expect(holeDamage(T, 2.9, 0)).toBe(0);
    expect(holeDamage(HOLE_TYPES.cluster!, 3.5, 1)).toBe(0); // 1.8 × (3.5/28)² × .6 < .3
  });

  it('only the sinkhole is rolled onto the road; three axles, front first; the game gives a truck 20 s off the road', () => {
    expect(Object.keys(HOLE_TYPES).filter((k) => HOLE_TYPES[k]!.cones)).toEqual(['sinkhole']);
    expect(AXLES[0]).toBeGreaterThan(AXLES[1]!);
    expect(AXLES[1]).toBeGreaterThan(AXLES[2]!);
    expect(OFFROAD_FAIL_SECONDS).toBe(20);
  });

  it('the game asks for its plan in windows the API accepts', () => {
    expect(ROAD_PLAN_WINDOW + 32).toBeLessThanOrEqual(ROAD_PLAN_MAX_SPAN);
  });
});
