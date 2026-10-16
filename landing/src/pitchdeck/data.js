/* Freight Chain pitch deck – the CONTENT: every slide's markup, and the data behind the interactive parts. Author-written constants only (the engine sets them with innerHTML).
   Media paths are absolute: on pitchdeck.<apex> a relative path would resolve against the host's /. */

const A = '/media/pitchdeck/';
export const BADGES = '/badges/';
/* media are LAZY: data-src / data-poster, turned into src by hydrate() (pitchdeck.js) when their slide – or one next to it – is shown; so opening the deck fetches one slide's pictures, not all eight's */
const shot = (src, cls = '', alt = '') => `<figure class="shot ${cls}"><img data-src="${A}${src}" alt="${alt}" decoding="async"></figure>`;
const clip = (src, cls = '') => `<figure class="shot clip ${cls}"><video data-src="${A}${src}" muted playsinline loop preload="none"></video></figure>`;   // promo-clip.mp4 = the promo's 16–24 s, cut once
const pts = items => `<ul class="pts">${items.map(i => Array.isArray(i) ? `<li class="${i[1]}">${i[0]}</li>` : `<li>${i}</li>`).join('')}</ul>`;   // [html, class] for a bullet that does something

/* slide 5 – the on-chain systems. `why` / `fit` show when a card is hovered or tapped; the statuses are honest (HONK is a spec, the pool is devnet). */
const ACH_ICON = `<div class="ach"><div class="ach-stage"></div><div class="ach-cap"><em class="at"></em><b class="an"></b><span class="ad"></span></div></div>`;
const CHAIN = [
  { c: '#14f195', st: 'LIVE LOOKUP', h: 'SNS', big: 'YOU.SOL', p: 'Your Solana Name Service name, when you have one, shows on your profile instead of a wallet string.', small: 'Chain read · 24 h cache',
    why: 'A 44-character address means nothing to a rider. A .sol name is a handle people remember and share.',
    fit: 'Sign-in reads your favourite .sol name from chain, caches it for 24 h, and falls back to the wallet.' },
  { c: '#ffcf5a', st: 'DEVNET · NOT AUDITED', h: 'Escrow', big: '70 / 20 / 10', p: 'An Anchor program holds every pool. Prizes go only to attested rides. A missed goal refunds everyone.', small: '14 instructions · 12 events',
    why: 'A prize pool only works if nobody can run off with it, not even us. The money has to sit where we cannot touch it.',
    fit: 'Tickets pay the program. The server can only attest rides. Winners are committed as a root, then paid by Merkle proof; a missed goal refunds.' },
  { c: '#ff5a4d', st: 'MOCK OR DEVNET SOL', h: 'Donations', big: 'NIGHT · SINKHOLE', p: 'Spectators of a live ride can chat and donate to turn day to night or open a hole ahead. One effect per 20 s.', small: 'Applied by the driver\'s game',
    why: 'Watching should be a way to play. A donation turns a quiet stream into an event, and the stream is our ad.',
    fit: 'A donation reaches the driver\'s game in about 4 s; the replay shows it ~25 s behind. Chat and effects ride the same ride feed.' },
  { c: '#b98cff', st: 'BUILT', h: 'Soulbound NFTs', big: '31 BADGES', p: 'Earned from verified rides. Compressed NFTs, frozen in your wallet.', extra: ACH_ICON,
    why: 'Reputation you cannot buy. A badge proves what you actually drove, and it cannot be sold or lent.',
    fit: 'Unlocks are append-only. A separate key mints them later, after a re-check that skips rejected rides. Frozen means nobody can thaw them.' },
  { c: '#ffffff', st: 'SPEC · NOT LIVE', h: 'TEN4', big: '100M CAP', p: 'A capped coin, minted only for the distance a verified paid ride reached: 20, 50 and 100 % checkpoints. HONK stays the chat-line verb.', small: 'Ledger points until launch · not a chain mint',
    why: 'A reason to keep driving beyond the prize pool: a score that is yours, and a currency to spend on the cab.',
    fit: 'Minted only on verified paid rides. Burn 1 in chat, 65 / 260 for cab visuals. SOL still buys tickets; the pool maths never change.' },
  { c: '#6fb0ff', st: 'DEVNET · PUBLIC', h: 'Blinks', big: 'BUY IN A LINK', p: 'Solana Actions turn a link into a ticket purchase, in any client that can show a Blink.', small: '/actions.json · /api/actions',
    why: 'Selling a ticket should take one tap from wherever people already are: a post, a chat, a link.',
    fit: 'Solana Actions endpoints answer with one program-mode ticket to sign. 𝕏 unfurling waits for the Blinks registry listing.' },
];
const chainCard = c => `<article class="cc" style="--c:${c.c}"><span class="st">${c.st}</span><h3>${c.h}</h3><div class="big">${c.big}</div><p>${c.p}</p>${c.extra ?? `<small>${c.small}</small>`}<div class="more"><h4>Why</h4><p>${c.why}</p><h4>How it fits</h4><p>${c.fit}</p></div></article>`;

