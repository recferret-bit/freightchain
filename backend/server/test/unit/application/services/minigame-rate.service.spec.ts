import { MinigameRateService } from '../../../../src/application/services/minigame-rate.service.js';
import { TooManyRequestsError } from '../../../../src/domain/shared/errors.js';

describe('MinigameRateService', () => {
  it('allows 10 requests per ride per minute, then 429, and the next window starts clean', () => {
    const rate = new MinigameRateService();
    for (let i = 0; i < 10; i++) rate.hit('ride-a', 1_000);
    expect(() => rate.hit('ride-a', 1_500)).toThrow(TooManyRequestsError);
    try { rate.hit('ride-a', 1_500); } catch (err) {
      expect(err).toMatchObject({ errorCode: 'mg_rate_limited', statusCode: 429, retryAfterSeconds: 60 });
    }
    rate.hit('ride-b', 1_500); // another ride does not share the bucket
    rate.hit('ride-a', 61_000);
    expect(() => rate.hit('ride-a', 61_000)).not.toThrow();
  });
});
