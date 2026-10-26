import { CFG } from './config.js';
import { st } from './state.js';
import { API_BASE } from './hosts.js';
import { inputBits, maskOf } from './input-bits.js';
import { encodeTrafficProof } from '../shared/traffic-proof.js';
import { batchMacGenesisMessage, batchMacMessage } from '../shared/batch-mac.js';
import { net } from './net/network.js';

/* Ride recording for the server's verdict (verified play): every input event + a 10 Hz sample of the truck, uploaded in hash-chained batches.
   ONLINE ONLY – recording starts in beginOnline() (online.js) and is a no-op otherwise, so the offline game, the headless trace and the viewer are untouched.
   The server checks the chain, re-simulates traffic from the hashed frame evidence, checks the reported driving and measures input timing
   (server/src/domain/verdict). Batch shape + canonical text must match server/src/domain/telemetry/ride-batch.entity.ts. */

const rec = { trafficVersion: 0, sessionKey: null, prevMac: '', frames: [], extra: () => [0, 0], held: new Set(), tapped: 0, trafficOf: () => [], traffic: [], tacc: 0, on: false, rideId: '', seq: 0, prevHash: '', t0: 0, acc: 0, wall0: 0, samples: [], inputs: [], queue: [], sealing: Promise.resolve(), sending: null, refused: null };
const r = (v, decimals) => { if (!Number.isFinite(v)) return 0; const f = 10 ** decimals; return Math.round(v * f) / f; };   // NaN would serialise as null and the server refuses the batch   // the shortest JSON (x / 100, not x * 0.01: no 0.30000000000000004)

/** One input event: ms since the ride started (wall clock – human timing is measured in real time), the key code or dash button, 1 = down / 0 = up.
    `at` = the event's own timeStamp (same clock as performance.now()): when the browser created it, not when a slow frame got round to handling it –
    otherwise a key pressed and released within one long frame reads as a 0 ms hold. */
export function recordInput(code, down, at) {
  if (!rec.on) return;
  if (down) { rec.held.add(code); rec.tapped |= inputBits(code); } else rec.held.delete(code);   // the replay's input column – also while paused, so a key let go in the menu is not held for ever
  if (st.mode !== 'drive') return;
  const t = Number.isFinite(at) && at > 0 ? at : performance.now();
  rec.inputs.push([r(Math.max(0, t - rec.wall0), 1), String(code || 'Unidentified').slice(0, 32), down ? 1 : 0]);   // some OEM / IME keys have no code
}

/** A PHONE event (ui/map.js: its buttons, a pan, a place picked, power / boot, the route lost): recorded with the inputs as `phone:<what>` (≤ 32 chars) so an audit or a
    replay can see what the driver did with the map. It is never held (no mask bit) and the server's verdict ignores these codes (telemetry-rules.ts PHONE_PREFIX). */
export function recordPhone(what, down = 1, at) {
  if (!rec.on || st.mode !== 'drive') return;
  const t = Number.isFinite(at) && at > 0 ? at : performance.now();
  rec.inputs.push([r(Math.max(0, t - rec.wall0), 1), ('phone:' + what).slice(0, 32), down ? 1 : 0]);
}

/** Called every frame after the sim step: a sample every 1/TELEMETRY_HZ of GAME time, a batch every TELEMETRY_BATCH_SECONDS. */
export function tickTelemetry(dt) {
  if (!rec.on || st.mode !== 'drive') return;
  rec.acc += dt;
  const period = 1 / CFG.TELEMETRY_HZ;
  if (rec.acc >= period) { rec.acc -= period; if (rec.acc >= period) rec.acc = 0; rec.samples.push(sample()); }   // keep the remainder: a true 10 Hz at any frame rate
  rec.tacc += dt;
  if (rec.tacc >= 1 / TRAFFIC_HZ) { rec.tacc = 0; rec.traffic.push([r(st.t, 2), ...rec.trafficOf()]); }   // the cars around the truck, for replays (not judged)
  if (st.t - rec.t0 >= (rec.trafficVersion ? 2 : CFG.TELEMETRY_BATCH_SECONDS) || rec.frames.length >= 500) cut();
}
/** [t, s, d, psi, v, rpm, gear, hull, gas, brake, steer, clutch, clock, flags, inputs, fork] – the order the server reads (the verdict uses the first 12; the
    last four are only for spectators' replays (watch.js): the hour of the day, the cab's switches – so a replay shows the lights, wipers, heater and cooling the driver had –,
    the controls held now OR pressed since the last sample (input-bits.js – the replay's yellow input borders) and which road of a fork the truck is on
    (0 / 1 – net/network.js; 0 outside a fork; s and d are measured on that road). Append, never insert. */
