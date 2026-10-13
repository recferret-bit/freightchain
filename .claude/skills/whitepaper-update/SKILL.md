---
name: whitepaper-update
description: >
  Update Freight Chain's public whitepaper (landing/whitepaper.html) in three
  passes: check every claim against the code, cut duplication and AI-sounding
  prose, and add charts and real cab frames inside the gzip budget. Use when
  asked to review, rewrite, or update the whitepaper, or /whitepaper-update.
  Does not deploy.
---

# Whitepaper update

One invocation is three passes. The page is the edit. Do not deploy. Do not start a fourth pass.

Read these before pass 1. They own the rules. Do not copy their facts into this file. Re-read them every run. A pill, a count, and a word like "soon" are claims to check.

- `docs/agents/landing.md` — the whitepaper bullet (budget, no innerHTML, images, the honesty line).
- `landing/test/whitepaper.test.js` — phrases the page must keep, and the image `src` pattern.
- `landing/test/budget.test.js` — the gzip cap.
- `landing/test/wp-scenes.test.js` — the dash cards stay.
- `landing/test/page.test.js` — an unreferenced file in `landing/public/media` fails.
- `README.md` — the status table and the ten-minute path. That is what the site claims today.
- The code those tests name: ride tiers and the finish line, verdict rules, live rules and `liveFeatures`, achievements, the program IDL.

## Who reads it

A player, someone about to put devnet SOL in, and a Solana scout who will spend about five minutes. Colosseum judges a hackathon as a startup: the product works, the founder can say what it is, and a business can be built on it. Open with the status table, the program id, the finish rule, and what the program does not promise. No token section.

If Colosseum Copilot is already signed in, one winner search for skill-prize escrow games and the hackathon judging FAQ is enough. Do not block the edit on that research. Do not write text for a Colosseum form field.

## Parallel, then one editor

Start pass 1 with two read-only looks at once. They do not edit `landing/whitepaper.html`.

1. **Claims.** Every status pill, number, and "this exists" sentence against the code. List what is false, stale, or stronger than the code, with the file that contradicts it. Where a flag's comment and the function disagree, the function wins.
2. **Prose.** The same rule said twice (a table that repeats a figure, a section that repeats the status table). Spelling. AI cadence: stacked "not X, not Y", a tour of the next screen, a slogan header, a lab note ("still to try by hand").

Then one editor applies both lists. Two editors on the HTML will overwrite each other.

## Pass 1 — true, and shorter

Edit `landing/whitepaper.html`. When a phrase locked by `whitepaper.test.js` has to move because the code is different, change the test in the same edit. Badge names and descriptions stay equal to `achievements.ts`. Every `data-live` card the scene test requires stays.

Cut more text than you add. A new figure is a file under `landing/public/media`, referenced from the page. Match the image `src` pattern in `whitepaper.test.js`. Use a real cab frame or a chart of one rule. Do not generate a fake screenshot. Do not print the same numbers in a figure and a table.

Short sentences. A status pill names the network and the limit. A feature that is in the program and has no page says so.

## Pass 2 — read what pass 1 wrote

Re-read the page against the same code. Fix a status row that disagrees with a later section, and a diagram label that disagrees with its paragraph. Fix grammar pass 1 left. Do not paste the cut prose back beside the new figure.

## Pass 3 — prove it

```sh
npm --prefix landing test
npm run landing:build
```

The build must keep `whitepaper.html` inside the gzip cap. Then serve the page and look in Chrome: the abstract and the status table, the cab frames, the new chart, and one escrow figure. Images must decode. The dash cards are canvases. Hover is optional. Fix what the page shows wrong, then re-run the landing test.

## Leave the rest of the repo

Do not rewrite the landing, the lobby, or a Colosseum form. If an edit makes a sentence in `README.md` or `docs/agents/landing.md` false, change that sentence only. Do not add a token, a mainnet date, an audit claim, or a test count you did not just run. Do not print secrets. Do not deploy.

## Reply

What was false, what was cut, what was added, the gzip size from the build, the test result, and what Chrome showed. Name what you did not look at.
