// Mono 16-bit PCM WAV via wavefile. Float32 [-1, 1] in, clipped and rounded to 16 bit (× 32767, so full scale is ±32767).
// fromScratch of that PCM is the canonical 44-byte header — the same bytes the committed store was written with.
import fs from 'node:fs';
import wavefile from 'wavefile';
const { WaveFile } = wavefile;

export function writeWav(file, samples, rate) {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) pcm[i] = Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767);
  const wav = new WaveFile(); wav.fromScratch(1, rate, '16', pcm);
  fs.mkdirSync(file.replace(/[^/]*$/, ''), { recursive: true }); fs.writeFileSync(file, Buffer.from(wav.toBuffer())); return file;
}
export function readWav(file) {
  let wav;
  try { wav = new WaveFile(fs.readFileSync(file)); } catch (e) { throw new Error(`not a wav: ${file} (${e.message})`); }
  const f = wav.fmt;
  if (f.audioFormat !== 1 || f.numChannels !== 1 || f.bitsPerSample !== 16) throw new Error(`need mono 16-bit PCM, got format ${f.audioFormat} ch ${f.numChannels} ${f.bitsPerSample}-bit: ${file}`);
  const raw = wav.getSamples(false), out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw[i] / 32767;
  return { rate: f.sampleRate, samples: out };
}
