import { CFG } from './config.js';
import { st } from './state.js';
import { API_BASE } from './hosts.js';

/* Ride recording for the server's verdict (verified play): every input event + a 10 Hz sample of the truck, uploaded in hash-chained batches.
   ONLINE ONLY – recording starts in beginOnline() (online.js) and is a no-op otherwise, so the offline game, the headless trace and the viewer are untouched.
   The server does not re-simulate anything: it checks the chain, that the recording agrees with what was reported, and how human the input timing looks
   (server/src/domain/verdict). Batch shape + canonical text must match server/src/domain/telemetry/ride-batch.entity.ts. */

const rec = { on: false, rideId: '', seq: 0, prevHash: '', t0: 0, acc: 0, wall0: 0, samples: [], inputs: [], queue: [], sealing: Promise.resolve(), sending: null };
const r = (v, p) => Math.round(v / p) * p + 0;   // + 0: never -0 (JSON writes it as 0, the server would hash a different text)

/** One input event: ms since the ride started (wall clock – human timing is measured in real time), the key code or dash button, 1 = down / 0 = up. */
export function recordInput(code, down) {
  if (!rec.on || st.mode !== 'drive') return;
  rec.inputs.push([r(performance.now() - rec.wall0, 0.1), String(code).slice(0, 32), down ? 1 : 0]);
}

/** Called every frame after the sim step: a sample every 1/TELEMETRY_HZ of GAME time, a batch every TELEMETRY_BATCH_SECONDS. */
export function tickTelemetry(dt) {
  if (!rec.on || st.mode !== 'drive') return;
  rec.acc += dt;
  if (rec.acc >= 1 / CFG.TELEMETRY_HZ) { rec.acc = 0; rec.samples.push(sample()); }
  if (st.t - rec.t0 >= CFG.TELEMETRY_BATCH_SECONDS) cut();
}
/** [t, s, d, psi, v, rpm, gear, hull, gas, brake, steer, clutch] – the order the server reads */
const sample = () => [r(st.t, .01), r(st.s, .1), r(st.d, .01), r(st.psi, .001), r(st.v, .01), Math.round(st.rpm), st.gear, r(st.hull, .1), r(st.gas, .01), r(st.brake, .01), r(st.steer, .01), r(st.clutch, .01)];

export function startTelemetry(rideId) {
  Object.assign(rec, { on: true, rideId, seq: 0, prevHash: rideId, t0: st.t, acc: 0, wall0: performance.now(), samples: [], inputs: [], queue: [], sealing: Promise.resolve(), sending: null });
}

/** Seal what is recorded so far into a batch (chained after the previous one) and send. */
function cut() {
  const body = { seq: rec.seq++, prevHash: '', t0: r(rec.t0, .01), t1: r(Math.max(st.t, rec.t0), .01), samples: rec.samples, inputs: rec.inputs };
  rec.t0 = st.t; rec.samples = []; rec.inputs = [];
  rec.sealing = rec.sealing.then(async () => {   // the hash of batch n is the prevHash of n+1, so batches are sealed one after another
    body.prevHash = rec.prevHash;
    const text = JSON.stringify({ seq: body.seq, prevHash: body.prevHash, t0: body.t0, t1: body.t1, samples: body.samples, inputs: body.inputs });
    body.hash = await sha256(text);
    rec.prevHash = body.hash ?? `unhashed-${body.seq}`;
    rec.queue.push(body);
    send();
  });
}

async function sha256(text) {
  const subtle = globalThis.crypto?.subtle;   // missing outside a secure context (plain http on an IP): the server stores the batch but will not trust it
  if (!subtle) return null;
  const digest = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
}

/** Upload the queue in order; a failed upload stays queued and goes with the next batch. 200 and 409 (the ride no longer takes batches) both leave the queue. */
function send() {
  if (rec.sending) return rec.sending;
  rec.sending = (async () => {
    while (rec.queue.length) {
      const b = rec.queue[0];
      let res;
      try { res = await fetch(`${API_BASE}/api/rides/${rec.rideId}/batches`, { method: 'POST', credentials: 'include', signal: AbortSignal.timeout(8000), headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); }
      catch { break; }   // offline / timeout: try again with the next batch
      if (!res.ok && res.status !== 409 && res.status !== 400) break;
      rec.queue.shift();
    }
    rec.sending = null;
  })();
  return rec.sending;
}

/** End of the ride: seal the last partial batch and wait (bounded) until everything is uploaded – called right before /end. */
export async function flushTelemetry() {
  if (!rec.on) return;
  if (rec.samples.length || rec.inputs.length) cut();
  rec.on = false;
  await rec.sealing;
  await send();
  if (rec.queue.length) await send();   // one retry for a batch a flaky network dropped
}

export const telemetry = rec;   // debug / e2e: __game.telemetry