/* the 31 soulbound badges (names and rules from server/src/domain/achievements/achievements.ts) – the NFT card shows them one at a time */
export const ACH = [
  ['first-mile', 'First Mile', 'Start your first ride.'], ['first-mile-2', 'Regular Hauler', 'Start 10 rides.'], ['first-mile-3', 'Road Dog', 'Start 50 rides.'], ['first-mile-4', 'Asphalt Legend', 'Start 250 rides.'],
  ['shift-complete', 'Shift Complete', 'Finish a paid shift.'], ['shift-complete-2', 'Shift Worker', 'Finish 5 paid shifts.'], ['shift-complete-3', 'Company Driver', 'Finish 25 paid shifts.'], ['shift-complete-4', 'Cargo Captain', 'Finish 100 paid shifts.'],
  ['night-owl', 'Night Owl', 'Finish a shift driven mostly in the dark.'], ['night-owl-2', 'Moonlighter', 'Finish 5 night shifts.'], ['night-owl-3', 'Graveyard Shift', 'Finish 20 night shifts.'], ['night-owl-4', 'Lord of the Dark', 'Finish 50 night shifts.'],
  ['century', 'Century', 'Drive 100 km in total.'], ['century-2', 'Five Hundred Club', 'Drive 500 km in total.'], ['century-3', 'Cross-Continental', 'Drive 2,000 km in total.'], ['century-4', 'Odometer Legend', 'Drive 10,000 km in total.'],
  ['clean-run', 'Clean Run', 'Finish a shift without a scratch.'], ['clean-run-2', 'Spotless', 'Finish 5 shifts without a scratch.'], ['clean-run-3', 'Untouchable', 'Finish 20 shifts without a scratch.'], ['clean-run-4', 'Mirror Finish', 'Finish 50 shifts without a scratch.'],
  ['cold-start', 'Cold Start', 'Finish a Trans-Siberian shift.'], ['cold-start-2', 'Permafrost Hauler', 'Finish 5 Siberian shifts.'], ['cold-start-3', 'Ice Road King', 'Finish 15 Siberian shifts.'], ['cold-start-4', 'Siberian Legend', 'Finish 40 Siberian shifts.'],
  ['on-my-own', 'On My Own', 'Complete a free ride without assist.'], ['on-my-own-2', 'No Training Wheels', 'Complete 5 free rides without assist.'], ['on-my-own-3', 'Hands of Steel', 'Complete 20 free rides without assist.'], ['on-my-own-4', 'Pure Driver', 'Complete 50 free rides without assist.'],
  ['free-easy', 'Learner\'s Permit', 'Clear the EASY free run.'], ['free-crossroads', 'Crossroads', 'Clear the MEDIUM free run.'], ['free-hard', 'Long Haul', 'Clear the HARD free run.'],
];
const TIER = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];
export const achTier = id => id.startsWith('free-') ? 'LICENCE' : TIER[(id.match(/-(\d)$/)?.[1] ?? 1) - 1];

