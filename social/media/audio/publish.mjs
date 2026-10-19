// Replace a directory with a finished staging dir. Both must share a parent so the rename stays on one volume.
// The live dir is moved aside first and put back if the swap fails, so a crash never leaves the destination half-written.
import fs from 'node:fs';
export function swapDir(stage, dest) {
  const bak = dest + '.prev';
  fs.rmSync(bak, { recursive: true, force: true });
  const had = fs.existsSync(dest);
  if (had) fs.renameSync(dest, bak);
  try { fs.renameSync(stage, dest); }
  catch (e) { if (had && !fs.existsSync(dest)) fs.renameSync(bak, dest); throw e; }
  fs.rmSync(bak, { recursive: true, force: true });
}
