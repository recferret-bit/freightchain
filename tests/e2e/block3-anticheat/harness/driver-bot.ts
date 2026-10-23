import { stepAt30Hz as gameStepAt30Hz } from '../../../../frontend/client/shared/physics.js';
import { continueInpAt30Hz as gameContinue, stepInpAt30Hz as gameStep } from '../../../../frontend/client/shared/telemetry-codec.js';
import { continueInpAt30Hz as kernelContinue, stepAt30Hz as kernelStepAt30Hz, stepInpAt30Hz as kernelStep } from '../../../../frontend/shared/index.js';
import { profileOf, type ProfileName } from './profiles.js';

export type Engine = 'game' | 'kernel';

type InpEvent = { tick: number; gas: number; brake: number; gear: number };
type TraceEvent = { tUs: number; code: string; down: boolean; trusted: boolean };
type Longitudinal = {
  v: number;
  gear: number;
  gas: number;
  brake: number;
  clutch: number;
  rpm: number;
  engineOn: boolean;
  park: boolean;
  rev: boolean;
};
type StepFn = (initial: null, inp: readonly InpEvent[], ticks: number) => Longitudinal;
type ContinueFn = (state: Longitudinal, inp: readonly InpEvent[], fromTick: number, toTick: number) => Longitudinal;

const engines: Record<Engine, { stepInpAt30Hz: StepFn; continueInpAt30Hz: ContinueFn; stepAt30Hz: typeof gameStepAt30Hz }> = {
  game: { stepInpAt30Hz: gameStep as StepFn, continueInpAt30Hz: gameContinue as ContinueFn, stepAt30Hz: gameStepAt30Hz },
  kernel: { stepInpAt30Hz: kernelStep as StepFn, continueInpAt30Hz: kernelContinue as ContinueFn, stepAt30Hz: kernelStepAt30Hz },
};

const FRAME_US = 16667;

function humanEdges(): TraceEvent[] {
  const events: TraceEvent[] = [];
  let tUs = 0;
  for (let i = 0; i < 12; i++) {
    events.push({ tUs, code: 'KeyW', down: i % 2 === 0, trusted: true });
    tUs += 40_000 + i * 3000;
  }
  events.push({ tUs, code: 'steer', down: true, trusted: true });
  return events;
}

function trustedEdges(): TraceEvent[] {
  const gaps = [28_000, 47_000, 61_000, 36_000];
  const events: TraceEvent[] = [];
  let tUs = 15_000;
  for (let i = 0; i < gaps.length; i++) {
    events.push({ tUs, code: 'KeyW', down: i % 2 === 0, trusted: true });
    tUs += gaps[i]!;
  }
  return events;
}

function botEdges(): TraceEvent[] {
  return Array.from({ length: 60 }, (_, i) => ({ tUs: FRAME_US * i, code: 'KeyW', down: i % 2 === 0, trusted: false }));
}

function holdsFor(name: ProfileName, holdMs: number): number[] {
  if (name === 'bot-quantized') return Array.from({ length: 60 }, () => holdMs);
  if (name === 'human-like') return Array.from({ length: 12 }, (_, i) => 40 + i * 3);
  return [holdMs, holdMs + 17, Math.max(30, holdMs - 25), holdMs + 40];
}

function traceFor(name: ProfileName): TraceEvent[] {
  if (name === 'human-like') return humanEdges();
  if (name === 'bot-quantized') return botEdges();
  return trustedEdges();
}

export function drive(input: { engine: Engine; profile: ProfileName; ticks: number }): {
  engine: Engine;
  profile: ProfileName;
  ticks: number;
  cpuMs: number;
  state: Longitudinal;
  events: TraceEvent[];
  holdsMs: number[];
} {
  const profile = profileOf(input.profile);
  const engine = engines[input.engine];
  const inp: InpEvent[] = [{ tick: 0, gas: profile.gas, brake: profile.brake, gear: profile.gear }];
  const started = performance.now();
  const state = engine.stepInpAt30Hz(null, inp, input.ticks);
  const cpuMs = performance.now() - started;
  const continued = engine.continueInpAt30Hz(engine.stepInpAt30Hz(null, inp, 0), inp, 0, input.ticks);
  if (continued.v !== state.v || continued.gear !== state.gear) throw new Error(`${input.engine} continueInpAt30Hz diverged from stepInpAt30Hz`);
  return { engine: input.engine, profile: profile.name, ticks: input.ticks, cpuMs, state, events: traceFor(profile.name), holdsMs: holdsFor(profile.name, profile.holdMs) };
}
