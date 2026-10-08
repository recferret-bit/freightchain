// Mono 16-bit PCM WAV, no dependencies. Float32 [-1, 1] in, clipped and rounded to 16 bit on the way out.
import fs from 'node:fs';
export function writeWav(file, samples, rate) {
  const n = samples.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  fs.mkdirSync(file.replace(/[^/]*$/, ''), { recursive: true }); fs.writeFileSync(file, b); return file;
}
export function readWav(file) {   // only what writeWav makes (mono, 16 bit)
  const b = fs.readFileSync(file), rate = b.readUInt32LE(24), n = b.readUInt32LE(40) / 2, out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = b.readInt16LE(44 + i * 2) / 32767; return { rate, samples: out };
}
