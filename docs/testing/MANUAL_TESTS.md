# Manual tests

> **Source of truth:** [docs/spec](../spec/README.md). Wallet, phone and replay checks are specified in [e2e](../spec/e2e.md) and in [replays and streams §2.5](../spec/replays_streams.md) (M-RPL-01…06). This file keeps M-01…M-10.

Flows this suite cannot drive without a real browser, a wallet extension, or a phone. Each row has a mock or a source check in `e2e/` where a local keypair can stand in. TODO: automate when the Puppeteer pass exists.

## M-01 Phantom or Solflare popup on CONNECT

- Where: landing `#connect`, lobby sign-in, blink CONNECT WALLET, admin DEV WALLET is the localhost stand-in.
- Steps: open the landing over http. Click CONNECT WALLET. Approve the message in Phantom or Solflare.
- Expected: the button becomes OPEN THE LOBBY, the chip shows the wallet, `GET /api/me` is 200.
- Mock: `B1-LAND-11` signs with tweetnacl and asserts nonce + verify. The dev admin button (`client/site/dev-wallet.js`) covers localhost admin without an extension.
- TODO: drive the extension popup in the later Puppeteer pass.

## M-02 Phone QR pairing

- Where: landing `?pair=` (32 hex). The page calls `POST /api/auth/pair/:code/claim`.
- Steps: on a desktop, start the pair flow that shows the QR. Open that URL on a phone. Sign in on the phone.
- Expected: the desktop message says the computer is signed in. The phone can be put down.
- Mock: `B1-LAND-27` asserts the claim route is in `landing/src/main.js`.
- TODO: two browsers, one of them a phone viewport, once Puppeteer is in the suite.

## M-03 Pitch deck fullscreen

- Where: pitch deck `#fs`.
- Steps: open the deck, click fullscreen, then leave it.
- Expected: the browser fullscreen API runs. Esc returns to the window.
- Mock: `B1-DECK-07` clicks `#fs` and only checks the hint. happy-dom has no real fullscreen.
- TODO: Puppeteer `requestFullscreen` (headless may still refuse it; record that limit).

## M-04 Device motion / tilt

- Where: pitch deck `#tilt`.
- Steps: open the deck on a phone. Accept the motion permission. Tilt.
- Expected: the tilt layer is visible and follows the phone.
- Mock: `B1-DECK-09` asserts `#tilt` stays hidden on a desktop document.
- TODO: a device, or a Puppeteer permission grant if Chromium exposes one.

## M-05 Solana Pay QR

- Where: lobby paid tier, the QR block from `client/site/qr.js`.
- Steps: with a pool on sale, start a ticket buy and choose the QR path.
- Expected: a Solana Pay URL is shown as a QR. A phone wallet can scan it.
- Mock: block 2 paints the BUY control (`B2-LOBBY-01`) and does not render a real QR.
- TODO: decode the QR in Puppeteer and check the `solana:` URL.

## M-06 signAndSendTransaction for buy_ticket

- Where: lobby BUY on a live pool.
- Steps: connect a wallet that holds local SOL. Buy one ticket. Approve the transaction.
- Expected: the pool vault increases, the lobby shows the ticket, the server order row matches the signature.
- Mock: `B2-API-05` only checks validator health. The full buy is `B2-API-06` (pending) and already exists as Chrome in `server/scripts/e2e-localnet.mjs`.
- TODO: keep the keypair path for CI; keep this row for a human wallet.

## M-07 Blink transaction with a real wallet

- Where: `blink.html` and a dial.to action.
- Steps: paste an action URL, click the transaction button, approve in a wallet.
- Expected: the action POST returns a transaction, the wallet sends it, the card shows the signature.
- Mock: `B1-LOBBY-22` loads `/api/actions/hello` and checks the card text.
- TODO: Puppeteer plus a stub wallet, the way `server/scripts/e2e-blinks.mjs` already does in Chrome.

## M-08 Phone viewport

- Where: lobby and the game.
- Steps: open the lobby at a phone width. Open `play.html`.
- Expected: driving is refused and the live/watch path stays usable. `?desktop=1` is the desktop override the receipt test uses.
- Mock: receipt tests pass `?desktop=1`. There is no phone chrome here.
- TODO: Puppeteer mobile emulation.

## M-09 Solana Pay deep link from a phone

- Where: the same buy as M-05, opened as a link rather than a scanned QR.
- Steps: on a phone with a wallet, tap the Solana Pay link from the lobby.
- Expected: the wallet opens on the transaction. After approval the lobby ticket balance updates.
- Mock: none beyond the BUY control. A deep link needs a phone wallet.
- TODO: automate the URL shape; leave the wallet handoff manual.

## M-10 set_pool_rules from a human wallet

- Where: there is no admin HTTP route. The instruction is `set_pool_rules` in the pool program. The operator command is `node server/scripts/pool-admin.mjs set-pool-rules`.
- Steps: on a local validator with the program deployed, run that CLI with the admin keypair (or sign the same instruction in a wallet UI if one is built later).
- Expected: Config floors change (`paid_tickets_enabled`, bps split, `max_player_share_bps` under 5000). A following `show` prints the new rules.
- Mock: `B2-ADMIN-02` asserts the instruction exists and no admin controller calls it. `B2-ADMIN-03` asserts the CLI command. `B2-ADMIN-04` is the pending live call.
- TODO: the live CLI call, then a wallet UI only if the product grows one.
