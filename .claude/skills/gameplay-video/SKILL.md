---
name: gameplay-video
description: Make a short promo video (mp4 <= 15 s + gif <= 20 MB) from REAL Freight Chain gameplay with landing-styled captions, transitions and an end card. Use when asked for a trailer, teaser, promo clip, gif or social video of the game, or to change/extend the intro clip.
---

# gameplay-video

Turns a text description into `video/out/<name>/<name>.mp4` + `.gif` + `contact.jpg`, plus compressed copies `<name>.min.mp4` + `<name>.min.gif` that look like the originals at a fraction of the size, and `<name>.tiny.gif` (whole clip ≤ 500 kB). The footage is the real game (`client/play.html`, headless Chrome, scripted driver), not a mock-up. Harness: `video/` (`make.mjs`, `lib/`, `specs/intro.json` = the worked example).

## Workflow
0. Needs Node ≥ 22, Chrome, and `npm --prefix video install` once (ffmpeg-static downloads its binary on install).
1. **Text → spec.** Read `video/specs/intro.json` and write `video/specs/<name>.json` from the user's description, using only the vocabulary below. Pick scenes that show a *mechanic* (crash, gears, lights, frost, dust), one caption per scene, the end card last.
2. **Preview** (≈1 min): `cd video && npm install` (once) then `node make.mjs specs/<name>.json --preview`. Open `out/<name>-preview/contact.jpg` with Read and check text, cuts and that the scene shows what the caption claims (a crash must actually crash).
3. **Final render** (≈2 min): `node make.mjs specs/<name>.json` (`--keep` keeps the JPEG frames, `--only 3.0-5.4` renders just a time range into `out/<name>-partial/` for testing one scene – it never touches the real clip; `VERBOSE=1` logs every frame's rpm/gear/clutch).
4. **Report** the printed numbers (mp4 seconds + MB, gif MB / width / fps / whether it was trimmed, the two `.min` sizes, the `.tiny.gif` kB + rung), show `contact.jpg`, and say what a human must eyeball: transition punch, caption timing/legibility over busy footage, crash readability, how the gif looks at 640 px. Frames are not judged for "feel" by the script.

Everything is deterministic (virtual clock + seeded `Math.random`): the same spec gives byte-identical files (verified from a fresh checkout), so a fix to one scene does not reshuffle the others.

**Compressed copies** (`lib/encode.mjs` `compress`, `MIN`): every full render also writes `<name>.min.mp4` (H.264 crf 24 from the finished mp4 ≈ 37 % of its size, SSIM ≈ .985) and `<name>.min.gif` (same width / fps / length as the original gif, 128 colours, Bayer dither ≈ 80 % of its size – plain ffmpeg can't do much better without visible loss; no-dither bands the sky, gifsicle `--lossy` was rejected for its npm dependency chain). The originals are never touched. They're made from the finished `.mp4` + `.gif`, not the frames, so `node make.mjs specs/<name>.json --compress` (no capture, seconds) remakes them for an already committed clip, with the same bytes a full render would give. **Tiny gif** (`TINY`): the whole clip in ≤ 500 kB (decimal) for embeds / chats – a ladder from 320 px @ 6 fps down to 160 px @ 4 fps, 32–48 flat colours (no dither: noise costs bytes); the intro lands on 240 px @ 5 fps, 48 colours ≈ 476 kB. Headlines and the end card stay readable, the ticker / gauges don't, and motion is choppy – it's a teaser, not a master. If no rung fits it fails instead of trimming. Not made for `--preview` / `--only`. Use the `.min` files where size matters (landing, README, socials) and the originals as masters.

**Finished clips are committed** (`video/out/<name>/{<name>.mp4, <name>.gif, <name>.min.mp4, <name>.min.gif, <name>.tiny.gif, contact.jpg}`); previews / partials / frames are gitignored. When the user approves a new or changed clip, commit its six files with the spec.

## Limits the harness enforces
- `maxSeconds` (default 15): `loadSpec` rejects a spec whose scene durations add up to more, and the mp4 is re-measured after encoding (`-t` hard stop).
- GIF: the 20 MB limit is on the **.gif file on disk** (`gif.maxMB`). `encodeGif` walks a ladder (640 px/15 fps → 12 fps → smaller/slower) and only then trims the clip; the result line says `TRIMMED to fit`. If the user meant something else by "20 MB uncompressed", ask.
- No audio track (the game's synth audio is muted). If asked for music, add it with `ffmpeg -i x.mp4 -i track.mp3 -shortest …` from `video/node_modules/ffmpeg-static/ffmpeg`; don't bake unlicensed music into the repo.

## Spec vocabulary (`lib/spec.mjs` validates it)
Top level: `name`, `fps` (24), `width`/`height` (1280×720), `maxSeconds`, `gif {maxMB,width,fps}`, `ticker` (scrolling LCD strip text), `scenes[]`.

Scene: `id`, `dur` (s), `route` (`route66|stuart|siberia|brenner|panamerican`), `time` (`day|night|dusk|dawn`), `speed` (m/s, or `[from,to]` ramp), `gear` (omit = chosen from the speed; the driver upshifts by itself at ~2350 rpm with real clutch dips), `lights` (headlights; default on at night), `cab`, `cold` (engine starts at ambient, for frost), `preroll` (s of un-captured game time so frost/dust has built up), `traffic`, `damage` (let hits hurt – needed for a crash), `sway`, `push` (slow zoom-in, 0.08 = 8 %), `grade` (CSS filter string), `transition` (INTO this scene: `"flash"` or `{type,dur}`), `events[]`, `captions[]`, `card`.
- **transition types:** `cut flash flash-red glitch whip zoom dip` (the cut is hidden under the peak; dur ≈ 0.3–0.4 s).
- **events** `{t, do, …}` (t = scene-local seconds): `gear {value}`, `lights {on}`, `cab {on}`, `wipers {mode 0|1|2}`, `washer {on}`, `heater`, `night {on}`, `phase {value}`, `spawn {type,preset,zone,dist,lat}` (see AGENTS.md "Traffic": a `truck`/`slow` spawned `ahead` at ~20 m while driving 25 m/s is a guaranteed direct hit = the ride-over stamp and red flash appear by themselves), `steer {value}`.
- **captions** `{n:"01", at, dur, head, sub}`: typewriter headline + sub line + progress bar, bottom-left.
- **card** (end card, layered over the blurred road): `{title:[line1, accentLine], steps:[3 chips], cta, foot}`.

## House style and copy rules
Look = the landing (`landing/src/style.css` tokens: dash black, amber `#ffcf5a`, needle orange, cream, LCD green ticker, mono type) plus the Solana gradient badge. Keep the arc: *take a paid ride → obstacles → long shift → compete on every route → win prizes → CTA*. Copy must stay consistent with what the product honestly is (landing + AGENTS.md): **Solana devnet build**, finishers share **one weekly SOL pool**, shifts are **30 min** in production; no payout amounts, no "guaranteed", no mainnet claims, no draw/jackpot language (prizes are a top-N split, settlement/payout is not built yet). If the user asks for stronger claims, flag the gap instead of writing it in.

## Extending
- New effect/transition: `draw()` in `video/lib/page.js` (pure function of the video time `T`; never use CSS animations or timers – the clock is virtual). New game action: `fire()` there + add the name to `EVENTS` in `lib/spec.mjs`.
- The page code depends on `window.__game` (client/js/main.js) and the physics rules in `client/js/sim/physics.js` (`input.clutch` is boolean, `shiftT` holds the clutch ≥ .9) – re-run the preview after touching those.
- **Rendering:** capture uses the real GPU (`--use-angle=metal`, macOS) by default. Software GL (SwiftShader) z-fights the road ribbon against the ground, so the asphalt blinks while moving (and night headlight pools flicker); `GPU=0` forces software rendering – don't use it for final renders. If a clip shows flashing road, check this first.
- Output goes to `video/out/` (gitignored). Chrome: `CHROME=/path`, debug port `PORT` (default 9555; `client/tools/cdp.mjs`).
