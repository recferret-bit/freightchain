import { failCode } from '../../../../src/domain/rides/fail-code.js';

describe('failCode', () => {
  it('maps the stored reason strings and leaves non-failures null', () => {
    expect(failCode(null)).toBeNull();
    expect(failCode('shift complete')).toBeNull();
    expect(failCode('shift abandoned – the driver ended it')).toBeNull();
    expect(failCode('replaced by a paid ride')).toBeNull();
    expect(failCode('heartbeat lost')).toBe('heartbeat_lost');
    expect(failCode('implausible progress (s jumped)')).toBe('implausible_progress');
    expect(failCode('The drivetrain gave out – you drove against the brakes for too long.')).toBe('brakes');
    expect(failCode('The engine blew – it was held at max revs for too long.')).toBe('engine_blown');
    expect(failCode('held at max revs')).toBe('engine_blown');
    expect(failCode('The engine gave out – you pushed it hard while it was still cold.')).toBe('cold_engine');
    expect(failCode('Your truck was wrecked – the hull gave out.')).toBe('hull');
    expect(failCode('You spent too long off the road – the truck is stuck in the sand.')).toBe('off_road');
    expect(failCode('Head-on collision with a car.')).toBe('crash');
    expect(failCode('You ran into the back of a truck.')).toBe('crash');
    expect(failCode('You drove into a bus at the crossroads.')).toBe('crash');
    expect(failCode('A car crashed into your truck.')).toBe('crash');
    expect(failCode('something else')).toBe('other');
  });
});