/* slide 6 – the plan: four months (Nov–Feb), one lane each; a bar spans the months it runs. `more` shows on hover / tap. It is a plan, not a promise: the audit gates the mainnet, the mainnet gates the token. */
const MONTHS = [['NOV', 'M1 · 2026'], ['DEC', 'M2'], ['JAN', 'M3 · 2027'], ['FEB', 'M4']];
const PLAN = [
  { k: 'MAINNET', sub: 'once the audit clears', c: '#14f195', from: 2, to: 2, t: 'Beta launch', n: 'capped pools first',
    more: 'Real SOL pools, capped at first. Same program, same proofs.' },
  { k: 'LOAD · AUDIT', sub: 'load test, security checks, audit', c: '#ffcf5a', from: 1, to: 2, t: 'Load test → security fixes → audit', n: 'server + escrow program',
    more: 'Load-test the API and the replay worker, close every audit finding, then a third-party audit of the escrow program.' },
  { k: 'COMMUNITY', sub: 'players and streamers', c: '#b98cff', from: 1, to: 4, t: 'Streamers · Discord · weekly challenges', n: 'build in public, every week',
    more: 'People before money: streamer partnerships, a Discord and weekly challenges, so the first pools already have an audience.' },
  { k: 'TOKEN LAUNCH', sub: 'TEN4', c: '#ffffff', from: 4, to: 4, t: 'TEN4 on chain', n: 'liquidity → pool',
    more: 'An SPL mint: 100M cap, 2M to the pool, 98M earned by rides.' },
  { k: 'PAID EVENTS', sub: 'backed by us', c: '#ff5a4d', from: 2, to: 4, t: 'Funded prize pools · streamer cups', n: 'we seed the pool',
    more: 'We fund the prizes: marketing rides and streamer cups, so a pool never opens empty and the stream has a reason to exist.' },
  { k: 'AI MODS', sub: 'community-made content', c: '#ff9ad5', from: 3, to: 4, t: 'AI-built mods via MCP · storybook', n: 'vehicles, props, landmarks',
    more: 'Players describe a vehicle, prop or landmark to an AI; an MCP server builds it in the storybook.' },
  { k: 'NEW GAME MODES', sub: 'then modding', c: '#6fb0ff', from: 3, to: 4, t: 'New modes, same rails', n: 'same road, same verification',
    more: 'New ways to drive on the same seeded road and the same verification stack. Modding comes after the modes.' },
];

/* the storybook sneak peek: real screenshots of the model viewer (client/viewer.html#<id>) – shown one after another while the card is hovered / tapped */
export const STORY = [['storybook.webp', 'car'], ['storybook-truck.webp', 'truck'], ['storybook-police.webp', 'police car'], ['storybook-fire.webp', 'fire truck'], ['storybook-diner.webp', 'roadside diner'], ['storybook-truckstop.webp', 'truck stop'], ['storybook-cactus.webp', 'desert cactus']];

/* slide 8 – go to market as six highway exits, in the order they come up (the months match the plan slide); `more` is the back of the sign (hover / tap) */
const EXITS = [
  { t: 'Co-driver wanted', s: 'a co-founder: growth, partners, community', when: 'NOW',
    more: 'Built solo so far. The next leg needs a second seat: growth, partnerships and the community, while I keep the game and the chain.' },
  { t: 'Billboards', s: 'advertising, cut from real rides', when: 'NOV',
    more: 'Paid ads on X, YouTube and Twitch, cut from real gameplay by our own promo pipeline. No stock footage: the road is the ad.' },
  { t: 'Streamers on CB', s: 'streamer agreements', when: 'NOV',
    more: 'Paid deals with streamers to drive on stream. Their chat donates night and sinkholes, and every stream stays a replayable ad.' },
  { t: 'We pay the pool', s: 'tournaments funded by us', when: 'DEC',
    more: 'Marketing rides and streamer cups: we put up the prize through the escrow\'s sponsor(). Free to enter, real SOL to win, refunded to us if it fails.' },
  { t: 'Creator garage', s: 'paid access to community creations', when: 'JAN',
    more: 'Players build trucks, props and landmarks with AI over MCP in the storybook. Others pay to unlock them; the creator gets a cut.' },
  { t: 'TEN4 listing', s: 'the token, listed', when: 'FEB', sol: true,
    more: 'After the audit and mainnet: TEN4 on chain, then a DEX listing. 100M cap, earned only by verified distance.' },
];
/* the truck that drives to the exit you look at: a side view facing right (trailer, red cab with an exhaust stack, four wheels with a spoke each, so they visibly turn) */
const TRUCK = `<svg viewBox="0 0 184 74" aria-hidden="true"><rect x="2" y="6" width="118" height="46" rx="5" fill="#ece6d3"/><text x="61" y="35" text-anchor="middle" font-family="Anton,Impact,sans-serif" font-size="15" fill="#050505" letter-spacing="1">FREIGHT CHAIN</text><rect x="127" y="0" width="5" height="17" rx="2" fill="#9a9a9a"/><path d="M124 54V22a7 7 0 0 1 7-7h23l22 22v17z" fill="#ff3b2f"/><path d="M154 20h-19v15h33z" fill="#bfe6ff"/><rect x="0" y="52" width="178" height="6" rx="2" fill="#2b2b2b"/>${[22, 48, 140, 164].map(x => `<g class="wh"><circle cx="${x}" cy="60" r="10" fill="#111" stroke="#777" stroke-width="3"/><path d="M${x} 52v16" stroke="#777" stroke-width="2"/></g>`).join('')}</svg>`;

