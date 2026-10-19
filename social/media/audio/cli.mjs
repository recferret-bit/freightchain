#!/usr/bin/env node
// Sound store tool:
//   node audio/cli.mjs store                 render every effect + score into out/audio/_store and write manifest.json
//   node audio/cli.mjs list                  what the store has
//   node audio/cli.mjs wave <id|file.wav>    waveform + spectrogram PNG, and peak / rms. This is how an agent looks at a sound.
//   node audio/cli.mjs play <id|file.wav>    play it on the speakers (resume the Web Audio context; a suspended context never ends)
//   node audio/cli.mjs game                  the game's mp3s → client/audio/sfx. Decoded with web-audio-api before the live folder is replaced.
// The store is committed and deterministic. A re-run changes no byte. Staging is swapped in only after the whole set is written.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { spawnSync } from 'node:child_process'; import ffmpeg from 'ffmpeg-static';
import crypto from 'node:crypto'; import { GAME_SFX } from './game-sfx.mjs'; import { SR, peak } from './synth.mjs'; import { writeWav, readWav } from './wav.mjs'; import { SFX } from './sfx.mjs'; import { SCORES } from './scores/index.mjs'; import { renderScore } from './music.mjs';
import { swapDir } from './publish.mjs'; import { decodeMp3 } from './decode.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../out/audio/_store'), cmd = process.argv[2], arg = process.argv[3];
const NOTES = { ignition: 'key turn + starter + engine catch, 0.5–0.9 s (dur option)', shift: 'gear lever clunk', crash: 'the impact', 'game-over': 'SHIFT OVER phrase', caption: 'headline beep', tick: 'typewriter tick', slam: 'big-word thump', click: 'dash switch', wiper: 'two wiper sweeps', washer: 'washer spray (dur option)', card: 'end card arpeggio + CTA hit', boom: 'meme boom: sub drop + crushed thump', scratch: 'record scratch', airhorn: 'chip airhorn (da da daaa)', bruh: 'two sagging FM groans', ding: 'notification bell', levelup: 'LEVEL UP arpeggio + chord', riser: 'tension riser (dur option)', wah: 'sad trombone, four notes', tock: 'clock tock (low option)' };
const db = v => v > 1e-8 ? (20 * Math.log10(v)).toFixed(1) : '-inf';
const levels = samples => { if (!samples.length) return 'peak -inf dBFS  rms -inf dBFS'; let p = 0, s = 0; for (const x of samples) { const a = Math.abs(x); if (a > p) p = a; s += x * x; } return `peak ${db(p)} dBFS  rms ${db(Math.sqrt(s / samples.length))} dBFS`; };
function resolveWav(idOrFile) {
  if (idOrFile.startsWith('game:')) {   // the in-game recipe, not the clip store (shift in the store is a different recording from game:shift)
    const id = idOrFile.slice(5), s = GAME_SFX[id]; if (!s) throw new Error(`no game sound "${id}"`);
    const wav = path.join(os.tmpdir(), 'fc-game-sfx', id + '.wav'); writeWav(wav, s.make(), SR); return wav;
  }
  if (idOrFile.endsWith('.wav')) { if (!fs.existsSync(idOrFile)) throw new Error('no such file: ' + idOrFile); return idOrFile; }
  const sfx = path.join(root, 'sfx', idOrFile + '.wav'), music = path.join(root, 'music', idOrFile + '.wav');
  if (fs.existsSync(sfx)) return sfx; if (fs.existsSync(music)) return music;
  throw new Error(`no store sound "${idOrFile}" — node audio/cli.mjs list  (in-game recipes: wave game:<id>)`);
}
const ffmpegRun = (args) => { const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' }); if (r.error || r.status !== 0) throw new Error(r.stderr || r.error?.message || 'ffmpeg failed'); };   // status is null when the process never starts; `if (r.status)` treated that as success

async function game() {
  const out = path.resolve(here, '../../../frontend/client/audio/sfx'), stage = out + '.build';
  fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(stage, { recursive: true });
  const items = {};
  try {
    for (const [id, s] of Object.entries(GAME_SFX)) {
      const b = s.make(), wav = writeWav(path.join(stage, id + '.wav'), b, SR), mp3 = path.join(stage, id + '.mp3');
      ffmpegRun(['-i', wav, '-ac', '1', '-ar', String(SR), '-c:a', 'libmp3lame', '-b:a', '40k', '-map_metadata', '-1', '-fflags', '+bitexact', mp3]);
      const dec = await decodeMp3(mp3), ms = Math.round(b.length / SR * 1000);
      if (dec.rate !== SR || !(dec.peak > 0.05 && dec.peak <= 1) || Math.abs(dec.ms - ms) > 50) throw new Error(`${id}: decoded ${dec.rate} Hz, ${dec.ms.toFixed(0)} ms, peak ${dec.peak.toFixed(3)} — recipe ${ms} ms (mp3 must stay under full scale)`);
      const data = fs.readFileSync(mp3), hash = crypto.createHash('sha1').update(data).digest('hex').slice(0, 8), file = `${id}.${hash}.mp3`;
      fs.writeFileSync(path.join(stage, file), data); fs.rmSync(wav); fs.rmSync(mp3);
      items[id] = { file, vol: s.vol, ms, bytes: data.length };
    }
    fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify({ items }) + '\n');
    swapDir(stage, out);
  } catch (e) { fs.rmSync(stage, { recursive: true, force: true }); throw e; }
  console.log(`${Object.keys(items).length} game sounds, ${Object.values(items).reduce((a, i) => a + i.bytes, 0)} bytes → ${out}`);
}

