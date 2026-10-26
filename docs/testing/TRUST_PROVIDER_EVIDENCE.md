# Optional trust evidence providers

Both provider paths are off by default. `trust_network_evidence_enabled` and `trust_funding_evidence_enabled` are signed admin settings (0/1), exposed in Settings. Merely adding credentials does not enable a request. They never change TrustScore, a verdict, a payout decision or a rider's eligibility.

After successful wallet or guest sign-in, an opted-in IPinfo lookup receives the transient validated public address. Local/private/invalid addresses are refused. Only ASN, mobile/hosting/anonymous flags and status are retained alongside the existing subnet hash; raw IP, geography and browser data are discarded. Missing subnet hashing disables this lookup too. The same 90-day maximum sign-in retention deletes these facts. Admin player history shows mobile records as excluded from cluster evidence. No ASN cluster or second-signal threshold was invented.

When an admin opens a player's detail, opted-in Helius lookup returns the provider's first-funder evidence. Known exchange funding is labeled excluded from shared-funder evidence. A 404 triggers one transfer page of at most 100 rows; any remaining pagination is explicitly incomplete, and a first funder is never inferred from that page. 403, timeout, invalid data or provider errors produce unavailable, not suspicious. Exact lamports stay decimal strings. Funding evidence is returned for that review only, not stored as a graph or used to write scores.

Transport uses credential headers, fixed HTTPS provider hosts, no redirects/retries, a two-second deadline per request and a 256 KB streamed response cap. A network lookup uses at most one request; funding review at most two. Provider usage is billed by the providers; there is no application-wide spend guarantee or background crawl. The admin UI explicitly labels disabled, unavailable, incomplete, mobile exclusion and exchange exclusion.

Owner follow-up before enabling: configure `IPINFO_TOKEN` with Core access and `HELIUS_API_KEY` with funded-by access, confirm plan quotas and production-origin privacy disclosures, and verify real provider results on authorized accounts. All committed acceptance uses inert responses. Existing deployment env values were not changed. No live provider requests were made.

Automatic policy remains undecided: cluster membership count/window, meaningful transfer threshold, independent second signal, graph depth/page budget and exclusions beyond known mobile networks and exchanges. Wallet API network coverage for the intended devnet test population has not been established. Keep evidence review-only until those decisions and owner live checks are complete. Optional Discord remains disabled; SGT is a separate implementation.

Primary contracts consulted 26 October 2026:

- [IPinfo Core](https://ipinfo.io/developers/core-api) documents ASN plus boolean mobile/hosting/anonymous fields; detailed VPN/Tor distinctions are not inferred from Core.
- [IPinfo authentication](https://ipinfo.io/developers) supports bearer credentials.
- [Helius funded-by](https://www.helius.dev/docs/wallet-api/funded-by) documents first SOL sender, raw integer amount, signature/slot and 404 handling.
- [Helius plan requirements](https://www.helius.dev/docs/wallet-api/overview) distinguish paid funded-by access from public-plan transfers.
- [Helius transfers](https://www.helius.dev/docs/wallet-api/transfers) documents cursor pagination and the 100-row page limit. The API is beta; strict response validation treats drift as unavailable.

Local verification: server 469 files / 2681 tests, PostgreSQL 61 files / 647 tests, final targeted mobile-exclusion HTTP/PG cases, typecheck/OpenAPI generation and coverage census pass. Real Chrome covers disabled/incomplete funding, mobile/exchange exclusions and safe hash display; screenshot inspected. All root check stages passed; the media stage needed an isolated TMPDIR retry after a concurrent agent's shared audio fixture disappeared, then all 35 media tests passed. No provider response in these tests came from a live account.
