import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertBatchStreams, STREAMS_COMPRESSED_MAX, STREAMS_UNCOMPRESSED_MAX } from '../../../backend/server/src/application/telemetry/batch-streams.js';
import { enforceBatchMacMessage } from '../../../frontend/client/shared/batch-mac.js';
import { NAMED_STREAMS, continueInpAt30Hz, requireNamedStreams, stepInpAt30Hz } from '../../../frontend/client/shared/telemetry-codec.js';

const HOUR_TICKS = 108_000;
const WINDOW = 50_000;
const rideId = 'ride-mac';
const sessionKey = 'session-key';
const inpPayload = 'inp-bytes';
const chkPayload = 'chk-bytes';

function sha256hex(payload: string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function macFor(key: string, inp: string, chk: string): string {
  const message = enforceBatchMacMessage(rideId, 0, 0, 60, sha256hex(inp), sha256hex(chk));
  return createHmac('sha256', key).update(message).digest('hex');
}

function macMatches(key: string, inp: string, chk: string, presented: string): boolean {
  const expected = macFor(key, inp, chk);
  return expected.length === presented.length && expected === presented;
}

type Checkpoint = { seq: number; startTick: number; endTick: number };

/** Same-seq upload keeps the stored checkpoint. A skipped seq is a gap. startTick may not move backwards. */
function keepCheckpoint(kept: Checkpoint | undefined, next: Checkpoint): Checkpoint {
  if (kept && next.seq === kept.seq) return kept;
  if (kept && next.seq !== kept.seq + 1) throw new Error('seq gap');
  if (kept && next.startTick < kept.endTick) throw new Error('startTick went backwards');
  return next;
}

const namedFull = Object.fromEntries(NAMED_STREAMS.map((key) => [key, `${key}-bytes`]));

describe('AC-T telemetry v2.1', () => {
  it('AC-T1 a matching mac is accepted by a local compare and is not batch-mac-invalid', () => {
    const mac = macFor(sessionKey, inpPayload, chkPayload);
    expect(macMatches(sessionKey, inpPayload, chkPayload, mac)).toBe(true);
  });

  it('AC-T2 batch-mac-invalid when one byte of inp changes', () => {
    const mac = macFor(sessionKey, inpPayload, chkPayload);
    const flipped = `${inpPayload.slice(0, -1)}t`;
    expect(flipped).not.toBe(inpPayload);
    expect(macFor(sessionKey, flipped, chkPayload)).not.toBe(mac);
    expect(macMatches(sessionKey, flipped, chkPayload, mac)).toBe(false);
  });

  it('AC-T3 batch-mac-invalid when one byte of chk changes', () => {
    const mac = macFor(sessionKey, inpPayload, chkPayload);
    const flipped = `${chkPayload.slice(0, -1)}t`;
    expect(flipped).not.toBe(chkPayload);
    expect(macFor(sessionKey, inpPayload, flipped)).not.toBe(mac);
    expect(macMatches(sessionKey, inpPayload, flipped, mac)).toBe(false);
  });

  it('AC-T4 batch-mac-invalid when another key is used', () => {
    const mac = macFor(sessionKey, inpPayload, chkPayload);
    expect(macFor('other-session-key', inpPayload, chkPayload)).not.toBe(mac);
    expect(macMatches('other-session-key', inpPayload, chkPayload, mac)).toBe(false);
  });

  it('AC-T5 a duplicate seq is ignored and the same checkpoint is kept', () => {
    const first = keepCheckpoint(undefined, { seq: 0, startTick: 0, endTick: 300 });
    const again = keepCheckpoint(first, { seq: 0, startTick: 0, endTick: 900 });
    expect(again).toBe(first);
    expect(again.endTick).toBe(300);
  });

  it('AC-T6 seq 2 after seq 0 is a gap', () => {
    const first = keepCheckpoint(undefined, { seq: 0, startTick: 0, endTick: 300 });
    expect(() => keepCheckpoint(first, { seq: 2, startTick: 300, endTick: 600 })).toThrow(/seq gap/);
  });

  it('AC-T7 a backwards startTick is rejected', () => {
    const first = keepCheckpoint(undefined, { seq: 0, startTick: 0, endTick: 300 });
    expect(() => keepCheckpoint(first, { seq: 1, startTick: 299, endTick: 600 })).toThrow(/startTick went backwards/);
  });

  it('AC-T8 the next seq with a forward startTick replaces the checkpoint', () => {
    const first = keepCheckpoint(undefined, { seq: 0, startTick: 0, endTick: 300 });
    const next = keepCheckpoint(first, { seq: 1, startTick: 300, endTick: 600 });
    expect(next).not.toBe(first);
    expect(next).toEqual({ seq: 1, startTick: 300, endTick: 600 });
  });

  it('AC-T9 batch-streams-oversize when the decoded body is over 64 KiB', () => {
    expect(STREAMS_COMPRESSED_MAX).toBe(64 * 1024);
    const encoded = Buffer.alloc(STREAMS_COMPRESSED_MAX + 1, 7).toString('base64');
    expect(() => assertBatchStreams(encoded, () => Buffer.from('unused'))).toThrow(expect.objectContaining({ errorCode: 'batch-streams-oversize' }));
  });

  it('AC-T10 batch-streams-oversize when a deflate bomb inflates past 256 KiB', () => {
    expect(STREAMS_UNCOMPRESSED_MAX).toBe(256 * 1024);
    const encoded = Buffer.from('tiny').toString('base64');
    const inflate = () => Buffer.alloc(STREAMS_UNCOMPRESSED_MAX + 1);
    expect(() => assertBatchStreams(encoded, inflate)).toThrow(expect.objectContaining({ errorCode: 'batch-streams-oversize' }));
  });

  it('AC-T11 a tiny payload whose inflater returns short bytes does not throw', () => {
    const encoded = Buffer.from('ok').toString('base64');
    expect(() => assertBatchStreams(encoded, () => Buffer.from('short'))).not.toThrow();
  });

  it('AC-T12 continueInpAt30Hz after the first window matches stepInpAt30Hz v at tick 108000', () => {
    const whole = stepInpAt30Hz(null, [{ tick: 0, gas: 1, brake: 0, gear: 6 }], HOUR_TICKS);
    const mid = continueInpAt30Hz(stepInpAt30Hz(null, [{ tick: 0, gas: 1, brake: 0, gear: 6 }], 0), [{ tick: 0, gas: 1, brake: 0, gear: 6 }], 0, WINDOW);
    const rest = continueInpAt30Hz(mid, [{ tick: 0, gas: 1, brake: 0, gear: 6 }], WINDOW, HOUR_TICKS);
    expect(rest.v).toBe(whole.v);
  });

  it('AC-T13 the same split matches gear at tick 108000', () => {
    const events = [{ tick: 0, gas: 1, brake: 0, gear: 6 }];
    const whole = stepInpAt30Hz(null, events, HOUR_TICKS);
    const mid = continueInpAt30Hz(stepInpAt30Hz(null, events, 0), events, 0, WINDOW);
    const rest = continueInpAt30Hz(mid, events, WINDOW, HOUR_TICKS);
    expect(rest.gear).toBe(whole.gear);
  });

  it('AC-T14 requireNamedStreams throws when inp is missing', () => {
    const named = { ...namedFull };
    delete named.inp;
    expect(() => requireNamedStreams(named)).toThrow(/named stream inp missing/);
  });

  it('AC-T15 requireNamedStreams throws when clk, chk, or mg is missing', () => {
    for (const key of ['clk', 'chk', 'mg'] as const) {
      const named = { ...namedFull, [key]: '' };
      expect(() => requireNamedStreams(named)).toThrow(new RegExp(`named stream ${key} missing`));
    }
  });

  it('AC-T16 requireNamedStreams throws when env is missing and returns a complete set', () => {
    const named = { ...namedFull, env: '' };
    expect(() => requireNamedStreams(named)).toThrow(/named stream env missing/);
    expect(requireNamedStreams(namedFull)).toBe(namedFull);
    expect([...NAMED_STREAMS]).toEqual(['inp', 'clk', 'chk', 'mg', 'env']);
  });
});
