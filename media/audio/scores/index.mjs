// The score library. Add a score: a file here exporting the same shape as road-rush.mjs + a line below; `node media/audio/cli.mjs store` renders it into media/out/audio/_store/music/.
import roadRush from './road-rush.mjs';
export const SCORES = { [roadRush.id]: roadRush };
