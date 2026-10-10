---
name: analytics-review
description: >
  Review the landing, whitepaper, lobby, and online ride against Freight Chain's
  PostHog analytics. Three passes: cover new controls, drop events whose UI is
  gone, and keep docs/analytics/index.html in step with the allowlists. Each
  pass writes docs/analytics/updates/<n>.html. Use when asked to review analytics
  coverage, line those pages up with PostHog, or /analytics-review. Does not
  call PostHog and does not change production dashboards.
---

# Analytics review

Three passes over the four pages. Each pass edits the integration where it is wrong, then writes one report. The event rules live in docs/agents/analytics.md "Product analytics" and in `docs/analytics/index.html`. Follow those. This file is the pass, the report, and the production boundary.

```sh
node .claude/skills/analytics-review/inventory.mjs
```

The script reads the allowlists, `track()` / `serverEvent()` call sites, and the explainer. It does not use the network and does not read env files. Exit 0 means those three name the same events, the eyebrow counts match, and no literal property would be stripped. Exit 1 is the work list. Run it at the start of pass 1 and again at the end of pass 3.

## Production stays untouched

A batch that reaches EU ingest changes Activity and any insight that counts that event. This review never sends one.

- Do not run `posthog-test` or `posthog-prod`.
- Do not set `POSTHOG_ENABLED=1` on a process that has the real token. Do not read or print `POSTHOG_KEY`.
- Do not call the PostHog API, open the app, or create, edit, pin, share, or delete an insight or a dashboard. Dashboard 1006663 and the Page speed insight stay as they are. Do not pin `web_vital` to 1006663.
- Do not deploy. Do not change `$create_alias` (docs/agents/analytics.md "Product analytics" → Identity).

Local proof is the inventory script plus the unit specs below. They stub `fetch`.

## The four surfaces

Read the page and the script that paints it. The explainer's tab list and chapter list are claims to check, not the inventory.

| Surface | Open |
|---|---|
| Landing | `landing/index.html`, `landing/src/main.js` |
| Whitepaper | `landing/whitepaper.html`, `landing/src/whitepaper.js` |
| Lobby | `client/lobby.html`, `client/site/lobby.js`, and the `lobby-*.js` modules it loads |
| Gameplay | `client/play.html` with `?ride=` (online). `client/js/main.js`, `client/js/ui/game.js`, `client/js/online.js` |

Shared doors: `client/js/analytics.js` (`track`), `client/js/web-vitals.js`, `client/site/wallet.js`, `client/site/pay.js`. Server facts: `server/src/domain/analytics/client-events.ts`, `server-events.ts`, `server/src/application/services/analytics-events.ts`.

Leave these alone. Say so in the report:

- `play.html` with no `?ride`, `play.html?offline=1`, and `viewer.html` send nothing.
- Verdicts, escrow ticket buys, and live-stream chat, donations, and effects are not analytics events (docs/agents/analytics.md "Not this work"). The watch page is that exclusion.
- No `posthog-js`, no session replay, no second project, no nginx `/ingest/`, no per-heartbeat event.
- The admin page is out of this review. `promo_created` and `promo_disabled` stay server events.

A whitepaper contents link or an in-page anchor is not a new event. A new control the player uses to sign in, buy, start, fail, or leave is.

## What a change touches

A client event that should exist: `track()` at the action, a `CLIENT_EVENTS` name, an `ALLOW` row (integers, booleans, short strings; never a key in `DENIED_PROPERTIES`), a row in the explainer's browser table, and the length assertion in `server/test/unit/domain/analytics/client-events.spec.ts`. Names stay disjoint from `SERVER_EVENTS` (`event-names.spec.ts`).

A client event whose last control is gone: remove the `track()`, the allowlist row, the explainer row, and any funnel step that names it. Update the length assertion and the eyebrow count.

A server event only for a fact the database already commits. Factory in `analytics-events.ts`, `emitAnalytics` after that commit, a `SERVER_EVENTS` name, an explainer row. A removed screen does not remove a server event if the write still happens.

When the explainer changes, set its footer date to the day of the pass. README, AGENTS.md, and CLAUDE.md change only when a sentence that already names an event or a count is now wrong. Do not copy the event list into them.

## The three passes

One invocation is three passes. Finish the report for a pass before the next pass starts. Do not start a fourth.

**Pass 1, coverage.** Run the inventory. Walk each surface and list the controls a player can use. For each one: it already has an event, it needs a client event, it needs a server event because a commit already records it, or it stays silent for a reason above. Apply those edits. Re-run the inventory and fix what it still prints.

**Pass 2, wiring.** Re-read the edits and the four pages. Check the allowlist matches the literals `track()` sends, server emits sit after the commit, funnels name events that still exist, and the eyebrows match the arrays. Fix what pass 1 left inconsistent. Do not add an event pass 1 decided to leave silent.

**Pass 3, confirm.** Run the inventory until it exits 0. Then:

```sh
npm --prefix server run test -- test/unit/domain/analytics test/unit/infrastructure/analytics
```

If a pass edited `landing/` or `client/`, also `npm --prefix landing test` and eslint on the client files touched. Quote the results in the report. Change code only when that run fails because of this review.

## The report

After each pass, write `docs/analytics/updates/<n>.html`. `<n>` is the next integer not already used in that directory (`1.html`, then `2.html`). Never overwrite. Create the directory if it is missing.

Use the explainer's styles: `../../verified-play/style.css` and `../analytics.css`, same fonts as `docs/analytics/index.html`. One page, these parts:

- Eyebrow `Freight Chain · analytics review`, title `Pass k of 3`, file number, date.
- One line on what this pass changed.
- A table: surface, what you found, what you edited (or "no change").
- Events added, events removed, explainer sections edited. Empty is a sentence, not a blank table.
- A callout: production dashboards were not opened, edited, or sent a batch. Name that `posthog-test` and `posthog-prod` were not run.
- What the next pass still has to check. Pass 3 instead says the inventory exit code and the test commands.

Link the explainer and the previous report. Write with elements and text, the same rule as the explainer (no `innerHTML`).
