import { Injectable } from '@nestjs/common';
import { ClockPort } from '../../application/ports/shared/clock.port.js';

@Injectable()
export class SystemClock extends ClockPort {
  now(): Date {
    return new Date();
  }
}
