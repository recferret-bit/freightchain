#!/usr/bin/env node
// Sound store tool:  node audio/cli.mjs store            render every sound effect + score into out/audio/_store/{sfx,music}/*.wav and write out/audio/_store/manifest.json
//                    node audio/cli.mjs list             what the store has
//                    node audio/cli.mjs wave <id|file.wav>   save a waveform + spectrogram PNG next to it (to LOOK at a sound; needs nothing but ffmpeg)
// The store is the reusable library (clips pull the same recipes through audio/sfx.mjs / scores/): committed, deterministic, so a re-run changes no byte.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { spawnSync } from 'node:child_process'; import ffmpeg from 'ffmpeg-static';
import crypto from 'node:crypto'; import { GAME_SFX } from './game-sfx.mjs'; import { SR } from './synth.mjs'; import { writeWav } from './wav.mjs'; import { SFX } from './sfx.mjs'; import { SCORES } from './scores/index.mjs'; import { renderScore } from './music.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../out/audio/_store'), cmd = process.argv[2], arg = process.argv[3];
const NOTES = { ignition: 'key turn + starter + engine catch, 0.5–0.9 s (dur option)', shift: 'gear lever clunk', crash: 'the impact', 'game-over': 'SHIFT OVER phrase', caption: 'headline beep', tick: 'typewriter tick', slam: 'big-word thump', click: 'dash switch', wiper: 'two wiper sweeps', washer: 'washer spray (dur option)', card: 'end card arpeggio + CTA hit', boom: 'meme boom: sub drop + crushed thump', scratch: 'record scratch', airhorn: 'chip airhorn (da da daaa)', bruh: 'two sagging FM groans', ding: 'notification bell', levelup: 'LEVEL UP arpeggio + chord', riser: 'tension riser (dur option)', wah: 'sad trombone, four notes', tock: 'clock tock (low option)' };
if (cmd === 'game') {   // the game's own effects: mono 32 kHz mp3 (~40 kb/s), named by content hash so nginx / the app can cache them for good; client/js/sim/sfx.js reads manifest.json
  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/audio/sfx'), tmp = path.join(out, '.tmp'); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
  const items = {};
  for (const [id, s] of Object.entries(GAME_SFX)) {
    const b = s.make(), wav = writeWav(path.join(tmp, id + '.wav'), b, SR), mp3 = path.join(tmp, id + '.mp3');
    const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-ac', '1', '-ar', String(SR), '-c:a', 'libmp3lame', '-b:a', '40k', '-map_metadata', '-1', '-fflags', '+bitexact', mp3], { encoding: 'utf8' });
    if (r.status) { console.error(r.stderr); process.exit(1); }
    const data = fs.readFileSync(mp3), hash = crypto.createHash('sha1').update(data).digest('hex').slice(0, 8), file = `${id}.${hash}.mp3`;
    fs.writeFileSync(path.join(out, file), data); items[id] = { file, vol: s.vol, ms: Math.round(b.length / SR * 1000), bytes: data.length };
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ items }) + '\n');
  console.log(`${Object.keys(items).length} game sounds, ${Object.values(items).reduce((a, i) => a + i.bytes, 0)} bytes → ${out}`);
} else if (cmd === 'store') {
  const items = [];
  for (const [id, s] of Object.entries(SFX)) { const b = s.make(), f = writeWav(path.join(root, 'sfx', id + '.wav'), b, SR); items.push({ id, kind: id.startsWith('tr-') ? 'transition' : 'sfx', file: path.relative(root, f), seconds: +(b.length / SR).toFixed(3), note: NOTES[id] ?? 'transition sound (dur option = the transition length)' }); }
  for (const sc of Object.values(SCORES)) { const b = renderScore(sc), f = writeWav(path.join(root, 'music', sc.id + '.wav'), b, SR); items.push({ id: sc.id, kind: 'music', file: path.relative(root, f), seconds: +(b.length / SR).toFixed(3), bpm: sc.bpm, bars: sc.bars, note: sc.title + ' – chiptune loop-length score; a clip fits its tempo to the video' }); }
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ sampleRate: SR, channels: 1, bits: 16, items }, null, 1) + '\n'); console.log(`${items.length} sounds → ${root}`);
} else if (cmd === 'list') {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')); for (const i of m.items) console.log(`${i.kind.padEnd(10)} ${i.id.padEnd(14)} ${String(i.seconds).padStart(6)} s  ${i.note}`);
} else if (cmd === 'wave' && arg) {
  const wav = arg.endsWith('.wav') ? arg : path.join(root, fs.existsSync(path.join(root, 'sfx', arg + '.wav')) ? 'sfx' : 'music', arg + '.wav'), png = wav.replace(/\.wav$/, '.png');
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-filter_complex', '[0:a]showwavespic=s=1400x300:colors=#ffb03a[w];[0:a]showspectrumpic=s=1400x300:legend=0[s];[w][s]vstack', '-frames:v', '1', png], { encoding: 'utf8' });
  if (r.status) { console.error(r.stderr); process.exit(1); } console.log(png);
} else { console.error('usage: node audio/cli.mjs game | store | list | wave <id|file.wav>'); process.exit(2); }