export const SLIDES = [
  { layout: 'wall', id: 'product',
    html: `
      <div class="copy">
        <div class="lbl">00 · The product</div>
        <h1>Freight Chain<small>Competitive · GameFi</small></h1>
        ${pts(['<b>Site</b> · landing, lobby, whitepaper', '<b>Streams</b> · live watch + replays', '<b>Analytics</b> · PostHog funnels', '<b>Solana</b> · devnet escrow, no token', '<b>Details</b> · gearbox, cold engine, night', '<b>Passion</b> · built solo, shipped fast'])}
      </div>
      <div class="vis">
        ${shot('landing-hero.webp', 'w1', 'The landing')}
        ${shot('watch-replay.webp', 'w2', 'Watching a replay')}
        ${shot('wp-onchain.webp', 'w3', 'Whitepaper, on-chain chapter')}
        ${shot('receipt-card.webp', 'w4', 'A public ride receipt')}
        <div class="tags"><span>SITE</span><span>STREAMS</span><span>ANALYTICS</span><span>SOLANA ESCROW</span></div>
      </div>` },

  { layout: 'bleed', id: 'game',
    html: `
      <video class="bg" data-src="/media/hero-preview.mp4" data-poster="/media/hero-poster.webp" muted playsinline loop preload="none"></video>
      <div class="shade"></div>
      <div class="copy">
        <div class="lbl">01 · The game</div>
        <h1>The road never ends.<br><em>Your shift does.</em></h1>
        ${pts(['<b>Gearbox</b> · manual, clutch, stalls', '<b>Engine</b> · cold starts, heat, battery', '<b>Road</b> · endless, day and night', '<b>Traffic</b> · forks, bends, sinkholes', '<b>Speed</b> · capped near 100 km/h'])}
      </div>
      <div class="vis">${shot('01-one-mistake.webp', 'poster', 'One mistake ends the shift')}</div>` },

  { layout: 'split', id: 'insight',
    html: `
      <div class="copy">
        <div class="lbl">02 · The insight</div>
        <h1>The game<br>is the door.</h1>
        ${pts(['<b>Streams</b> · live watch, replays', ['<b>Donations</b> · chat, night, holes', 'don'], '<b>Web2</b> · no wallet to watch', ['<b>Goal</b> · <span class="sink">Web3 adoption</span>', 'adopt'], '<b>Reach</b> · the stream is the ad'])}
      </div>
      <div class="vis">
        ${clip('promo-clip.mp4', 'v-main')}
        <div class="badge live"><i class="dot"></i>LIVE · NO WALLET TO WATCH</div>
      </div>` },

  { layout: 'split flip', id: 'play',
    html: `
      <div class="copy">
        <div class="lbl">03 · Play</div>
        <h1>Free<br>tonight.</h1>
        ${pts(['10 free rides · no download', 'Offline · no wallet, no limits', 'Watch live or replay · no wallet', 'Paid: 1 h seat · a few $ in SOL', 'One signature'])}
        <div class="ladders"><ol class="ladder">
          <li class="on"><b>FREE</b><span>3 min</span></li>
          <li class="on"><b>1 H</b><span>devnet pool</span></li>
          <li><b>4 H</b><span>next</span></li>
          <li><b>8 H</b><span>next</span></li>
        </ol><ol class="ladder secret" aria-hidden="true">${'<li><b>???</b><span>secret</span></li>'.repeat(4)}</ol></div>
      </div>
      <div class="vis">
        ${shot('game-guest.webp', 'v-main', 'Free run in the cab')}
        ${shot('receipt-card.webp', 'v-sub receipt', 'Ride receipt')}
      </div>` },

  { layout: 'money', id: 'money',
    html: `
      <div class="copy">
        <div class="lbl">04 · The money</div>
        <h1>The program<br>holds the money.</h1>
        <div class="split" role="group" aria-label="70 percent to finishers, 20 percent to the next pool, 10 percent fee">
          <div style="--w:70"><b>70%</b><i class="desc">Of every pool: paid to finishers, ranked by distance</i><span>finishers · by distance</span></div>
          <div style="--w:20"><b>20%</b><i class="desc">Of every pool: seeds the next pool</i><span>next pool</span></div>
          <div style="--w:10"><b>10%</b><i class="desc">Of every pool: the platform fee</i><span>fee</span></div>
        </div>
        ${pts(['Too few tickets · refund, without me', 'Road seed committed on chain', 'Pays only attested rides'])}
        <div class="fine">DEVNET · NOT AUDITED · NO TOKEN</div>
      </div>
      <div class="vis">
        ${shot('wp-diagram.webp', 'v-main diagram', 'Where the money goes')}
        ${shot('escrow-flow.webp', 'v-sub', 'How the escrow works')}
        <canvas class="glyph g1" data-scene="proof" role="img" aria-label="Four 15-second batches hash up into one Merkle root, which turns verified"></canvas>
        <div class="vblock" aria-hidden="true">✓ Attestation<small>PDA gated · pays only verified rides</small></div>
      </div>` },

  { layout: 'chain', id: 'chain',
    html: `
      <div class="copy">
        <div class="lbl">05 · The chain</div>
        <h1>Six systems. <em>One wallet.</em></h1>
      </div>
      <div class="cards5">${CHAIN.map(chainCard).join('')}</div>` },

  { layout: 'plan', id: 'plan',
    html: `
      <div class="copy">
        <div class="lbl">06 · The plan</div>
        <h1>The next <em>4 months.</em></h1>
      </div>
      <div class="vis peek">
        <figure class="shot peek-card"><span class="pk-imgs">${STORY.map(([f, n], i) => `<img class="${i ? '' : 'on'}" data-src="${A}${f}" alt="Storybook sneak peek: ${n}" decoding="async">`).join('')}</span><i class="pk-flash"></i><em class="pk-name">${STORY[0][1]}</em></figure>
        <div class="badge live peekb"><i class="dot"></i>SNEAK PEEK · STORYBOOK · AI + MCP</div>
      </div>
      <div class="plan">
        <div class="pr today"><span class="pin"><i></i>TODAY · OCT 15</span></div>
        ${MONTHS.map((m, i) => `<div class="pr mo" style="--m:${i + 1}"><b>${m[0]}</b><small>${m[1]}</small></div>`).join('')}
        ${PLAN.map((l, i) => `<div class="pl" style="--c:${l.c};--i:${i};grid-row:${i + 2}"><b>${l.k}</b><small>${l.sub}</small></div>
        <div class="bar${l.from === l.to ? ' n1' : ''}" style="--c:${l.c};--i:${i};grid-row:${i + 2};grid-column:${l.from + 1} / ${l.to + 2}"><b>${l.t}</b><small>${l.n}</small><p>${l.more}</p></div>`).join('')}
      </div>` },

  { layout: 'gtm', id: 'market',
    html: `
      <div class="copy">
        <div><div class="lbl">07 · Go to market</div><h1>Six exits <em>to market.</em></h1></div>
        <p class="gfine">Revenue · 10 % of every pool + a cut of the creator garage<br>A plan, not a promise · the audit gates mainnet, mainnet gates the token</p>
      </div>
      <div class="exits">
        <div class="row">${EXITS.map((x, i) => `<div class="exit${x.sol ? ' sol' : ''}" style="--i:${i}"><div class="sign"><div class="f"><span class="tab">EXIT ${i + 1}</span><b>${x.t}</b><small>${x.s}</small><em><i>↗</i>${x.when}</em></div><div class="bk"><span class="tab">EXIT ${i + 1}</span><p>${x.more}</p></div></div><i class="post"></i><i class="post"></i></div>`).join('')}</div>
        <div class="hwy"><i class="lane"></i><canvas class="warp" aria-hidden="true"></canvas><div class="truck" title="Honk">${TRUCK}</div><span class="honks">TEN4 MINED <b>0</b> / 100,000,000 CAP</span></div>
        <div class="lanes-ctl"><button type="button" class="ln up" aria-label="Change to the far lane">▲</button><button type="button" class="ln dn" aria-label="Change to the near lane">▼</button></div>
      </div>` },
];

