# Owner Tasks: External Accounts, Configurations, Secrets & Manual Actions

> **Purpose:** This is your single consolidated checklist of everything that **requires external accounts, third-party API keys, DNS/Cloudflare setup, wallets, legal/entity registration, or manual decisions/actions from you (the owner)**.
> Legal templates and engineering runbooks exist in the repo; this is not a claim that every implementation, formula or acceptance gate is complete. Current engineering status is tracked in [devnet soft launch](DEVNET_SOFT_LAUNCH.md), [local readiness](../testing/LOCAL_READINESS.md) and [Plan 2](spec-compliance/STATUS.md).

The final merged local gate and full-duration paid ride remain engineering acceptance work. They do not require the owner to run the local suite. After those pass, the owner boundary is external accounts/configuration, publication, physical wallet/device interactions and an explicit deployment request. The separately scheduled $500 event also needs its dedicated fixed-table standings/review/payout acceptance; future TGE weights/allocation/claim UI are not supplied merely by adding credentials.

---

## Phase 1 — Before Pre-season Registration Opens (**Deadline: 2 November 2026**)

### 1.1 Public Channels & Organizer Identity (`PRESEASON_RULES.md` / `PRESEASON_RULES_RU.md`)
Fill in the remaining `[PLACEHOLDER: …]` values in `docs/legal/PRESEASON_RULES.md` and `docs/legal/PRESEASON_RULES_RU.md`:
- [ ] **Organizer name or public handle:** Decide whether to list your real name or your public organizer handle in `PRESEASON_RULES.md` §1 and `PRESEASON_RULES_RU.md` §1.
- [ ] **Contact & Appeals channel:** Create/confirm the support/appeals email or Telegram contact (e.g. `@FreightChainSupport` / `support@freightchain.fun`) for §1, §12, §17, and Part B.
- [ ] **Telegram Channel & Chat:**
  - Create the official public Telegram announcement channel (e.g. `@freightchain_news`) and community group chat (e.g. `@freightchain_chat`).
  - Pin the EN + RU Pre-season Rules in the channel before 2 November.
- [ ] **X Account:** Confirm `@FreightChainSol` is active and publish the pinned **Pre-season Campaign Post** that players will quote/reference with their personal code (`FC-<code>`).
- [ ] **Hosting Provider Name:** Fill in `[PLACEHOLDER: hosting provider]` in `PRESEASON_RULES.md` Part B / `PRESEASON_RULES_RU.md` Part B (e.g. Hetzner / DigitalOcean / AWS).

