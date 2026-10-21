import { AUX_MAX_CHARS, RideBatch, type BatchBody, type InputEvent } from '../../../src/domain/telemetry/ride-batch.entity.js';
import { BadRequestError } from '../../../src/domain/shared/errors.js';
import { hashBatch, INPUT_BIT, recording } from '../../support/recording.js';
import { SAMPLE_INPUT_COL } from '../../../src/domain/telemetry/telemetry-rules.js';

const NOW = new Date(Date.UTC(2036, 9, 8, 12, 0, 0));
const body = (over: Partial<BatchBody> = {}): BatchBody => {
  const b: BatchBody = { seq: 0, prevHash: 'ride-1', t0: 0, t1: 15, samples: [[0, 0, 2.4, 0, 0, 900, 0, 100, 0, 0, 0, 0]], inputs: [[120, 'KeyW', 1] as InputEvent], hash: null, ...over };
  return { ...b, hash: over.hash === undefined ? hashBatch(b) : over.hash };
};

describe('RideBatch', () => {
  it('canonical text has a fixed key order and leaves the hash out, so both sides hash the same bytes', () => {
    const b = body();
    expect(RideBatch.canonical(b)).toBe(`{"seq":0,"prevHash":"ride-1","t0":0,"t1":15,"samples":${JSON.stringify(b.samples)},"inputs":[[120,"KeyW",1]]}`);
    const other: BatchBody = { ...b, hash: 'ignored' };
    expect(RideBatch.canonical(other)).toBe(RideBatch.canonical(b));
  });

  it('aux is hashed after trafficProof, and a missing or oversized aux leaves the old canonical text', () => {
    const b = body();
    const old = `{"seq":0,"prevHash":"ride-1","t0":0,"t1":15,"samples":${JSON.stringify(b.samples)},"inputs":[[120,"KeyW",1]]}`;
    expect(RideBatch.canonical(b)).toBe(old);
    expect(RideBatch.canonical({ ...b, aux: { phone: 1 } })).toBe(`${old.slice(0, -1)},"aux":{"phone":1}}`);
    expect(RideBatch.canonical({ ...b, trafficProof: 'abc', aux: { phone: 1 } })).toBe(`${old.slice(0, -1)},"trafficProof":"abc","aux":{"phone":1}}`);
    const huge = { pad: 'x'.repeat(AUX_MAX_CHARS) };
    expect(RideBatch.canonical({ ...b, aux: huge })).toBe(old);
    expect(RideBatch.accept('ride-1', { ...b, aux: huge }, hashBatch(b), NOW).body.aux).toBeUndefined();
    const withAux = { ...b, aux: { phone: 1 } };
    const auxHash = hashBatch(withAux);
    expect(RideBatch.accept('ride-1', { ...withAux, hash: auxHash }, auxHash, NOW)).toMatchObject({ hashOk: true, body: { aux: { phone: 1 } } });
  });

  it('accepts a batch and verifies the client hash against the server one', () => {
    const b = body();
    const ok = RideBatch.accept('ride-1', b, hashBatch(b), NOW);
    expect(ok.snapshot()).toMatchObject({ rideId: 'ride-1', seq: 0, hashOk: true, samples: 1, inputs: 1, receivedAt: NOW, body: b });
    expect(ok.snapshot().bytes).toBe(RideBatch.canonical(b).length);
    expect(RideBatch.accept('ride-1', b, 'f'.repeat(64), NOW).hashOk).toBe(false); // the client lied (or hashed something else)
    expect(RideBatch.accept('ride-1', body({ hash: null }), hashBatch(b), NOW).hashOk).toBe(false); // no WebCrypto: stored, not trusted
  });

  it('refuses a span that ends before it starts, more samples than 10 Hz allows, and an oversized body', () => {
    expect(() => RideBatch.accept('r', body({ t0: 10, t1: 5 }), 'x', NOW)).toThrow(BadRequestError);
    const dense = body({ t0: 0, t1: 1, samples: Array.from({ length: 30 }, () => [0]) });
    expect(() => RideBatch.accept('r', dense, 'x', NOW)).toThrow(/too many samples/);
    expect(() => RideBatch.accept('r', body({ t0: 0, t1: 1, samples: Array.from({ length: 20 }, () => body().samples[0]!) }), 'x', NOW)).not.toThrow(); // 1 s × 10 × 1.5 + 5
    const big = body({ t0: 0, t1: 40, samples: Array.from({ length: 400 }, () => Array.from({ length: 16 }, () => 1.2345678901234567)) }); // ≈ 120 kB
    expect(() => RideBatch.accept('r', big, 'x', NOW)).toThrow(/too large/);
  });

  it('the replays\' traffic track is OUTSIDE the canonical text (same hash with or without it), kept when sane, DROPPED – never refused – when too big', () => {
    const [b0] = recording('ride-x', { seconds: 10 });
    const traffic = [[0.5, 7, 0, 12, 100.5, -200.2, 1.571, 1], [1, 7, 0, 12, 101.5, -201.2, 1.571, 0]];
    expect(RideBatch.canonical({ ...b0!, traffic } as never)).toBe(RideBatch.canonical(b0!));
    expect(RideBatch.accept('ride-x', { ...b0!, traffic }, hashBatch(b0!), NOW).body.traffic).toEqual(traffic);
    expect(RideBatch.accept('ride-x', { ...b0!, traffic }, hashBatch(b0!), NOW).hashOk).toBe(true);
    const huge = Array.from({ length: 81 }, (_, i) => [i / 2]);
    expect(RideBatch.accept('ride-x', { ...b0!, traffic: huge }, hashBatch(b0!), NOW).body.traffic).toBeUndefined();
  });

  it('the replay columns (clock, switches, inputs) are INSIDE the hashed text – tamper-evident like the rest – and change nothing the verdict measures but the gas edges', () => {
    const [plain] = recording('ride-r', { seconds: 15 }), [replay] = recording('ride-r', { seconds: 15, replay: true });
    expect(replay!.samples.every((r) => r.length === SAMPLE_INPUT_COL + 1)).toBe(true);
    expect(replay!.samples.some((r) => (r[SAMPLE_INPUT_COL]! & INPUT_BIT.gas) !== 0)).toBe(true); // the gas held in long stretches
    expect(RideBatch.canonical(replay!)).toContain(JSON.stringify(replay!.samples));
    expect(replay!.hash).not.toBe(plain!.hash);
    const edited = { ...replay!, samples: replay!.samples.map((r, i) => (i === 3 ? [...r.slice(0, -1), INPUT_BIT.head | INPUT_BIT.mouse] : r)) };
    expect(RideBatch.accept('ride-r', edited, hashBatch(edited), NOW).hashOk).toBe(false); // a click added after the hash was sealed: the server's hash no longer matches
    const a = RideBatch.accept('ride-r', plain!, hashBatch(plain!), NOW), b = RideBatch.accept('ride-r', replay!, hashBatch(replay!), NOW);
    const { gasEdges: plainEdges, ...plainRest } = a.summary, { gasEdges: replayEdges, ...replayRest } = b.summary;
    expect(replayRest).toEqual(plainRest);
    expect(plainEdges).toBeNull();                 // no input column: no opinion
    expect(replayEdges).toBeGreaterThan(0);        // the input column's gas bit (checkInputsAgree holds it against the events)
    expect(b.snapshot().bytes - a.snapshot().bytes).toBeLessThan(150 * 12); // ≈ 10 bytes a sample for the three columns: ~1.5 kB per 15 s batch before gzip
  });

  it('a synthetic recording chains: prevHash of each batch is the hash of the one before, the first one the ride id', () => {
    const batches = recording('ride-9', { seconds: 40, batchSeconds: 15 });
    expect(batches.map((b) => [b.seq, b.t0, b.t1])).toEqual([[0, 0, 15], [1, 15, 30], [2, 30, 40]]);
    expect(batches[0]?.prevHash).toBe('ride-9');
    expect(batches[1]?.prevHash).toBe(batches[0]?.hash);
    expect(batches[2]?.prevHash).toBe(batches[1]?.hash);
    for (const b of batches) expect(hashBatch(b)).toBe(b.hash);
    expect(batches[0]?.samples).toHaveLength(150);
    expect(batches.flatMap((b) => b.inputs).length).toBeGreaterThan(20);
  });
});