const sample = () => { const m = maskOf(rec.held) | rec.tapped; rec.tapped = 0; return [r(st.t, 2), r(st.s, 1), r(st.d, 2), r(st.psi, 3), r(st.v, 2), Math.round(st.rpm), st.gear, r(st.hull, 1), r(st.gas, 2), r(st.brake, 2), r(st.steer, 2), r(st.clutch, 2), ...rec.extra(), m, net.forkAt(st.s)?.choice ?? 0]; };
/** the window lost focus: no key-up will come for what was held (ui/input.js) */
export function releaseInputs() { rec.held.clear(); }

/** µs from the recording's wall0. The minigame timing fields use this axis. */
export function telemetryUs(now = performance.now()) { return Math.round((now - (rec.wall0 || now)) * 1000); }

let mgAux = () => null;
/** Minigames register a reader. The chunk is inside the hashed batch text when present, and omitted entirely otherwise. */
export function setMgAux(fn) { mgAux = fn; }
/* set by ui/game.js (it can see the day/night, wiper and radio state; this module stays below world/ and cockpit/): [clock hour, FLAGS bitmask] */
export const FLAGS = { engine: 1, key: 2, park: 4, head: 8, cab: 16, heater: 32, washing: 64, wipeSlow: 128, wipeFast: 256, radio: 512, rev: 1024, cooler: 2048, phone: 4096 };   // append bits; old recordings keep their meaning

export function startTelemetry(rideId, trafficVersion = 0, sessionKey = null) {
  Object.assign(rec, { on: true, rideId, trafficVersion, sessionKey: sessionKey || null, prevMac: '', frames: [], seq: 0, prevHash: rideId, t0: st.t, acc: 0, tacc: 0, wall0: performance.now(), held: new Set(), tapped: 0, samples: [], inputs: [], traffic: [], queue: [], sealing: Promise.resolve(), sending: null, refused: null });
}

/** Seal what is recorded so far into a batch (chained after the previous one) and send. */
function cut() {
  const body = { seq: rec.seq++, prevHash: '', t0: r(rec.t0, 2), t1: r(Math.max(st.t, rec.t0), 2), samples: rec.samples, inputs: rec.inputs };
  const aux = mgAux(); if (aux) body.aux = aux;   // absent ⇒ the canonical text is unchanged
  if (rec.trafficVersion) body.trafficProof = encodeTrafficProof(rec.frames);
  rec.frames = [];
  const traffic = rec.traffic; rec.t0 = st.t; rec.samples = []; rec.inputs = []; rec.traffic = [];
  rec.sealing = rec.sealing.then(async () => {   // the hash of batch n is the prevHash of n+1, so batches are sealed one after another
    body.prevHash = rec.prevHash;
    const text = JSON.stringify({ seq: body.seq, prevHash: body.prevHash, t0: body.t0, t1: body.t1, samples: body.samples, inputs: body.inputs, ...(body.trafficProof !== undefined ? { trafficProof: body.trafficProof } : {}), ...(body.aux !== undefined ? { aux: body.aux } : {}) });
    body.hash = await sha256(text).catch(() => sha256(text)).catch(() => null);   // one retry, then a failed digest must not stop the chain: the batch goes unhashed (the server hashed it itself; the verdict only flags it)
    rec.prevHash = body.hash ?? `unhashed-${body.seq}`;
    if (rec.sessionKey) {   // no key, or no WebCrypto: stay on v1. A failed MAC must not drop the batch.
      const mac = await signBatch(rec.sessionKey, rec.rideId, body.seq, rec.prevMac, text).catch(() => null);
      if (mac) { body.protocol = 2; body.mac = mac; rec.prevMac = mac; }
    }
    if (traffic.length && text.length + JSON.stringify(traffic).length < TRAFFIC_BODY_BUDGET) body.traffic = traffic;   // beside the hashed text, never in it; dropped rather than risk the 100 kB body limit
    if (!rec.refused) { rec.queue.push(body); send(); }
  }).catch(() => { /* never let one step break the chain of later ones */ });
}

