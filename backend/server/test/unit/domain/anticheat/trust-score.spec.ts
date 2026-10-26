import { Player } from '../../../../src/domain/players/player.entity.js';
import { trustPolicy } from '../../../../src/domain/anticheat/trust-score.js';
import { resolveSettings } from '../../../../src/domain/settings/game-settings.js';

const player = () => Player.register('wallet', new Date('2026-10-19T12:00:00Z'), 0, 0);
const date = (day: string) => new Date(`${day}T12:00:00Z`);

describe('persisted trust evidence', () => {
  it('awards at most two distinct completion days per ISO week, including late rejudgements', () => {
    const p = player();
    expect(p.awardVerifiedFinish(date('2026-10-19'))).toBe(true); expect(p.trustScore).toBe(75);
    expect(p.awardVerifiedFinish(date('2026-10-19'))).toBe(false);
    expect(p.awardVerifiedFinish(date('2026-10-20'))).toBe(true); expect(p.trustScore).toBe(90);
    expect(p.awardVerifiedFinish(date('2026-10-21'))).toBe(false);
    expect(p.awardVerifiedFinish(date('2026-10-26'))).toBe(true); expect(p.trustScore).toBe(100);
    const restored = Player.restore(p.snapshot()); restored.setTrustScore(40);
    expect(restored.awardVerifiedFinish(date('2026-10-19'))).toBe(false);
    expect(restored.awardVerifiedFinish(date('2026-10-22'))).toBe(false);
    expect(restored.trustScore).toBe(40);
  });
  it('credits each social provider once with a shared 30-point cap', () => {
    const p = player();
    p.awardSocial('telegram'); expect(p.trustScore).toBe(65);
    p.awardSocial('x'); expect(p.trustScore).toBe(85);
    p.awardSocial('discord'); expect(p.trustScore).toBe(90);
    p.setTrustScore(30);
    expect(p.awardSocial('x')).toBe(false); expect(p.trustScore).toBe(30);
    expect(p.snapshot().trustActivity?.socialPoints).toBe(30);
  });
  it('honours runtime finish and social caps without reducing an existing higher score', () => {
    const p = player(), policy = trustPolicy(resolveSettings([{ key: 'trust_finish_points', value: 7 }, { key: 'trust_finish_days_per_week', value: 1 }, { key: 'trust_finish_cap', value: 80 }, { key: 'trust_social_cap', value: 10 }]));
    p.awardVerifiedFinish(date('2026-10-19'), policy); expect(p.trustScore).toBe(67);
    expect(p.awardVerifiedFinish(date('2026-10-20'), policy)).toBe(false);
    p.awardSocial('x', policy); expect(p.trustScore).toBe(77);
    p.setTrustScore(95); p.awardVerifiedFinish(date('2026-10-26'), policy); expect(p.trustScore).toBe(95);
  });
});
