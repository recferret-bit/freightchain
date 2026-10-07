// Re-encodes PNG/JPG files as WebP with headless Chrome's own encoder (no native deps):  node tools/to-webp.mjs [--q 0.8] [--og <src> <out.jpg>] <files…>
//   writes <name>.webp next to each input and removes the original; --og crops/scales <src> to a 1200×630 JPEG for og:image (link previews don't all read WebP).
import { launch } from '../../client/tools/cdp.mjs';
import fs from 'node:fs'; import path from 'node:path';
const args = process.argv.slice(2); let q = 0.8, og = null; const files = [];
for (let i = 0; i < args.length; i++) { if (args[i] === '--q') q = +args[++i]; else if (args[i] === '--og') { og = [args[++i], args[++i]]; } else files.push(args[i]); }
const c = await launch({ port: 9356, shotsDir: 'fc-webp' }); const { ev } = c;
const enc = (file, type, quality, size) => ev(`(async () => {
  const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(${JSON.stringify(fs.readFileSync(file).toString('base64'))}), c => c.charCodeAt(0))]));
  const [w, h] = ${JSON.stringify(size ?? null)} ?? [bmp.width, bmp.height], k = Math.max(w / bmp.width, h / bmp.height), cv = new OffscreenCanvas(w, h), g = cv.getContext('2d');
  g.drawImage(bmp, (w - bmp.width * k) / 2, (h - bmp.height * k) / 2, bmp.width * k, bmp.height * k);
  const b = await cv.convertToBlob({ type: ${JSON.stringify(type)}, quality: ${quality} }), r = new FileReader();
  return await new Promise(res => { r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(b); });
})()`);
if (og) { fs.writeFileSync(og[1], Buffer.from(await enc(og[0], 'image/jpeg', 0.85, [1200, 630]), 'base64')); console.log(og[1], fs.statSync(og[1]).size); }
let before = 0, after = 0;
for (const f of files) {
  const out = f.replace(/\.(png|jpe?g)$/i, '.webp'); if (out === f) continue;
  const b64 = await enc(f, 'image/webp', q); fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  before += fs.statSync(f).size; after += fs.statSync(out).size; fs.unlinkSync(f); console.log(path.relative('.', out), fs.statSync(out).size);
}
console.log(`total ${(before / 1024) | 0} KB → ${(after / 1024) | 0} KB`);
c.finish(0);
