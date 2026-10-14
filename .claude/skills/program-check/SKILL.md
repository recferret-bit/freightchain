---
name: program-check
description: Check the Solana escrow program (programs/freightchain-pools, Anchor) – reproducible solana-verify build in Docker against the pinned hash, the LiteSVM tests on THAT exact .so, IDL drift, clippy, cargo audit (RustSec), then a security review with the Trail of Bits Solana scanner plus this program's own invariant checklist; read-only on-chain hash comparison after a deploy. Use when the program changes, before a devnet/mainnet deploy, when asked to "verify the contract", "audit / security-check the program", "solana-verify", or to confirm what is deployed matches the repo.
---

# Check the escrow program

Everything here is **local and read-only**: nothing is signed, deployed or written on chain. Deploying the program, `initialize`, pool creation and
`solana-verify verify-from-repo` / `remote submit-job` need the user (their Phantom / upgrade key) – never run them from this skill.
Never touch the global Solana config or `~/.config/solana/id.json`; every RPC call passes an explicit URL.

## 1. The automated gate

```sh
bash .claude/skills/program-check/check.sh          # ~4 min (Docker build under amd64 emulation on Apple Silicon)
bash .claude/skills/program-check/check.sh fast     # no Docker: IDL + tests on the current .so + clippy + audit (~1 min)
```

| stage | tool | fails when |
|---|---|---|
| verifiable build | [`solana-verify`](https://github.com/solana-foundation/solana-verifiable-build) 0.5.2 (Solana Foundation) – clean `cargo build-sbf` in the pinned `solanafoundation/solana-verifiable-build` image for `[workspace.metadata.cli] solana` (4.1.2), SBPF v0 | the build fails, or its hash ≠ `programs/freightchain-pools/verifiable-build.hash` |
| IDL | `anchor idl build` | the committed `idl/freightchain_pools.json` is stale |
| tests | `cargo test` (51: 49 LiteSVM + 2 unit) – they `include_bytes!` `target/deploy/freightchain_pools.so`, so after stage 1 they run **on the verifiable artifact**, the bytes a deploy ships | any test fails |
| lint | `cargo clippy --lib -D warnings` (program code only; the test harness trips `result_large_err` on LiteSVM's error type) | any warning |
| dependencies | [`cargo audit`](https://github.com/rustsec/rustsec) 0.22.2 (RustSec advisory DB) | a vulnerability; `unmaintained` / `unsound` warnings are printed, not fatal (below) |

Install once: `cargo install solana-verify --version 0.5.2 --locked` and `cargo install cargo-audit --version 0.22.2 --locked`; Docker running.

The pin is solana-verify's **executable hash** (sha256 of the `.so` with its trailing zero padding stripped – `sha256sum` of the file gives a different value; compare with `solana-verify get-executable-hash`). `fast` mode warns when `target/deploy` holds other bytes than the pin.

**When the hash changes on purpose** (program code, `Cargo.lock`, the pinned Solana version, the program id): `UPDATE_PIN=1 bash .claude/skills/program-check/check.sh`
and commit `verifiable-build.hash` with the change. A hash change you did not cause = the toolchain is not what you think – stop and find out.
The pin is what makes "the deployed program is this source" checkable by anyone.

**Deploy rule this enforces**: deploy only `target/deploy/freightchain_pools.so` from `solana-verify build`. A local `anchor build --arch v0` gives
different bytes (host toolchain; it was `a89fa844…` vs the verifiable `055e337c…` for the same source on 2026-10-08, before the initialize fix) and would never verify.

**Known `cargo audit` warnings** (2026-10-08, all transitive through `anchor-lang` / Solana crates, none reachable as a vulnerability in the program):
`ansi_term` RUSTSEC-2021-0139, `bincode` 1.3.3 RUSTSEC-2025-0141, `derivative` RUSTSEC-2024-0388, `libsecp256k1` 0.6 RUSTSEC-2025-0161,
`paste` RUSTSEC-2024-0436 (unmaintained) and `rand` 0.7.3 RUSTSEC-2026-0097 (unsound only with a custom logger calling `rand::rng()`; host-side build dependency).
A new one = read it before you dismiss it.

## 2. After a deploy (read-only)

```sh
PROGRAM_ID=<id> RPC_URL=https://api.devnet.solana.com bash .claude/skills/program-check/check.sh onchain
```
`solana-verify get-program-hash` hashes the deployed program data and compares it with the pin. Today the id in `declare_id!` is a placeholder and
nothing is deployed, so this stage cannot pass yet.

**Public verification** (OtterSec verify API, the "Verified" badge on explorers) is the user's call, not this skill's: it needs the repo public on
GitHub, the commit hash, and `solana-verify verify-from-repo -u <devnet url> --program-id <id> --mount-path programs/freightchain-pools --library-name freightchain_pools --commit-hash <sha> https://github.com/<repo>`
which **writes a PDA on chain signed by the upgrade authority** (then `solana-verify -u <devnet url> remote submit-job …`; every solana-verify call needs `-u`, it otherwise reads the global config). Offer it; do not run it.

## 3. Security review (an agent pass, after the gate is green)

1. **Trail of Bits `solana-vulnerability-scanner`** – open source (CC-BY-SA-4.0, `trailofbits/skills`), instructions only (ripgrep over `programs/`, no binaries, no network).
   Six classes: arbitrary CPI, PDA bump canonicalisation, owner checks, signer checks, sysvar spoofing, instruction introspection.
   If it is not installed, ask the user to run `/plugin marketplace add trailofbits/skills` then install `building-secure-contracts` from `/plugin` (it changes their Claude Code config – don't do it for them). Run it on `programs/freightchain-pools/programs/freightchain_pools/src`.
2. **This program's own checklist** – `review-checklist.md` next to this file. Money, rent, the state machine, authority, and the six Sealevel classes the Trail of Bits six do not cover (account-data matching, type cosplay, re-init, duplicate mutable accounts, PDA sharing, closing). Source for those six: `coral-xyz/sealevel-attacks`, the set Anchor's security page points at. Open every instruction in the program module. An instruction you did not open is an incomplete review. The escrow rows (reload after CPI, who a PDA signs for, stored payment keys, direct lamports, the slot-hashes sysvar) are in that file too. ✓ / ✗ with the line. A regex hit is a lead, not a pass. The OWASP Solana Programs Top 10 is unpublished. Do not invent S01–S10.
3. Report findings with file:line and a failing LiteSVM test where one can be written (`tests/common/mod.rs` has the harness). A finding without a reproducing test is "plausible", not "confirmed".

Considered and **not** wired in (2026-10-08): Anchor's built-in fuzzer Crucible (`anchor fuzz`) is Anchor 2.0 only – this is Anchor 1.2.1;
Trident (Ackee) documents Anchor ≤ 0.3x / Solana SDK 2.3 for 0.12 and 0.13 is a release candidate – revisit after an Anchor upgrade;
`crytic/solana-lints` (dylint, nightly Rust, small project) and young static analysers (solsec) – not proven enough to gate on.
The pentest harness (`pentest/scripts/harness.mjs`) emits regex leads for the greppable Sealevel classes, `new_with_signer`, and a direct lamport write. It is not this gate, and a clean lead file is not a clear program.

## Reporting

One line per stage (✓/✗, the hash, test count, audit warnings count), then the review findings ranked by severity. Say plainly what was not checked
(no deploy → no on-chain comparison; the scanner is a pattern pass, not an audit; the program is **not audited**).
