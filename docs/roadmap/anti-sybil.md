# Anti-multi-account and Convoy

**Planned. Not built.** This is a development note, not a shipped control and not a legal opinion. Nothing in this file is wired, configured, or enforced.

Today a person can open many wallets. The weekly granted ticket is one per wallet per week. Guests are excluded. 18+ is a checkbox. Country comes from edge headers. Board attention marks, the ten-participant floor, and KYC before a USDC payout are the other brakes that exist or are already specified. They do not prove one person.

## Recommended combo

| Layer | Who it covers | Role |
|---|---|---|
| 1 and 2 | Everyone | Cheap filter and a driving cluster. Bypassable. Not a gate by themselves. |
| 3 and 4 | The weekly granted ticket | Condition for receiving and using that ticket ranked. |
| 5 | Prize winners | Before any USDC payout. Also the tax and sanctions check. |

Purchased rides stay open to a wallet that can pay. Training rides stay unlimited. Convoy, below, waits on the same gates as the weekly ticket.

## 1. Browser fingerprint

**Planned.** FingerprintJS or ThumbmarkJS on every session, including training.

A cheap first filter: the same browser visiting as many wallets. Antidetect browsers and a second machine bypass it. It is a signal for review and for clustering, not a block on its own, and not a condition for a purchased ticket.

Store a stable hash, not a raw vendor payload, and say so in the privacy note before it is switched on.

## 2. Behavioural signals

**Planned.** Cluster identical driving across wallets from the 10 Hz telemetry that verified play already records: input timing and trajectories.

Reuse the existing anti-cheat (`docs/anti-cheat/index.html`, `docs/agents/verified-play.md`): hash-chained batches, human-timing scores, and the 10 Hz replay. A new pass would compare those features across wallets. The pool mark `pool-duplicate-recording` is the same idea inside one pool. This layer extends that comparison past one pool and past one week.

A person who drives two wallets by hand can still look different. A script that replays one trace across wallets should not.

## 3. On-chain signals

**Planned.** For wallets that ask for the weekly granted ticket:

- wallet age
- transaction history
- shared funding source (the same parent wallet paying the fees), for example through Helius

A brand-new empty wallet funded from the same source as a farm is a cluster. A wallet with a long unrelated history is not proof of a person. This layer does not run on training rides.

## 4. Proof of personhood, without a passport

**Planned.** A condition for the weekly granted ticket. Not a passport scan.

Candidates, pick one vendor when this is built: Civic Pass, Solana Attestation Service, World ID, Gitcoin Passport, or the age of a linked X or Discord account.

The ticket is not granted, and cannot be declared ranked, until that check passes. 18+ and prize geo stay. The checkbox and the header country are not this layer.

## 5. KYC before payout

**Planned.** Sumsub, Persona, or Veriff. About $1–2 per check. Only for a prize winner, before USDC is sent.

The same check covers tax and sanctions. Ranked entry does not wait for it. A winner who does not pass stays on the board and the cents are not sent. This matches the prize spec: payout requires KYC, and no vendor is connected.

## Convoy

**Planned. Not built.** A referral. A driver invites a friend. The reward is a cosmetic, an achievement, and TEN4, and only after that friend's first verified paid ride.

- No cash and no USDC.
- No revenue share.
- No extra prize chance and no extra ranked slot.
- A monthly cap on rewards per inviter.
- The same anti-sybil gates as the weekly ticket: layers 3 and 4 before an invite pays, and layer 2 if the two rides match.

A referred wallet that only takes the weekly grant, or only drives training, does not pay the reward. The friend's ride has to be purchased and verified.
