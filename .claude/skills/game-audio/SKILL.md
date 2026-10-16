---
name: game-audio
description: Make or change Freight Chain's 8-bit / Sega-style sounds – music scores, sound effects, sfx, the key + engine-on sound, the engine bed, the reusable sound store (media/out/audio/_store), the in-game mp3s (client/audio/sfx), or sound on a promo clip. Use when asked for game or trailer music, a sound effect, a soundtrack, chiptune, "add audio to the video", or to change media/audio or the sound scripts.
---

# game-audio

The sound half of `media/` (`media/audio/`). Clips are the `gameplay-video` skill. Voices are synthesised offline in `synth.mjs` (no samples, no licences): pulse with duty, triangle, LFSR, 2-op FM. Seeded, so a re-render is the same WAV. 32 kHz mono 16-bit. Same family as the cab radio (`client/js/sim/radio.js`), not the same code. Do not retune the LFSR taps to a datasheet — the store and the game mp3s are checked against this voice.

## Libraries — do not swap these

| job | use | why |
|---|---|---|
| chip voice | `media/audio/synth.mjs` | OscillatorNode has no duty sweep, LFSR, crush, or seeded noise. Tone.js is a browser music graph: not byte-stable, and the game client may not take a dependency past three.js. |
| WAV read / write | `wavefile` (pinned in `media/package.json`) | Spec PCM. `fromScratch` of our int16 is the 44-byte header the store already has. |
| mp3 decode check, and `play` | `web-audio-api` (pure JS, OfflineAudioContext / AudioContext) | A second decoder so a bad lame file never replaces `client/audio/sfx`. `node-web-audio-api` is native; lamejs is a worse encoder than the ffmpeg we already pin. |
| mp3 encode, spectrogram, mux | `ffmpeg-static` (libmp3lame), called from `cli.mjs` and `video/encode.mjs` | Best encoder we can pin. Do not add another. |
| master of a clip | `dcBlock` + the soft knee in `mix.mjs` | A Web Audio biquad highpass at 20 Hz rings at 32 kHz (float32 poles). The knee stays in JS because a WaveShaperNode hard-clips anything outside ±1, and the sum goes past 1. |

Howler, wavesurfer, and Tone stay out. Playback in the game is Web Audio in `client/js/sim/audio.js`. Do not add a package under `client/`.

## Where agents load this file

Canonical file: `.claude/skills/game-audio/SKILL.md`. Claude Code and Grok read that path. Gemini CLI does not; it reads `.agents/skills/game-audio`, which is a symlink to this folder. Edit this file only.

## Map

`synth.mjs` voices and buffers. `wav.mjs` read/write. `sfx.mjs` clip recipes (`SFX[id].make(opts)`). `scores/*.mjs` + `music.mjs` a score → audio. `cues.mjs` spec + `timeline.json` → what plays when. `mix.mjs` cues + music + engine bed + ducking + master. `render.mjs` writes `out/audio/<name>/{mix,music,sfx,engine}.wav` + `cues.json`. `cli.mjs` the store, the game mp3s, `wave`, `play`. `decode.mjs` the mp3 check. `publish.mjs` `swapDir` (the live folder is replaced only when the stage is finished). `game-sfx.mjs` the in-game recipes.

`media/out/audio/_store/` is the committed clip library (`npm run media:store` from the repo root; `npm run store` inside `media/`). In-game: `npm run media:game-sfx` → `client/audio/sfx/<id>.<hash>.mp3` + `manifest.json` (mono 32 kHz, whole set ≤ 120 kB), played by `audio.play('id', vol, rate)` in `client/js/sim/audio.js`. `startRide` calls `audio.start()` before the online await, and that call resumes the context. A `play` whose buffer is not decoded yet is kept for 2 s (the newest one only) and fired when it arrives. `crash()` and `stall()` use the live fallback only while that sample is missing. Mute sets the sample bus to 0. Add one: recipe in `game-sfx.mjs` → `audio.play` at the event → `npm run media:game-sfx` → commit the folder. `npm --prefix media test` checks the files against the recipes, that every `audio.play('…')` id exists, and that each mp3 decodes under full scale. The playback cases live in `client/test/audio.test.mjs`.

