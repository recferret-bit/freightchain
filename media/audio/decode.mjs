// Decode an mp3 with the pure-JS Web Audio API (web-audio-api). A second decoder, not ffmpeg, so a bad lame packet fails the build instead of shipping silence.
import fs from 'node:fs';
import { OfflineAudioContext } from 'web-audio-api';
import { SR } from './synth.mjs';

export async function decodeMp3(file) {
  const ctx = new OfflineAudioContext(1, 1, SR);
  const audio = await ctx.decodeAudioData(fs.readFileSync(file));
  const view = audio.getChannelData(0), samples = new Float32Array(view.length);
  samples.set(view);
  let peak = 0; for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  return { rate: audio.sampleRate, samples, peak, ms: samples.length / audio.sampleRate * 1000 };
}
