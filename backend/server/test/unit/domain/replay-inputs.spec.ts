import { readFileSync } from 'node:fs';
import { SAMPLE_CLOCK_COL, SAMPLE_FLAGS_COL, SAMPLE_FORK_COL, SAMPLE_INPUT_COL, SAMPLE_MAX_WIDTH, SAMPLE_WIDTH } from '../../../src/domain/telemetry/telemetry-rules.js';
import { INPUT_BIT, inputMaskAt } from '../../support/recording.js';
import type { InputEvent } from '../../../src/domain/telemetry/ride-batch.entity.js';

/* The replays' input column is a protocol between the game (client/js/input-bits.js writes it, watch.js reads it) and the stored recording: the server
   only carries it, so these pin the two sides together – the column, the frozen bit order, and the bits the test recordings use. */
const client = (f: string) => readFileSync(new URL(`../../../../../frontend/client/js/${f}`, import.meta.url), 'utf8');
const bits = client('input-bits.js');
const controls = JSON.parse((/export const CONTROLS = (\[[^\]]+\])/.exec(bits)?.[1] ?? '[]').replace(/'/g, '"').replace(/\s+/g, ' ')) as string[];

describe('the replay columns (protocol with the game)', () => {
  it('are appended after the judged twelve, in this order, and fit the width the HTTP boundary takes', () => {
    expect([SAMPLE_CLOCK_COL, SAMPLE_FLAGS_COL, SAMPLE_INPUT_COL, SAMPLE_FORK_COL]).toEqual([SAMPLE_WIDTH, SAMPLE_WIDTH + 1, SAMPLE_WIDTH + 2, SAMPLE_WIDTH + 3]);
    expect(SAMPLE_FORK_COL).toBeLessThan(SAMPLE_MAX_WIDTH);
    expect(bits).toContain(`export const INPUT_COL = ${SAMPLE_INPUT_COL};`);
    expect(client('telemetry.js')).toMatch(/\[t, s, d, psi, v, rpm, gear, hull, gas, brake, steer, clutch, clock, flags, inputs, fork\]/);
    expect(client('watch.js')).toContain(`FORK_COL = ${SAMPLE_FORK_COL}`);
  });

  it('the client\'s bit table: frozen order, every bit inside 30 (JS bitwise is 32-bit signed), MOUSE = bit 25, the controls appended after it skip that bit', () => {
    expect(controls.slice(0, 25)).toEqual(['gas', 'brake', 'left', 'right', 'clutch', 'up', 'down', 'gear', 'reverse', 'start', 'stop', 'keyOn', 'park', 'heat', 'wiper', 'wash',
      'head', 'cab', 'night', 'radio', 'prev', 'next', 'volume', 'pause', 'mute']);
    expect(controls.slice(25)).toEqual(['map', 'cold', 'share']); // appended 2026-10: the phone map (N), cab cooling (J), the dash POST ON X button. All skip bit 25 (MOUSE).
    const mouse = Number(/export const MOUSE = 1 << (\d+);/.exec(bits)?.[1]);
    expect(mouse).toBe(25);
    expect(controls.length + 1).toBeLessThan(30);
    const bitOf = (i: number) => 1 << (i < mouse ? i : i + 1);
    for (const [name, bit] of Object.entries(INPUT_BIT)) expect(bit, name).toBe(name === 'mouse' ? 1 << mouse : bitOf(controls.indexOf(name)));
  });

  it('the test recordings build the column like the game: held at the sample OR pressed since the one before', () => {
    const ev: InputEvent[] = [[100, 'KeyW', 1], [230, 'KeyL', 1], [260, 'KeyL', 0], [450, 'KeyW', 0]];
    expect(inputMaskAt(ev, 0.1)).toBe(INPUT_BIT.gas);
    expect(inputMaskAt(ev, 0.3)).toBe(INPUT_BIT.gas | INPUT_BIT.head); // a 30 ms tap between two samples still shows, once
    expect(inputMaskAt(ev, 0.4)).toBe(INPUT_BIT.gas);
    expect(inputMaskAt(ev, 0.5)).toBe(0);
  });
});