## Do

Commands from the **repo root**. Inside `media/` drop the `media/` prefix and the `npm run media --` wrapper (`node make.mjs specs/<name>.json`).

- **Sound on a clip.** Optional `audio` block, validated by `audio/spec.mjs`: `ignition {at, dur 0.5–0.9}`, `music {id, start, gain, fadeOut, repeat}`, `engine {gain}`, `sfx {gain, mute[], extra[{t, id, gain, dur}]}`. A key you omit stays on (ignition 0.8 s, score `road-rush`, engine gain 0.5). `false` turns that part off. Cue gain is applied once in `mix.mjs`. `mute` does not apply to `extra`. A crash cue also plays `game-over` 0.3 s later, so do not add that sting again. Transitions `punch` and `spin` use `tr-zoom` and `tr-whip`. Render: `npm run media -- media/specs/<name>.json`. `--audio-only` with no `timeline.json` has no shift or crash, and the engine holds 1800 rpm. A shift with no `gear`, or a frame with no `rpm`, still plays (gear 3, 1800 rpm). Transition `dur` must be > 0. A washer pairs with the next off event in time; with no off event it is one 0.6 s squirt. `--remux` needs the mp4 and the gif; it checks both before it replaces the audio. Any mp4: `--add-audio file.mp4` (mode table is in `gameplay-video`).
- **New clip effect.** Recipe in `sfx.mjs` (short, `fade()` the ends; peaks over 0.9 are scaled down). A line in `NOTES` in `cli.mjs`. Then `npm run media:store`. Wire it in `cues.mjs` or pass `audio.sfx.extra`. This is not an in-game sound.
- **New score.** A file shaped like `scores/road-rush.mjs`, one line in `scores/index.mjs`, `npm run media:store`. The mix fits tempo so the written passes end with the clip. Every pass but the last uses `turn` instead of the held last bar.
- **In-game effect.** Recipe in `game-sfx.mjs` (pcm ceiling 0.8, so 40 kb/s lame stays at or under full scale; longer than 1.5 s is refused). `npm run media:game-sfx` writes a sibling `.build` dir, decodes every mp3, then swaps. A failed encode leaves the previous `client/audio/sfx/` in place. The truck's engine, reverse beep, and horn are live Web Audio in `audio.js`, not these files. The clip engine bed is `mix.mjs`.
- **Look at a sound** (you cannot hear it). `node media/audio/cli.mjs wave <id>` is the **clip store**. `wave shift` is not the in-game shift. Use `wave game:<id>` for a game recipe (a temp wav + PNG). Read the PNG. The command prints peak and rms. `play` is for a person at the speakers. Say what to listen for: music vs effects, crash punch, ignition length (0.5–0.9 s).

Meme ids, for `audio.sfx.extra`: `boom scratch airhorn bruh ding levelup riser wah tock`. Scores: `road-rush` (default), `bus-stop`, `brainrot`, `uneasy`.

## Rules

- Sega / 8-bit, original only. Never transcribe a game's tune. No sampled or downloaded audio.
- Noise in `media/audio` comes from the seeded `voice` waves. Never `Math.random` there. The live crash fallback and the cab radio use `Math.random` on purpose; do not "fix" them from this skill.
- The video stream is copied. The mp4 stays ≤ 15 s unless the spec sets `maxSeconds`. A gif is silent. A spec with no `audio` block stays silent.
- `npm run media:store` and `npm run media:game-sfx` are the only writers of the committed sounds. Do not hand-edit wavs or mp3s.
- Lint and tests: `npm --prefix media run lint` and `npm --prefix media test` (no Chrome: synth, spec, cues, mix, the store byte for byte, every `make.mjs` mode on ffmpeg, the decoded mp3s). A new recipe or score gets a test there.
- After a voice or recipe change, run the matching writer before the tests. The store test fails closed until `npm run media:store`. The game-sfx test fails closed until `npm run media:game-sfx`.

- **Finished sound for a post** (a score or sfx mix, or a clip's final audio): also copy it to `social/<name>/` (gitignored, repo root) and tell the user the path; the render itself stays in `media/out/audio/<name>/`.
