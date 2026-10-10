import { CHUNK_LEN, FORK, FORK_SWITCH_REACH, LANE0, LW, PATTERNS, SHOULDER, SIDE_LEN, SIGNAL_CROSS, SIGNAL_GREEN, START_ACCESS, START_TURN_R, TAPER, tripRoadOf, type JunctionPattern, type RoadPattern } from './road-rules.js';

/* The ride's road LAYOUT, rebuilt on the server from the seed: a line-for-line port of the generation half of client/js/net/network.js (segments, lane
   layouts, junctions) – no curvature, no world coordinates, no floats beyond + − × ÷: everything the judge needs lives in road coordinates (s along the
   centre line, d across it, + = right). The random stream is the game's own mulberry32, drawn in the same order, so the same seed gives the same road.
   road-drift.spec.ts runs client/js/net/network.js beside this class and compares them. */

/** mulberry32 – the game's seeded PRNG (client/js/util.js) */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** client/js/util.js rnd – the sin hash the game places holes with (V8 in Node and in Chrome compute Math.sin bit for bit alike) */
export function rnd(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const edgeOf = (n: number): number => 4.5 + (n - 1) * LW; // edge-line distance from the centre for n lanes (fractional in a taper)
export const laneLat = (dir: number, i: number): number => dir * (LANE0 + i * LW);

export interface Segment { s0: number; s1: number; nR: number; nL: number; pat: string; prev: Segment; fork?: boolean }
export interface Junction {
  id: string;
  kind: 'start' | 'cross' | 'tee';
  s: number;
  signal: boolean;
  /** the side road's arms: -1 left, 1 right (start: none) */
  arms: readonly number[];
  sideHalf: number;
  mouth: number;
  len: number;
  pad: { a0: number; a1: number; l0: number; l1: number };
}

export class RoadLayout {
  readonly seed: number;
  readonly sA: number;
  readonly Sm: number;
  private readonly rng: () => number;
  private readonly weights: Readonly<Record<string, number>>;
  private readonly segs: Segment[] = [];
  private readonly js: Junction[] = [];
  private genEnd: number;
  private patEnd: number;
  private pat: (RoadPattern & { id: string }) | null = null;
  private nextJ = Number.POSITIVE_INFINITY;
  private jn = 0;
  private readonly queue: string[];

  /** trip: the ride's (Ride.trip) – its layout knobs (road-rules.ts TRIP_ROADS); null / any other = the default layout */
  constructor(seed: number, trip: string | null = null) {
    this.seed = seed >>> 0;
    this.rng = mulberry32(this.seed);
    const road = tripRoadOf(trip);
    this.weights = road.weights;
    this.queue = road.first.slice(1);
    const L = Math.round((Math.PI / 2) * START_TURN_R);
    this.sA = Math.round(START_ACCESS);
    this.Sm = this.sA + L;
    this.genEnd = this.patEnd = this.Sm;
    this.pickPattern(road.first[0]!, 500 + this.rng() * 600); // the depot exit (a plain two-lane road, unless the trip says otherwise)
    this.ensure(this.Sm + 1);
    const halfL = edgeOf(this.segs[0]!.nL) + 0.3, R = L / (Math.PI / 2);
    this.js.unshift({ id: 'j0', kind: 'start', s: this.Sm, signal: false, arms: [], sideHalf: 0, mouth: 0, len: 0, pad: { a0: -(R + 7.5), a1: 4, l0: -(halfL + SHOULDER), l1: R + 2 } });
  }

  /* ───────────── generation: sequential, so the layout depends on the seed alone ───────────── */
  ensure(s: number): void {
    while (this.genEnd < s) this.generate();
  }

  private pickPattern(id?: string, len?: number): void {
    if (!id && this.queue.length) id = this.queue.shift(); // the trip's opening patterns (no draw for the pick)
    if (!id) {
      const w = this.weights, all = Object.keys(PATTERNS), live = all.filter((q) => (w[q] ?? 0) > 0);
      const ks = all.filter((k) => (w[k] ?? 0) > 0 && (k !== this.pat?.id || live.length < 2));
      let x = this.rng() * ks.reduce((a, k) => a + (w[k] ?? 0), 0);
      id = ks[ks.length - 1]!;
      for (const k of ks) if ((x -= w[k] ?? 0) < 0) { id = k; break; }
    }
    const P = PATTERNS[id]!;
    this.pat = { id, ...P };
    this.patEnd = this.genEnd + (len ?? P.len[0] + this.rng() * (P.len[1] - P.len[0]));
  }

  private generate(): void {
    if (this.genEnd >= this.patEnd - 1) this.pickPattern();
    const P = this.pat!, r = this.rng, s0 = this.genEnd;
    let x = r() * P.lanes.reduce((a, l) => a + l[2], 0), lanes = P.lanes[0]!;
    for (const l of P.lanes) if ((x -= l[2]) < 0) { lanes = l; break; }
    let len = P.seg[0] + r() * (P.seg[1] - P.seg[0]);
    if (this.patEnd - (s0 + len) < P.seg[0] * 0.6) len = this.patEnd - s0;
    const prev = this.segs[this.segs.length - 1];
    const seg = { s0, s1: s0 + len, nR: lanes[0], nL: lanes[1], pat: P.id, ...(P.fork ? { fork: true } : {}) } as Segment;
    seg.prev = prev ?? ({ ...seg, nR: 1, nL: 1 } as Segment); // the first stretch widens out of the depot's two-lane road (net/network.js)
    this.segs.push(seg);
    this.genEnd = seg.s1;
    const J = P.junction;
    if (!J) { this.nextJ = Number.POSITIVE_INFINITY; return; }
    const lo = s0 + TAPER + 100, hi = seg.s1 - 120;
    if (!Number.isFinite(this.nextJ)) this.nextJ = s0 + r() * J.gap[0];
    while (this.nextJ < hi) {
      if (this.nextJ < lo) { this.nextJ = lo; continue; }
      this.addJunction(Math.round(this.nextJ), J, seg);
      this.nextJ += J.gap[0] + r() * (J.gap[1] - J.gap[0]);
    }
  }

  private addJunction(s: number, J: JunctionPattern, seg: Segment): void {
    const r = this.rng, kind = r() < J.cross ? 'cross' : 'tee', side = r() < 0.5 ? -1 : 1, signal = r() < J.signal, sl = J.side[Math.floor(r() * J.side.length)]!;
    const sideHalf = edgeOf(sl) + 0.3, mouth = sideHalf + 1.5, halfR = edgeOf(seg.nR) + 0.3, halfL = edgeOf(seg.nL) + 0.3, rr = ([a, b]: readonly [number, number]) => a + r() * (b - a);
    rr(SIGNAL_GREEN); rr(SIGNAL_CROSS); r(); // the signal cycle (green, cross green) and its phase offset: not judged, but drawn from the same stream
    this.js.push({ id: 'j' + ++this.jn, kind, s, signal, arms: kind === 'cross' ? [-1, 1] : [side], sideHalf, mouth, len: SIDE_LEN, pad: { a0: -mouth, a1: mouth, l0: -(halfL + SHOULDER), l1: halfR + SHOULDER } });
  }

  /* ───────────── queries (the same names and answers as net/network.js) ───────────── */
  segAt(m: number): Segment {
    return this.segs[this.segIndex(m)]!;
  }

  private segIndex(m: number): number {
    this.ensure(m + 1);
    const a = this.segs;
    let lo = 0, hi = a.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (a[mid]!.s0 <= m) lo = mid; else hi = mid - 1; }
    return lo;
  }

  /** junctions with lo <= s <= hi, sorted by s */
  near(lo: number, hi: number): Junction[] {
    this.ensure(hi + 1);
    const a = this.js, out: Junction[] = [];
    let i = 0, j = a.length;
    while (i < j) { const mid = (i + j) >> 1; if (a[mid]!.s < lo) i = mid + 1; else j = mid; }
    for (; i < a.length && a[i]!.s <= hi; i++) out.push(a[i]!);
    return out;
  }

  /** lanes per direction at main-road position m (fractional inside a taper) */
  mainXs(m: number): { nR: number; nL: number } {
    const seg = this.segAt(Math.max(m, this.Sm)), t = clamp((m - seg.s0) / TAPER, 0, 1), p = seg.prev;
    return { nR: p.nR + (seg.nR - p.nR) * t, nL: p.nL + (seg.nL - p.nL) * t };
  }

  /** whole lanes a vehicle driving in `dir` has at main-road position m */
  lanes(m: number, dir: number): number {
    const x = this.mainXs(m);
    return Math.max(1, Math.floor((dir > 0 ? x.nR : x.nL) + 1e-6));
  }

  /** the edge lines (left, right) at spine position s */
  edges(s: number): [number, number] {
    const x = s < this.Sm ? { nR: 1, nL: 1 } : this.mainXs(s);
    return [-edgeOf(x.nL), edgeOf(x.nR)];
  }

  /** plain road for road holes: past the start, away from junctions and lane tapers */
  plain(s: number, margin = 60): boolean {
    if (s < this.Sm + margin || this.near(s - margin, s + margin).length) return false;
    const seg = this.segAt(s);
    return s - seg.s0 > TAPER + 10 && seg.s1 - s > 10;
  }

  /** Is (s, d) on a drivable surface? The game's net.onRoad, except around the start junction (its main road behind the turn needs world coordinates):
      there – s below `knownFrom` – the answer is `null`, unknown, and the judge does not count it. */
  onRoad(s: number, d: number): boolean | null {
    if (s > -80 && s < 30 && Math.abs(d) < 34) return true; // depot yard
    const [l, r] = this.edges(s);
    if (d >= l - 0.5 && d <= r + 0.5) return true;
    if (this.forkApron(s) && d >= l - FORK.corridor - 0.5 && d <= r + FORK.corridor + 0.5) return true; // a fork's split / merge: both roads' tarmac (either side – the judge does not know which road the default one is)
    if (s < this.knownFrom) return null;
    for (const j of this.near(s - 90, s + 90)) {
      if (j.kind === 'start') continue;
      const p = j.pad, a = s - j.s;
      if (a >= p.a0 && a <= p.a1 && d >= p.l0 && d <= p.l1) return true;
      if (Math.abs(a) < j.sideHalf + 0.5 && j.arms.includes(Math.sign(d)) && Math.abs(d) < j.len) return true;
    }
    return false;
  }

  /** in the first / last FORK.commit m of a fork, where its two roads are one apron (net.apron) */
  forkApron(s: number): boolean {
    if (s < this.Sm) return false;
    const g = this.segAt(s);
    return g.fork === true && Math.min(s - g.s0, g.s1 - s) < FORK.commit;
  }

  /** Is the forward step from s0 to s1 the one where the game may have moved the truck onto the OTHER road of a fork? Crossing a fork's commit point
      (FORK.commit m after the split; never at the merge) the game re-measures the truck on the road it is nearer to (client/js/net/orchestrator.js
      switchFork): d jumps by the gap between the two roads (≈ 14–19 m) and s by up to ≈ 3 m (always forward). Decided from the layout alone – never from
      the client's word (sample column 15) – so a step can only be excused where the seed put a fork. */
  forkSwitch(s0: number, s1: number): boolean {
    if (!(s1 > s0) || s1 < this.Sm + FORK.commit || s1 - s0 > FORK.commit) return false; // (a step that long is no switch – and the layout is never generated out to a forged s)
    for (let i = this.segIndex(s1); i >= 0; i--) {
      const g = this.segs[i]!, c = g.s0 + FORK.commit;
      if (g.s1 <= s0 - FORK_SWITCH_REACH) break; // every commit point further back lies before this segment's end
      if (g.fork === true && c > s0 - FORK_SWITCH_REACH && c <= s1) return true;
    }
    return false;
  }

  /** below this s the off-road answer needs world coordinates (the start junction's reach in net.onRoad is ±90 m) */
  get knownFrom(): number { return this.Sm + 100; }

  /** chunk index of spine position s */
  static chunkOf(s: number): number { return Math.floor(s / CHUNK_LEN); }

  /** for the drift spec: the generated layout up to s */
  describe(s: number): { segs: { s0: number; s1: number; nR: number; nL: number; pat: string }[]; junctions: { id: string; kind: string; s: number; signal: boolean; arms: readonly number[] }[] } {
    this.ensure(s);
    return {
      segs: this.segs.filter((g) => g.s0 <= s).map((g) => ({ s0: g.s0, s1: g.s1, nR: g.nR, nL: g.nL, pat: g.pat })), // (a fork is pat 'fork')
      junctions: this.js.filter((j) => j.s <= s).map((j) => ({ id: j.id, kind: j.kind, s: j.s, signal: j.signal, arms: j.arms })),
    };
  }
}