function store() {
  const stage = root + '.build';
  fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(path.join(stage, 'sfx'), { recursive: true }); fs.mkdirSync(path.join(stage, 'music'), { recursive: true });
  const items = [];
  try {
    for (const [id, s] of Object.entries(SFX)) { const b = s.make(), f = writeWav(path.join(stage, 'sfx', id + '.wav'), b, SR); items.push({ id, kind: id.startsWith('tr-') ? 'transition' : 'sfx', file: path.relative(stage, f), seconds: +(b.length / SR).toFixed(3), note: NOTES[id] ?? 'transition sound (dur option = the transition length)' }); }
    for (const sc of Object.values(SCORES)) { const b = renderScore(sc), f = writeWav(path.join(stage, 'music', sc.id + '.wav'), b, SR); items.push({ id: sc.id, kind: 'music', file: path.relative(stage, f), seconds: +(b.length / SR).toFixed(3), bpm: sc.bpm, bars: sc.bars, note: sc.title + ' – chiptune loop-length score; a clip fits its tempo to the video' }); }
    fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify({ sampleRate: SR, channels: 1, bits: 16, items }, null, 1) + '\n');
    swapDir(stage, root);
  } catch (e) { fs.rmSync(stage, { recursive: true, force: true }); throw e; }
  console.log(`${items.length} sounds → ${root}`);
}

const run = async () => {
  if (cmd === 'game') await game();
  else if (cmd === 'store') store();
  else if (cmd === 'list') {
    const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')); for (const i of m.items) console.log(`${i.kind.padEnd(10)} ${i.id.padEnd(14)} ${String(i.seconds).padStart(6)} s  ${i.note}`);
  } else if ((cmd === 'wave' || cmd === 'play') && arg) {
    const wav = resolveWav(arg), { samples, rate } = readWav(wav);
    console.log(`${wav}  ${samples.length / rate} s  ${rate} Hz  ${levels(samples)}  pcm peak ${peak(samples).toFixed(3)}`);
    if (cmd === 'wave') {
      const png = wav.replace(/\.wav$/, '.png');
      ffmpegRun(['-i', wav, '-filter_complex', '[0:a]showwavespic=s=1400x300:colors=#ffb03a[w];[0:a]showspectrumpic=s=1400x300:legend=0[s];[w][s]vstack', '-frames:v', '1', png]);
      console.log(png);
    } else {
      const { AudioContext } = await import('web-audio-api');
      const ctx = new AudioContext({ sampleRate: rate }); await ctx.resume();
      if (ctx.state !== 'running') throw new Error('no audio output — look instead: node audio/cli.mjs wave ' + arg);
      const buf = ctx.createBuffer(1, samples.length, rate); buf.copyToChannel(samples, 0);
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('playback did not finish')), samples.length / rate * 1000 + 2000);
        src.onended = () => { clearTimeout(t); resolve(); }; src.start();
      });
      await ctx.close();
    }
  } else { console.error('usage: node audio/cli.mjs game | store | list | wave <id|game:id|file.wav> | play <id|game:id|file.wav>'); process.exit(2); }
};
run().catch(e => { console.error(e.message || e); process.exit(1); });
