import { Injectable } from '@nestjs/common';

/* Wall clock behind a provider so tests can drive time instead of sleeping. */
@Injectable()
export class ClockService {
  now(): number { return Date.now(); }
}
