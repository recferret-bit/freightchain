---
name: social-fetch
description: >
  Count Freight Chain's public X and YouTube posts and the views on that
  content. Reads @FreightChainSol and @FreightChainGame, repeats the read,
  and drops a partial page, a tombstone, a repost, or a count the second
  source does not support. Use when asked for social totals, post counts,
  video views, or /social-fetch. Prints JSON. Does not edit the README.
---

# Social fetch

From the repo root:

```sh
node .claude/skills/social-fetch/fetch.mjs
node .claude/skills/social-fetch/fetch.mjs --self-test
```

Accounts, the same ones the README links: [X @FreightChainSol](https://x.com/FreightChainSol) and [YouTube @FreightChainGame](https://www.youtube.com/@FreightChainGame). Channel id `UC11gGly1Nzw40_CgSxbNGlg`.

The script prints one JSON object. `views` is a total of the content only when `complete` is true. Otherwise the sum of what was actually read is `coveredViews`, and `note` says what was left out. Do not print `coveredViews` as "all views".

What a pass throws away:

- A short, blocked, or wrong-account page.
- X profile post and follower counts that the two public mirrors do not agree on.
- Duplicate ids, reposts, deleted or unavailable posts, and a view count that is missing or not an integer. Missing is not zero.
- An X view count the status endpoint does not match, beyond 10% or 3 views.
- A pass that lost posts another pass saw, or a view count that fell by half.
- YouTube listings whose video ids do not match across passes.
- A video with no integer `viewCount`, an upcoming premiere, or a grid count more than 5% off the watch page.
- The channel About view total. It lags shorts. It never replaces the sum. If it is higher than the sum, the listing is incomplete and `views` stays null.

Three passes. `daily-tracktion-update` is what writes the README.
