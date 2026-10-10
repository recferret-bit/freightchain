---
name: gameplay-balance
description: >
  Tune Freight Chain's driving feel: gearbox and torque, launch and stall,
  steering and weight, brakes and the parking brake, engine heat, cold-engine
  wear, battery, strain, road holes, traffic density and crashes, off-road,
  the speed governor, and how long a shift takes to complete. Use when the
  user asks to tweak, balance, nerf, buff, or retune how the truck drives,
  how hard a system is, or a CFG / physics constant. Use when the user runs
  /gameplay-balance.
---

# Gameplay balance

Read `references/systems.md` in this folder before you change a number. It names the file that owns each feel. Open that file and read the current value there. A comment on the constant is why it has that value. When this skill, `AGENTS.md`, or the whitepaper disagrees with the file, the file wins.

## What you change

One feel, the smallest set of constants. Words like "twice" and "25% more" apply to the value you just read: halve it, or multiply by 1.25. Report the name, the old value, and the new one.

New tunables go in `client/js/config.js` (`CFG`). A number that already has a `CFG` name stays there. Do not retune a neighbour because it is also scaled for the short dev ride. `STRAIN_TIME`, `FIGHT_TIME`, the climate rates and the battery rates are tuned for that ride; production shifts are much longer (`RIDE_MIN_SECONDS` comment, paid tiers in `server/src/domain/rides/ride-tier.ts`). Say so when the ask is "for a real shift".

## Leave alone unless the user named it

- `CFG.SHAKE_START`, `CFG.SHAKE_MOVING`, `CFG.SHAKE_RPM`, `CFG.START_ENGINE_OFF`.
- tickets, tier prices (there is no in-game currency). Shift *length* on a lobby ride is the server (`FREE_RIDE_SECONDS`, `ride-tier.ts`); `client/js/online.js` overwrites `CFG.RIDE_MIN_SECONDS` and `CFG.COMPLETE_DIST` from the ride payload. Editing only the client constant changes offline `play.html`.
- Verdict timing, dispatch prompts, coverage, human-timing thresholds. Touch the server mirror of a physics constant you actually changed (`references/systems.md` → Mirrors). Do not retune anti-cheat.
- A mesh, a texture, or a sound. Those are `storybook-models` and `game-audio`.
- How the ROAD differs per ride tier (bends, traffic density and behaviour, roadside density, the free run ending itself) – that is `trip-design` (`client/js/trips.js`). Physics stays shared by every tier.

## Check

From `client/`:

```sh
npm run check
```

That is eslint, the bundle, and the headless playthrough: depot turn, gears, the launch matrix, the brake pedal with the engine off, the parking brake. A balance change is supposed to move the trace. Do not put the old value back to make `trace:diff` empty.

The headless driver assigns old `CFG.TRUCK` values for the scripted road, then restores the shipped object and checks launches: 1st and 2nd with gas pull away (including a cold engine), no gas stalls, 6th with gas stalls. If your change makes one of those false, update that assertion only when the new feel is what was asked, and say which check moved.

`npm run check` does not judge feel. From `client/`, `node tools/e2e-chrome.mjs` (`PORT` if 9333 is taken). Read the screenshots. Say what a person should still feel in the cab. Do not deploy.

A browser that has used the F2 panel stores `CFG.TRUCK` in `localStorage` `freightchain.truck` and applies it over the file. Tell the user to reset that panel, or the shipped handling will not show.

When a mirror row applies, run the check that row names (`npm --prefix landing test` for a whitepaper number, the server unit tests only when `ride-rules.ts` or `verdict-rules.ts` changed).

## Report

Constant, old → new, why that one and not its neighbour, what `npm run check` showed, which mirror files you updated, what is still only a feeling.
