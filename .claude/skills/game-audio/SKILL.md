---
name: game-audio
description: Make or change Freight Chain's 8-bit / Sega-style sounds – music scores, sound effects, the key + engine-on sound, the engine bed – and the reusable sound store (media/out/audio/_store), or add sound to a promo clip. Use when asked for game / trailer music, a sound effect (crash, gears, ignition…), "add audio to the video", or to extend the sound library.
---

# game-audio

The sound half of the `media/` app (`media/audio/`; the clip half is the `gameplay-video` skill). Everything is **synthesised offline in pure JS** (no samples, no licences, no dependencies): Master System / Mega Drive voices – pulse with duty cycles, triangle, LFSR noise (15-bit and short/metallic), 2-op FM – the same family as the cab radio's PIXEL RALLY station (`client/js/sim/radio.js`). Seeded, so a re-render gives the same WAVs. 32 kHz mono 16-bit.

## Map
- `synth.mjs` – `voice(buf, t0, dur, {wave, f, duty, vol, a d s r, vib, crush, lp, hp, …})`, `mtof/midi`, buffers. `sfx.mjs` – `SFX[id].make(opts)` recipes. `scores/*.mjs` + `music.mjs` – a score (chords, lead lines, drums; tempo-free, 8 bars) → audio. `cues.mjs` – spec + `timeline.json` → what plays when. `mix.mjs` – cues + music + engine bed (pitched by the rpm the capture recorded) + ducking + master. `render.mjs` – writes `out/audio/<name>/{mix,music,sfx,engine}.wav` + `cues.json`. `cli.mjs` – the store.
- `media/out/audio/_store/{sfx,music}/*.wav` + `manifest.json` = the committed library (`npm run media:store` re-renders it, byte-stable).
- **In-game effects** (the real game, not clips): recipes in `media/audio/game-sfx.mjs` (`GAME_SFX`: `{ dur, vol, make }`), `npm run media:game-sfx` → `client/audio/sfx/<id>.<content hash>.mp3` + `manifest.json` (mono 32 kHz mp3, whole set ≤ 120 kB), played by `audio.play('id', vol, rate)` in `client/js/sim/audio.js` (samples download async after the first sound start; a missing one is skipped). Add one: recipe → `audio.play` at the event → rebuild → commit the folder; `npm --prefix media test` checks the files against the recipes and that every `audio.play('…')` id exists. Look at one with `node media/audio/cli.mjs wave <wav>` after writing it with `writeWav`.

## Workflows
- **Add sound to a clip**: add an `audio` block to the spec (all optional; see `audio/spec.mjs`): `ignition {at, dur 0.5–0.9}` (key turn + starter + engine catch), `music {id, start, gain, fadeOut}`, `engine {gain}`, `sfx {gain, mute[], extra[{t, id, gain, dur}]}`. Cues are derived: transition sounds on the cuts, caption beeps/typewriter ticks (`slam` for `look: big`), dash clicks / wipers / washer from `events`, **gear shifts and the crash from `timeline.json`** (what really happened in the footage). Render with `node media/make.mjs specs/<name>.json`; tune only the sound with `--remux` (no capture, seconds); make just the WAVs with `--audio-only`; put the sound on ANY mp4 with `--add-audio file.mp4` (see the mode table in the `gameplay-video` skill – this skill covers the sounds, that one the runs).
- **New sound effect**: a recipe in `sfx.mjs` (keep it short, `fade()` the ends; peaks > 0.9 are scaled down automatically), a line in `NOTES` in `cli.mjs`, then `npm run media:store`. Wire it to a trigger in `cues.mjs` if a spec should get it automatically, or use `audio.sfx.extra`.
- **New score**: a file in `scores/` shaped like `road-rush.mjs`, one line in `scores/index.mjs`, `npm run media:store`. The mix fits its tempo so the 8 bars end with the clip; a long clip plays it several times (as many passes as keep the tempo nearest the score's `bpm`, or `music.repeat`), and every pass but the last swaps the held ending bar for the score's `turn` lead (+ `drums(bar, s, { turn: true })`).
- **Look at a sound** (you can't hear it): `node media/audio/cli.mjs wave <id|file.wav>` writes a waveform + spectrogram PNG – Read it. Check the cue times in `cues.json` against `contact.jpg` / the scene starts. Tell the user what to listen for: level balance music vs. effects, crash punch, whether the ignition length feels right.

## Rules
- Keep the style: Sega / 8-bit, original compositions only (never transcribe a game's tune). No sampled or downloaded audio in the repo.
- Noise comes from the seeded `voice` waves – never `Math.random` in audio code.
- Mux + limits: the video stream is copied, the mp4 stays ≤ 15 s; `.gif` is silent; specs without `audio` render silent exactly as before.
- Lint + tests: `npm --prefix media run lint` · `npm --prefix media test` (22 tests: synth determinism, ignition 0.5–0.9 s, spec validation, cues, mix, **the committed store is current** – `npm run media:store` fixes a drift –, and every make.mjs mode with real ffmpeg, no Chrome). A new recipe / score / mode gets a test there.