/** HMAC-SHA256 hex of the shared v2.1 message. Null when this page cannot sign (plain http, or a bad key). */
async function signBatch(keyB64, rideId, seq, prevMac, canonical) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof atob !== 'function') return null;
  let raw;
  try { raw = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0)); } catch { return null; }
  if (raw.length !== 32) return null;
  const key = await subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const prev = seq === 0 ? await hmacHex(subtle, key, batchMacGenesisMessage(rideId)) : prevMac;
  if (!prev) return null;
  return hmacHex(subtle, key, batchMacMessage(rideId, seq, prev, canonical));
}

async function hmacHex(subtle, key, message) {
  const sig = new Uint8Array(await subtle.sign('HMAC', key, new TextEncoder().encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(text) {
  const subtle = globalThis.crypto?.subtle;   // missing outside a secure context (plain http on an IP): the server stores the batch but will not trust it
  if (!subtle) return null;
  const digest = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
}

/** Upload the queue in order; a failed upload (network, timeout, 5xx, 429, 401) stays queued and goes with the next batch. Only success acknowledges a batch.
    Other 4xx (including 409 when the recording window closed) mean the server REFUSED the batch: recording stops there and the reason is
    kept in `refused` (the server logs it too: event 'batch-refused', findable by the ride id on the admin page). */
function send() {
  if (rec.sending) return rec.sending;
  rec.sending = (async () => {
    while (rec.queue.length) {
      const b = rec.queue[0];
      let res;
      try { res = await fetch(`${API_BASE}/api/rides/${rec.rideId}/batches`, { method: 'POST', credentials: 'include', signal: AbortSignal.timeout(8000), headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); }
      catch { break; }   // offline / timeout: try again with the next batch
      if (res.ok) { rec.queue.shift(); continue; }
      if (res.status >= 500 || res.status === 429 || res.status === 401 || res.status === 408) break;
      const detail = await res.json().then(j => j.detail ?? j.title, () => '').catch(() => '');
      rec.refused = { seq: b.seq, status: res.status, detail: String(detail ?? '') };
      rec.queue.length = 0; rec.on = false;   // later batches could only fail the chain check: stop recording
    }
    rec.sending = null;
  })();
  return rec.sending;
}

/** End of the ride: seal the last partial batch and upload it – called right before /end, which waits for this at most FLUSH_WAIT_MS (online.js). */
export async function flushTelemetry() {
  if (!rec.on) return;
  if (rec.samples.length || rec.inputs.length || rec.frames.length) cut();
  rec.on = false;
  await rec.sealing;
  await send();
  if (rec.queue.length) await send();   // one quick retry before /end …
  if (rec.queue.length) retryInBackground(Date.now() + GRACE_MS);   // … then keep trying: the server takes batches for a minute after the end and re-judges on each
}
const GRACE_MS = 55_000, RETRY_MS = 5_000;   // < the server's RECORDING_GRACE_MS (60 s)
export const FLUSH_WAIT_MS = 3000;   // /end waits this long for the final upload at most – a player leaving early must not turn a finished shift into 'heartbeat lost'
function retryInBackground(until) {
  setTimeout(async () => { await send(); if (rec.queue.length && Date.now() < until) retryInBackground(until); }, RETRY_MS);
}

/* replays' traffic track (live streams): TRAFFIC_HZ frames [t, …7 numbers per nearby vehicle] per batch, OUTSIDE the canonical (hashed) text –
   keep TRAFFIC_HZ and the budget in step with TRAFFIC_MAX_* in server/src/domain/telemetry/telemetry-rules.ts */
const TRAFFIC_HZ = 2, TRAFFIC_BODY_BUDGET = 90_000;

export const telemetry = rec;   // debug / e2e: __game.telemetry

/** Exact pre-contact state; display-only traffic snapshots cannot substitute for this hashed evidence. */
export function beginTrafficFrame(dt) {
  if (!rec.on || !rec.trafficVersion || !(dt > 0)) return null;
  return [dt, net.clock, st.s, st.d, st.psi, st.tyaw, st.v, st.vel, st.hull, +st.rev, net.forkAt(st.s)?.choice ?? 0, 0];
}
export function endTrafficFrame(frame) { if (frame) { frame[11] = st.hull; rec.frames.push(frame); } }