### 1.2 External API Keys & Bot Credentials (Pre-season Server `.env`)
Check existing key presence first; configure only supported credentials for the intended feature before an authorized deployment (never commit real secrets to git). Local checks have not modified the real production env:
- [ ] **Telegram Bot (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_LOGIN_BOT`, `TELEGRAM_CHANNEL_ID`, `TELEGRAM_GROUP_ID`, `TELEGRAM_WEBHOOK_SECRET`):**
  1. Create a bot via `@BotFather` and run `/setdomain` to bind your production domain for the Telegram Login Widget.
  2. Add the bot as an **Administrator** (with read-members permission) to both the official Telegram channel and group chat.
  3. Record the numeric chat IDs (`-100...`) for both the channel and the group; set the public widget username in `TELEGRAM_LOGIN_BOT`.
  4. Register the HTTPS `/api/airdrop/telegram/webhook` with the configured secret token and verify original group activity on the production origin. Local fixtures do not register it or send Telegram messages.
- [ ] **Admin alerts (`ADMIN_ALERT_TELEGRAM_BOT_TOKEN`, `ADMIN_ALERT_TELEGRAM_CHAT_ID`):** Configure the operator destination separately from campaign membership credentials and verify actual delivery after an authorized deployment. Local outage fixtures do not send alerts.
- [ ] **X Verification (`TWITTERAPI_IO_KEY`):**
  1. Register an account at `https://twitterapi.io`, confirm current pricing/quotas and fund the intended verification budget.
  2. Set `TWITTERAPI_IO_KEY`; the current implementation verifies the follow of `@FreightChainSol` and the submitted public post containing the full personal wallet code. `X_OFFICIAL_USER_ID` and `X_CAMPAIGN_POST_ID` are not supported env keys.
  3. Set a conservative positive `airdrop_x_check_cost_cents` through signed admin Settings after checking current provider charges for all requests per verification. It defaults to 0 (checks unavailable). `airdrop_x_budget_cents` caps durable reservations at 10000 cents; this is not a guarantee of actual provider billing.
- [ ] **Turnstile (`TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY`):** Configure the actual site/domain/action and verify widget success/refusal at the production origin.
- [ ] **Optional network review evidence (`IPINFO_TOKEN`):** Use [IPinfo Core](https://ipinfo.io/developers/core-api), which supplies ASN and mobile/hosting/anonymous flags. Credentials alone do not send sign-in IPs; `trust_network_evidence_enabled` defaults to 0. Enable only after confirming plan quota and privacy setup. Mobile evidence is excluded; no detailed VPN/Tor classification or automatic penalty is inferred.
- [ ] **Optional funding review evidence (`HELIUS_API_KEY`):** [Helius funded-by](https://www.helius.dev/docs/wallet-api/funded-by) needs paid access. `trust_funding_evidence_enabled` defaults to 0; admin player review makes bounded calls only after opt-in. Known exchange funding is excluded; 404/partial history is not suspicion. See [provider evidence handoff](../testing/TRUST_PROVIDER_EVIDENCE.md).
- [ ] **Optional Seeker verification (`SGT_RPC_URL`):** Supply a separate read-only mainnet RPC and complete acceptance with a physical Seeker/current holder. Binary fixture tests do not prove actual device ownership.
- [ ] **Secret Salt for IP Prefix Hashing (`IP_HASH_SECRET`):**
  1. Generate an independent 32-byte random hex secret (`openssl rand -hex 32`) and set `IP_HASH_SECRET`; production requires it, and new-env initialization generates it. Change an old `SIGNIN_RETENTION_DAYS=180` or 0 to 1–90 (default 90).
  2. The privacy migration irreversibly removes old player sign-in raw IP/browser columns; backup copies require separate retention review. Request/access logs remain a distinct security surface permitted raw IP for 30 days; verify deployed log eviction separately. See [sign-in privacy handoff](../testing/SIGNIN_PRIVACY.md).
- [ ] **Optional Discord (future integration):** Keep disabled. The current app has no supported Discord OAuth task or `DISCORD_*` env wiring; this needs implementation and acceptance if later approved, not just credentials.

### 1.3 Cloudflare & Infrastructure Setup (`MASTER_PLAN.md` §12 `G1`, `G12`)
- [ ] **Put Domain Behind Cloudflare Proxy (Orange Cloud):**
  1. Enable **IP Geolocation** in Cloudflare (`Network` → `IP Geolocation: ON`) so `CF-IPCountry` is sent on all requests.
  2. Enable **Managed Transforms → Add visitor location headers** so `cf-region-code` (US state code) is sent on all requests.
  3. Create a **Cloudflare WAF Custom Rule** blocking (`451` / Block) requests from:
     - `UK` (`GB`), `EU/EEA` countries, and sanctioned countries (`CU`, `IR`, `KP`, `SY`) + occupied Ukrainian regions.
- [ ] **Uptime Alert & Daily Off-Server DB Backup:**
  1. Point an external uptime check (Cloudflare / UptimeRobot / BetterStack) at `https://api.<domain>/api/health` with Telegram alerts to your phone.
  2. Configure the daily `pg_dump` cron to push encrypted backups to an off-server bucket (Cloudflare R2 / Backblaze B2 / AWS S3).

- [ ] **Devnet assets and device acceptance:** Authorize publication of the 13 remaining achievement metadata URIs, configure the intended devnet collection/tree/mint key and verify wallet receipts/DAS. Test the actual browser wallet popup and physical phone camera/wallet-app pairing; a physical Seeker/current holder is needed only for the optional SGT claim.
- [ ] **Live services and recovery:** Verify intended SNS/RPC, AI-provider and opt-in analytics delivery with the owner's accounts. Apply the prepared log-retention configuration, verify backup/restore and retention on the actual host, and retain evidence separately from Docker fixtures.

---

## Phase 2 — Before Pre-season Prize Week Opens (**Deadline: 9 November 2026**)

### 2.1 Mainnet Prize Wallet (`$500 USDC`)
- [ ] **Create & Fund the Dedicated Pre-season Prize Wallet (Solana Mainnet):**
  1. Create a fresh Solana mainnet wallet dedicated strictly to the Pre-season prize payout.
  2. Fund it with **`500.00 USDC`** (Solana mainnet) + **`~0.15 SOL`** (for transaction fees and ATA creation rent for up to 20 winners).
  3. Put the public wallet address into `PRESEASON_RULES.md` §11, `PRESEASON_RULES_RU.md` §11, and the Event page banner.

### 2.2 Runtime Admin Settings Verification
- [ ] Configure the supported signed admin event keys: `event_week_start_utc`, `event_last_start_utc`, `event_week_end_utc` as UTC epoch seconds (at least 75 minutes from last start to end); only then enable `event_mode_enabled`. Follow [the as-built campaign checklist](../testing/CAMPAIGN_LOCAL.md) and the event feature-disable decisions in [`DEVNET_PRESEASON.md`](DEVNET_PRESEASON.md) §10.
- [ ] Keep Convoy gifts/rewards and weekly alternatives disabled for the event as specified. `paid_tickets_enabled` is a program/operator control, not a `player.GameSetting`; `event_seed_override` is not implemented as an admin key. The event course uses its persisted reserved event seed. Do not claim these settings were changed by local test fixtures.

---

## Phase 3 — Pre-season Review & Payout (**15–17 November 2026**)

- [ ] **Chainalysis API Key (`CHAINALYSIS_API_KEY`):**
  - Arrange the screening account/tool for the Top-20 winner review. `CHAINALYSIS_API_KEY` is a planned integration label, not a supported server env key; local tests do not establish live screening.
- [ ] **Manual Top-20 Review (Sun 15 Nov 12:00 UTC – Mon 16 Nov 12:00 UTC):**
  - Follow [`DEVNET_PRESEASON.md`](DEVNET_PRESEASON.md) §14 (check 10 Hz verdicts, watch Top-10 replays, check IP-prefix/funding clusters, re-verify TG & X tasks, publish provisional standings).
- [ ] **Handle Appeals (Mon 16 Nov 12:00 UTC – Tue 17 Nov 12:00 UTC):**
  - Review any player appeals submitted within the 24h window.
- [ ] **Execute Mainnet `$500 USDC` Payouts & Publish Report (Tue 17 Nov 2026):**
  - Follow [`DEVNET_PRESEASON.md`](DEVNET_PRESEASON.md) §15 (send `$100 / $70 / $50 / 2×$30 / 5×$20 / 10×$12 USDC`, record tx signatures, and post the Public Payout Report on the site, Telegram, and X).
- [ ] **Serbian Tax Check (Optional / Recommended for Organizer):**
  - Confirm with a local Serbian accountant (`knjigovođa`) the personal tax treatment of the `$500` promotional expense and future company distributions ([`research/operator_entity_options.md`](research/operator_entity_options.md) §7.5).

---

## Phase 4 — Before Season 1 Mainnet Launch (**Target: 11 January 2027**)

> These items are **NOT** needed for the November Devnet Pre-season, but are required before turning on paid tickets (`paid_tickets_enabled = 1`), mainnet prize pools, and the TEN4 token in Season 1.

Before any future economic points snapshot/allocation, agree the task weights. Current Pre-season progress reports 0–3 completed task categories and preserves evidence/points; it grants one event attempt, not TEN4. Future TGE distribution remains a separate milestone.

### 4.1 Legal Entity & Banking / Multisig (`MASTER_PLAN.md` §12 `G4a`)
- [ ] **Register the Operator Legal Entity** (target: by **1 December 2026**; see [`research/operator_entity_options.md`](research/operator_entity_options.md) — e.g. Wyoming/Delaware LLC or BVI/Panama depending on counsel advice for a Serbian tax resident & RF citizen).
- [ ] **Obtain EIN** (if US LLC, via IRS Form SS-4) so the entity can issue Form 1099-MISC (`$2,000` threshold) and sign enterprise DPAs.
- [ ] **Create Squads v4 Multisig (`2-of-3`) on Solana Mainnet:**
  - Set up separate hardware-wallet signers for the Treasury / Prize Pool multisig and record its public address in `TERMS.md` §9.2 and `OFFICIAL_RULES.md`.
- [ ] **Fill Entity Placeholders in `TERMS.md`, `PRIVACY.md`, and `OFFICIAL_RULES.md`:**
  - Replace `[PLACEHOLDER: Company legal name]`, `[PLACEHOLDER: entity type and jurisdiction]`, `[PLACEHOLDER: registered address]`, `[PLACEHOLDER: governing law / venue]`, and support/legal/privacy emails.

### 4.2 External Compliance & Production Providers for Season 1
- [ ] **Didit KYC Account (`DIDIT_API_KEY`, `DIDIT_WEBHOOK_SECRET`, DPA):**
  1. Onboard the registered legal entity with `https://didit.me`.
  2. Sign Didit's Data Processing Agreement (DPA) and configure biometric consent + ID + liveness + AML/sanctions workflow.
- [ ] **Tax Form Provider / Flow (`W-9` / `W-8BEN`):**
  - Configure electronic W-9 / W-8BEN collection and 1099-MISC e-filing provider (e.g. Tax1099 / Track1099 / Stripe Tax or internal encrypted vault).
- [ ] **Helius Production RPC (`HELIUS_API_KEY`):**
  - Upgrade Helius to a mainnet production plan for Solana Pay webhook/RPC indexing and wallet funding-source anti-sybil checks.
- [ ] **PostHog EU Data Processing Agreement:**
  - Sign the online PostHog DPA (EU region) and set project event retention to **12 months**.

### 4.3 Legal Sign-off on `[LAWYER]` Annotations ([`../spec/OPEN.md`](../spec/OPEN.md) §1–2)
Before turning on paid tickets in Season 1, have a gaming/contest & crypto lawyer review and remove the `[LAWYER]` annotations in `docs/legal/TERMS.md`, `docs/legal/PRIVACY.md`, and `docs/legal/OFFICIAL_RULES.md`:
1. **`twitterapi.io` Terms Risk ([`../spec/OPEN.md`](../spec/OPEN.md) #1):** Confirm acceptable risk or fallback for reading public X posts without official X Enterprise API.
2. **US State Skill-Contest & Free-Entry Review ([`../spec/OPEN.md`](../spec/OPEN.md) #2a, #2c):** Confirm the 7-state paid block (`AZ, AR, DE, LA, MT, SC, TN`), the weekly free-ticket entry route, and the 30% free-ticket prize cap (`free_prize_board_cap_bps = 3000`).
3. **Final Sanctions & RU/BY Policy for Season 1 ([`../spec/OPEN.md`](../spec/OPEN.md) #2b):** Decide whether the foreign operator entity in Season 1 keeps `RU`/`BY` excluded from prizes or allows non-sanctioned players after KYC + Chainalysis screening.
4. **TEN4 Utility Token & No-Sale Framing (`TERMS.md` §13):** Confirm jurisdictions where the Season 1 airdrop claim must be geo-blocked.
5. **Dispute Resolution (`TERMS.md` §25–26):** Choose Governing Law and Option A (individual arbitration + batching + 30-day opt-out) vs. Option B (courts only).
