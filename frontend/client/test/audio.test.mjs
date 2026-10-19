// Playback rules that used to drop the ignition sample and stack a noise burst on a loaded crash.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

let now = 5;
const resumes = [];
const noiseBuffers = [];
const gains = [];
const sources = [];
const oscillators = [];
const decoded = [];
function param() {
  return { value: 0, setValueAtTime(v) { this.value = v; }, setTargetAtTime(v) { this.value = v; }, exponentialRampToValueAtTime(v) { this.value = v; } };
}
function node() {
  return { to: null, started: false, connect(t) { this.to = t; }, start() { this.started = true; }, stop() {}, disconnect() {}, frequency: param(), gain: param(), playbackRate: param() };
}
class Ctx {
  constructor() { this.destination = { tag: 'dest' }; this.sampleRate = 48000; }
  get currentTime() { return now; }
  resume() { resumes.push(now); return Promise.resolve(); }
  createOscillator() { const n = node(); oscillators.push(n); return n; }
  createBiquadFilter() { return node(); }
  createGain() { const n = node(); gains.push(n); return n; }
  createBuffer(_ch, n) { noiseBuffers.push(n); return { getChannelData: () => new Float32Array(n) }; }
  createBufferSource() { const n = node(); sources.push(n); return n; }
  decodeAudioData() { return new Promise(res => decoded.push(res)); }
}
globalThis.window = globalThis;
globalThis.AudioContext = Ctx;
let manifestOk = false;
let fetches = 0;
globalThis.fetch = async url => {
  fetches++;
  if (!manifestOk) throw new Error('manifest down');
  if (String(url).endsWith('manifest.json')) return { json: async () => ({ items: { start: { file: 'start.mp3', vol: 0.5 }, ui: { file: 'ui.mp3', vol: 0.4 }, crash: { file: 'crash.mp3', vol: 1 }, bump: { file: 'bump.mp3', vol: 0.8 }, stall: { file: 'stall.mp3', vol: 0.7 } } }) };
  return { arrayBuffer: async () => new ArrayBuffer(8) };
};

const { audio } = await import('../js/sim/audio.js');
const flush = () => new Promise(r => setTimeout(r, 0));

describe('sample playback', { concurrency: 1 }, () => {
  test('the creating call resumes, the engine sits on the bus, and a failed manifest is retried', async () => {
    audio.start();
    assert.equal(resumes.length, 1);
    assert.equal(gains[0].to, audio.ctx.destination);   // bus
    assert.equal(gains[1].to, gains[0]);               // engine, not the speakers directly
    await flush();
    assert.equal(audio.loading, null);
    const tried = fetches;
    manifestOk = true;
    audio.start();
    assert.ok(fetches > tried);
    await flush();
    assert.equal(decoded.length, 1);   // start is first in FIRST, so it is the first decode
  });

  test('a play before the buffer arrives is kept for 2 s, and a late one is dropped', async () => {
    assert.equal(audio.play('start', .8, 1.1), false);
    now = 6.5;
    decoded[0]({ tag: 'start' });
    await flush();
    assert.equal(sources.length, 1);
    assert.equal(sources[0].buffer.tag, 'start');
    assert.equal(sources[0].playbackRate.value, 1.1);
    assert.equal(sources[0].to.gain.value, 0.4);   // 0.8 * manifest vol 0.5
    assert.equal(audio.want, null);
    assert.equal(decoded.length, 2);   // the loader has moved on to ui and is waiting
    const n = sources.length;
    now = 10;
    assert.equal(audio.play('ui'), false);
    now = 12.1;
    decoded[1]({ tag: 'ui' });
    await flush();
    assert.equal(sources.length, n);
    assert.equal(audio.want, null);
  });

  test('a loaded crash inside the debounce does not stack the noise, and mute closes the bus', () => {
    audio.bufs.crash = { tag: 'crash' }; audio.vols.crash = 1;
    assert.equal(audio.play('crash'), true);
    const noises = noiseBuffers.length, started = sources.length;
    now += 0.01;
    audio.crash(0.9);
    assert.equal(noiseBuffers.length, noises);
    assert.equal(sources.length, started);   // debounced: the sample is not started again, and the synth is not either
    audio.bufs.stall = { tag: 'stall' }; audio.vols.stall = 1;
    const osc = oscillators.length;
    now += 1;
    audio.stall();
    assert.equal(oscillators.length, osc);
    audio.honk(1);
    assert.equal(gains.at(-1).to, gains[0]);
    audio.muted = true;
    assert.equal(gains[0].gain.value, 0);
    assert.equal(audio.play('crash'), false);
    audio.muted = false;
    assert.equal(gains[0].gain.value, 0.9);
  });
});