/* the header ticker's facts – and real lines from the code (client/shared/physics.js, road.js, prng.js, js/config.js, the Anchor program) */
export const FACTS = [
  'One endless road · one shift', 'Browser game after Desert Bus', 'Manual 7-speed gearbox · clutch · stalls', 'Cold engine · heat · battery', 'Traffic · forks · sinkholes', 'Day and night',
  'Speed capped near 100 km/h', 'Parking brake · handbrake starts', 'Wipers · windscreen dust · wash', 'CB radio · eleven stations', 'Dice on the mirror',
  'Gauges: oil · air · fuel · volts · H2O · temp', 'Lamps: STALL · COLD · OFF ROAD · STRAIN · OVER-REV · GRIND', 'Headlights · cab lamp · heat', 'Engine off at the start: turn the key',
  '10 free rides · no download · in your browser', 'Three free levels: easy · medium · hard', 'Five routes', 'Live watch and replays · no wallet to watch', '31 achievement badges',
  ['code', 'GEAR_RATIOS = [0, 6.15, 4.33, 3.05, 2.15, 1.51, 1.065, 0.75]'],
  ['code', 'thrust = (TRUCK_POWER / TRUCK_MASS) * ratio ** TRUCK_GEAR_EXP * gas'],
  ['code', 'drag = ROLL_RES + (DRAG / MASS) * v * v + offroad * 1.2 + brake * 5.5'],
  ['code', 'v = max(0, min(HOLE_REF_SPEED, v + (thrust - drag) * h))'],
  'Physics at 10 Hz · 2 substeps · the server re-runs every ride',
  ['code', 'TRUCK_MASS = 2.5 · TRUCK_POWER = 2.4 · TRUCK_BRAKE = 5.5'],
  ['code', 'TORQUE_PEAK = 2000 rpm · SHIFT_TIME = 0.4 s'],
  ['code', 'HOLE_CHANCE = 0.045 · HOLE_FIRST = 150 · OFFROAD_FAIL_SECONDS = 20'],
  ['code', 's = (s + 0x6D2B79F5) | 0   // mulberry32: the same road in your browser and on the server'],
  'Vanilla ES modules · three.js r160 · no build step · no framework', 'NestJS · Prisma · PostgreSQL', 'Prize pool split 70 / 20 / 10',
  'Solana devnet · no token · not audited', ['code', 'program id 8No42h2QXb9opgp3pJfNXL2o77o288SsF8o7CwJGCA1p'], 'Anchor program · 14 instructions · 12 events · 24 errors',
  'Built solo in Belgrade'];

/* donations on slide 3 (a show, not the game's own effect prices) and the real SOL price: a snapshot, not a feed – the deck makes no request of its own.
   CoinGecko $104.24 / Binance $104.47 on Oct 15 2026; ~$104.3. Update the number before presenting if the market has moved. */
export const SOL_USD = 104.3;
export const DONATE = [['TIP', 0.15], ['NIGHT', 0.25], ['DAY', 0.25], ['POTHOLES', 0.4], ['TRENCH', 0.6], ['SINKHOLE', 1]];
