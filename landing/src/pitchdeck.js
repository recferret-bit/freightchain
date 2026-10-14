/* Freight Chain pitch deck (pitchdeck.<apex>, landing/pitchdeck.html – the "Poster" theme, src/pitchdeck.css). Makes NO request of its own: every file is the landing build's.
   The slides are author-written constants, so they go in with innerHTML (the landing's no-innerHTML rule is for server text; this file takes none).
   Keys: → / space next · ← back · F fullscreen · Home / End. */

const A = '/media/pitchdeck/', BADGES = '/badges/';   // absolute: on pitchdeck.<apex> a relative path would resolve against the host's /
const shot = (src, cls = '', alt = '') => `<figure class="shot ${cls}"><img src="${A}${src}" alt="${alt}" loading="eager"></figure>`;
const clip = (src, cls = '') => `<figure class="shot clip ${cls}"><video src="${A}${src}" muted playsinline loop preload="auto"></video></figure>`;   // promo-clip.mp4 = the promo's 16–24 s, cut once
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
  { c: '#ffffff', st: 'SPEC · NOT LIVE', h: 'HONK', big: '100M CAP', p: 'A capped meme coin, minted only for the distance a verified paid ride reached: 20, 50 and 100 % checkpoints.', small: 'An in-game ledger for now · not a chain mint',
    why: 'A reason to keep driving beyond the prize pool: a score that is yours, and a currency to spend on the cab.',
    fit: 'Minted only on verified paid rides. Burn 1 in chat, 65 / 260 for cab visuals. SOL still buys tickets; the pool maths never change.' },
  { c: '#6fb0ff', st: 'DEVNET · PUBLIC', h: 'Blinks', big: 'BUY IN A LINK', p: 'Solana Actions turn a link into a ticket purchase, in any client that can show a Blink.', small: '/actions.json · /api/actions',
    why: 'Selling a ticket should take one tap from wherever people already are: a post, a chat, a link.',
    fit: 'Solana Actions endpoints answer with one program-mode ticket to sign. 𝕏 unfurling waits for the Blinks registry listing.' },
];
const chainCard = c => `<article class="cc" style="--c:${c.c}"><span class="st">${c.st}</span><h3>${c.h}</h3><div class="big">${c.big}</div><p>${c.p}</p>${c.extra ?? `<small>${c.small}</small>`}<div class="more"><h4>Why</h4><p>${c.why}</p><h4>How it fits</h4><p>${c.fit}</p></div></article>`;

/* the 31 soulbound badges (names and rules from server/src/domain/achievements/achievements.ts) – the NFT card shows them one at a time */
const ACH = [
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
const achTier = id => id.startsWith('free-') ? 'LICENCE' : TIER[(id.match(/-(\d)$/)?.[1] ?? 1) - 1];

/* slide 6 – the plan: four months (Nov–Feb), one lane each; a bar spans the months it runs. `more` shows on hover / tap. It is a plan, not a promise: the audit gates the mainnet, the mainnet gates the token. */
const MONTHS = [['NOV', 'M1 · 2026'], ['DEC', 'M2'], ['JAN', 'M3 · 2027'], ['FEB', 'M4']];
const PLAN = [
  { k: 'MAINNET', sub: 'once the audit clears', c: '#14f195', from: 2, to: 2, t: 'Beta launch', n: 'capped pools first',
    more: 'Real SOL pools, capped at first. Same program, same proofs.' },
  { k: 'LOAD · PENTEST · AUDIT', sub: 'break it, then prove it', c: '#ffcf5a', from: 1, to: 2, t: 'Load test → pentest fixes → audit', n: 'server + escrow program',
    more: 'Load-test the API and the replay worker, close every pentest finding, then a third-party audit of the escrow program.' },
  { k: 'COMMUNITY', sub: 'players and streamers', c: '#b98cff', from: 1, to: 4, t: 'Streamers · Discord · weekly challenges', n: 'build in public, every week',
    more: 'People before money: streamer partnerships, a Discord and weekly challenges, so the first pools already have an audience.' },
  { k: 'TOKEN LAUNCH', sub: 'HONK', c: '#ffffff', from: 4, to: 4, t: 'HONK on chain', n: 'genesis → pool',
    more: 'An SPL mint: 100M cap, 2M to the pool, 98M earned by rides.' },
  { k: 'PAID EVENTS', sub: 'backed by us', c: '#ff5a4d', from: 2, to: 4, t: 'Funded prize pools · streamer cups', n: 'we seed the pool',
    more: 'We fund the prizes: marketing rides and streamer cups, so a pool never opens empty and the stream has a reason to exist.' },
  { k: 'COMMUNITY CONTENT', sub: 'made by players', c: '#ff9ad5', from: 3, to: 4, t: 'AI-built mods via MCP · storybook', n: 'vehicles, props, landmarks',
    more: 'Players describe a vehicle, prop or landmark to an AI; an MCP server builds it in the storybook.' },
  { k: 'NEW GAME MODES', sub: 'then modding', c: '#6fb0ff', from: 3, to: 4, t: 'New modes, same rails', n: 'same road, same verification',
    more: 'New ways to drive on the same seeded road and the same verification stack. Modding comes after the modes.' },
];

/* the storybook sneak peek: real screenshots of the model viewer (client/viewer.html#<id>) – shown one after another while the card is hovered / tapped */
const STORY = [['storybook.webp', 'car'], ['storybook-truck.webp', 'truck'], ['storybook-police.webp', 'police car'], ['storybook-fire.webp', 'fire truck'], ['storybook-diner.webp', 'roadside diner'], ['storybook-truckstop.webp', 'truck stop'], ['storybook-cactus.webp', 'desert cactus']];

const SLIDES = [
  { layout: 'wall', id: 'product',
    html: `
      <div class="copy">
        <div class="brand"><img src="/icons/icon-192.png" alt=""><span>FREIGHT CHAIN</span></div>
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
      <video class="bg" src="/media/hero-preview.mp4" poster="/media/hero-poster.webp" muted playsinline loop preload="auto"></video>
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
        </ol><ol class="ladder secret" aria-hidden="true">${[0, 1, 2, 3].map(i => `<li style="--i:${i}"><b>???</b><span>secret</span></li>`).join('')}</ol></div>
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
        <figure class="shot peek-card"><span class="pk-imgs">${STORY.map(([f, n], i) => `<img class="${i ? '' : 'on'}" src="${A}${f}" alt="Storybook sneak peek: ${n}" loading="eager">`).join('')}</span><i class="pk-flash"></i><em class="pk-name">${STORY[0][1]}</em></figure>
        <div class="badge live peekb"><i class="dot"></i>SNEAK PEEK · STORYBOOK · AI + MCP</div>
      </div>
      <div class="plan">
        <div class="pr today"><span class="pin"><i></i>TODAY · OCT 15</span></div>
        ${MONTHS.map(m => `<div class="pr mo"><b>${m[0]}</b><small>${m[1]}</small></div>`).join('')}
        ${PLAN.map((l, i) => `<div class="pl" style="--c:${l.c};--i:${i};grid-row:${i + 2}"><b>${l.k}</b><small>${l.sub}</small></div>
        <div class="bar" style="--c:${l.c};--i:${i};grid-row:${i + 2};grid-column:${l.from + 1} / ${l.to + 2}"><b>${l.t}</b><small>${l.n}</small><p>${l.more}</p></div>`).join('')}
      </div>` },

  { layout: 'end gtm', id: 'market',
    html: `
      <div class="copy">
        <div class="lbl">07 · Go to market</div>
        <h1>Go to<br>market</h1>
        <ol class="road">
          <li><b>01</b>Community and polishing</li>
          <li><b>02</b>Funded marketing rides</li>
          <li><b>03</b>Streamers collaboration</li>
          <li><b>04</b>10% fees</li>
          <li><b>05</b>No token</li>
        </ol>
      </div>
      <div class="vis">
        ${shot('landing-market.webp', 'v-main', 'Go to market load board')}
      </div>` },
];

/* ── header ticker: the landing's running text (LCD green on black) – project facts, and real lines from the code (client/shared/physics.js, road.js, prng.js, js/config.js, the Anchor program) ── */
const FACTS = [
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
const tk = document.querySelector('#ticker .tk');
const tkItems = () => FACTS.map(f => { const e = document.createElement('span'), [kind, text] = Array.isArray(f) ? f : ['', f]; e.textContent = text; if (kind) e.className = kind; return e; });
tk.append(...tkItems(), ...tkItems());   // doubled: the -50% translate loops seamlessly
/* the ticker is driven by script, not CSS: ~190 px/s (stage px), easing down to a crawl while the pointer is over it and for a moment after a click / tap, then easing back up */
const TK_FAST = 190, TK_SLOW = 24, tkReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let tkX = 0, tkV = TK_FAST, tkHold = 0, tkOver = false, tkLast = 0;
const tkEl = document.getElementById('ticker');
tkEl.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') tkOver = true; });
tkEl.addEventListener('pointerleave', () => { tkOver = false; });
function tkTick(t) {
  const dt = Math.min(.1, (t - tkLast) / 1000) || 0; tkLast = t;
  const target = tkReduced ? 0 : (tkOver || t < tkHold) ? TK_SLOW : TK_FAST;
  tkV += (target - tkV) * (1 - Math.exp(-dt * 3.5));   // an exponential tween: ~0.3 s to most of the way either direction
  tkX = (tkX + tkV * dt) % (tk.scrollWidth / 2);   // the list is doubled, so half its width is one seamless loop
  tk.style.transform = `translateX(${-tkX.toFixed(1)}px)`;
  requestAnimationFrame(tkTick);
}
requestAnimationFrame(tkTick);

/* ── engine ── */
const deck = document.getElementById('deck');
deck.innerHTML = SLIDES.map((s, i) => `<section class="slide L-${s.layout.split(' ').join(' L-')}" id="s-${s.id}" data-i="${i}">${s.html}</section>`).join('');

const slides = [...deck.children];

/* the AI + MCP sneak-peek card: while it is hovered or tapped open, it steps through the storybook objects every 1.5 s (a hard swap under a white flash), the name tag swaps with them; a click steps once more */
const pk = deck.querySelector('.peek-card');
if (pk) {
  const imgs = [...pk.querySelectorAll('img')], nm = pk.querySelector('.pk-name'), fl = pk.querySelector('.pk-flash'); let n = 0, timer = 0;
  const step = () => { imgs[n].classList.remove('on'); n = (n + 1) % imgs.length; imgs[n].classList.add('on'); nm.textContent = STORY[n][1]; nm.classList.remove('flip'); void nm.offsetWidth; nm.classList.add('flip'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go'); };
  const run = () => { if (!timer && !tkReduced) { step(); timer = setInterval(step, 1500); } };
  const stop = () => { clearInterval(timer); timer = 0; };
  pk.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') run(); });
  pk.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') stop(); });
  pk.addEventListener('click', () => { if (pk.classList.contains('hot')) run(); else stop(); });   // runs after the generic toggle: a tap opens (and runs) or closes it
}

/* the soulbound-NFT card: a carousel of the 31 badges – the middle one big, its neighbours small and dim, peeking in from the sides; every step the whole row slides one place left (the middle ones scale up / down on the way) and the caption follows. Five slots (o = −2…2): the one that slid out on the left jumps to the far right, unseen. */
const ach = deck.querySelector('.ach');
if (ach) {
  const stage = ach.querySelector('.ach-stage'), cap = ach.querySelector('.ach-cap'), N = ACH.length;
  let k = 0;
  const badge = i => ACH[((i % N) + N) % N];
  const rings = [0, 1].map(() => { const r = document.createElement('i'); r.className = 'ach-ring'; stage.append(r); return r; });   // the ripple behind the middle badge
  const slots = [-2, -1, 0, 1, 2].map(o => { const im = document.createElement('img'); im.className = 'ci'; im.width = im.height = 120; im.alt = ''; stage.append(im); return { im, o }; });
  const place = () => slots.forEach(sl => { sl.im.dataset.o = Math.abs(sl.o) > 2 ? 'x' : sl.o; sl.im.style.setProperty('--o', sl.o); });
  const fill = sl => { const [id, name] = badge(k + sl.o); sl.im.src = `${BADGES}${id}.svg`; sl.im.alt = name; };
  const caption = () => { const [id, name, desc] = badge(k); cap.querySelector('.at').textContent = achTier(id); cap.querySelector('.an').textContent = name; cap.querySelector('.ad').textContent = desc; };
  slots.forEach(fill); place(); caption();
  if (!tkReduced) setInterval(() => {
    if (!ach.closest('.slide.on')) return;   // only while its slide is showing
    k = (k + 1) % N;
    slots.forEach(sl => { sl.o -= 1; });
    place();
    setTimeout(() => {   // the new badge has all but reached the middle: two purple rings grow out of its centre, the second a beat behind, and it gives a small pop
      rings.forEach(r => { r.classList.remove('go'); void r.offsetWidth; r.classList.add('go'); });
      const mid = slots.find(sl => sl.o === 0)?.im; if (mid) { mid.classList.remove('pop'); void mid.offsetWidth; mid.classList.add('pop'); }
    }, 480);
    cap.classList.remove('swap'); void cap.offsetWidth; cap.classList.add('swap');   // the caption slides in with the new middle badge
    setTimeout(caption, 180);
    setTimeout(() => {   // the badge that left on the left re-enters on the right, hidden
      const gone = slots.find(sl => sl.o < -2);
      gone.im.style.transition = 'none'; gone.o = 2; fill(gone); place(); void gone.im.offsetWidth; gone.im.style.transition = '';
    }, 720);
  }, 2600);
}

/* live canvas scenes lifted from the landing's UNDER THE HOOD cards (src/chain-scenes.js – a lazy chunk the landing shares), drawn straight onto the slide with no card around them, only while their slide is showing */
const scenes = [...deck.querySelectorAll('canvas[data-scene]')].map(cv => ({ cv, ctx: cv.getContext('2d'), slide: cv.closest('.slide'), name: cv.dataset.scene, draw: null }));
let sceneLib = null;
(window.requestIdleCallback ?? (f => setTimeout(f, 800)))(() => import('./chain-scenes.js').then(m => {
  sceneLib = m;
  scenes.forEach(sc => { if (sc.ctx?.roundRect) sc.draw = m.SCENES[sc.name]?.(); });   // no roundRect (an old browser): the card keeps its caption and an empty frame
}).catch(() => {}));
function sceneFrame(ms) {
  if (sceneLib) for (const sc of scenes) {
    if (!sc.draw || !sc.slide.classList.contains('on')) continue;
    const w = Math.round(sc.cv.clientWidth * 2);   // 2× the layout width, so the stage's scaling stays sharp
    if (w && sc.cv.width !== w) { sc.cv.width = w; sc.cv.height = Math.round(w * 124 / 240); }
    sceneLib.drawScene(sc.ctx, sc.draw, tkReduced ? 3.2 : ms / 1000, sc.cv.width / 240);
  }
  requestAnimationFrame(sceneFrame);
}
requestAnimationFrame(sceneFrame);

/* page counter: an old mechanical-watch roll – the digit that changes rolls out and the new one rolls in (up going forward, down going back) while the counter swells 1.05 for a beat */
const pager = document.getElementById('pager');
const mkDigit = () => { const dg = document.createElement('span'), col = document.createElement('span'); dg.className = 'dg'; col.className = 'col'; dg.append(col); return dg; };
const dgs = [mkDigit(), mkDigit()], of = document.createElement('span');
of.className = 'of'; of.textContent = ` / ${String(slides.length).padStart(2, '0')}`;
pager.append(...dgs, of);
const cell = ch => { const e = document.createElement('span'); e.textContent = ch; return e; };
function setPager(i, from) {   // from = the previous slide, -1 on load
  const txt = String(i + 1).padStart(2, '0');
  dgs.forEach((dg, k) => {
    const col = dg.firstElementChild, old = col.dataset.v;
    if (old === txt[k]) return;
    col.dataset.v = txt[k];
    if (from < 0 || tkReduced || old == null) { col.replaceChildren(cell(txt[k])); col.style.transform = ''; return; }
    const fwd = i > from;
    col.style.transition = 'none';
    col.replaceChildren(...(fwd ? [cell(old), cell(txt[k])] : [cell(txt[k]), cell(old)]));
    col.style.transform = fwd ? 'translateY(0)' : 'translateY(-50%)';
    void col.offsetWidth;
    col.style.transition = 'transform .55s cubic-bezier(.2,.8,.2,1)';
    col.style.transform = fwd ? 'translateY(-50%)' : 'translateY(0)';
  });
  if (from >= 0 && !tkReduced) { pager.classList.remove('tick'); void pager.offsetWidth; pager.classList.add('tick'); }
}
const stage = document.getElementById('stage');
let scale = 1;   // stage px → screen px
const fit = () => {
  const k = scale = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.transform = `translate(-50%,0) scale(${k})`;
  tkEl.style.transform = `scale(${k})`; tkEl.style.width = `${innerWidth / k}px`;   // the header hugs the top edge of the window, full width, whatever the letterboxing
};
addEventListener('resize', fit); fit();

let cur = -1;
function show(i) {
  i = Math.max(0, Math.min(slides.length - 1, i));
  if (i === cur) return;
  slides.forEach((s, j) => s.classList.toggle('on', j === i));
  slides.forEach((s, j) => s.querySelectorAll('video').forEach(v => { if (j === i) start(v); else v.pause(); }));
  setPager(i, cur);
  cur = i;
  history.replaceState(null, '', '#' + (i + 1));
  document.getElementById('bar').style.width = `${100 * (i + 1) / slides.length}%`;
}
const start = v => v.play().catch(() => {});

/* the 70 / 20 / 10 bar – hover (or tap) a block: the others fade out one after another (nearest first), the block slides to the left edge and grows to the full width, then its % is swapped for what it means; moving the pointer away (or tapping again) plays it backwards */
const split = deck.querySelector('.split');
if (split) {
  const blocks = [...split.children];
  let open = -1, timers = [], intent = 0;
  const later = (ms, f) => timers.push(setTimeout(f, ms));
  const expand = i => {
    timers.forEach(clearTimeout); timers = []; open = i;
    // every other block runs to the bar's border on ITS side of the picked one (left of it → the left border, right of it → the right one) and squeezes into it;
    // the farthest from the picked block goes first, equally far ones (hover 20: 70 and 10) go together; coming back it is nearest first
    const bar = split.offsetLeft, far = Math.max(...blocks.map((_, k) => Math.abs(k - i)));
    blocks.forEach((b, k) => {
      const d = Math.abs(k - i), left = b.offsetLeft - bar;
      b.classList.toggle('pick', k === i);
      b.style.setProperty('--o', d ? far - d : 0); b.style.setProperty('--r', d ? d - 1 : 0);
      b.style.setProperty('--ox', k < i ? '0%' : '100%');   // it squeezes towards the border it runs to
      b.style.setProperty('--tx', `${k < i ? -left : split.offsetWidth - left - b.offsetWidth}px`);
    });
    if (tkReduced) { split.classList.add('s-out', 's-grow', 's-text'); return; }
    split.classList.add('s-out');
    later(660, () => split.classList.add('s-grow'));
    later(1420, () => split.classList.add('s-text'));   // the grow (from 660 ms, 0.7 s) has finished: the text never re-wraps while the block is still widening
  };
  const collapse = () => {
    timers.forEach(clearTimeout); timers = []; open = -1;
    if (tkReduced) { split.classList.remove('s-text', 's-grow', 's-out'); blocks.forEach(b => b.classList.remove('pick')); return; }
    split.classList.remove('s-text');
    later(300, () => split.classList.remove('s-grow'));
    later(1000, () => split.classList.remove('s-out'));
    later(1800, () => blocks.forEach(b => b.classList.remove('pick')));
  };
  blocks.forEach((b, i) => b.addEventListener('pointerenter', e => {
    if (e.pointerType !== 'mouse' || open >= 0) return;
    clearTimeout(intent); intent = setTimeout(() => expand(i), 140);   // a short intent delay: sweeping the pointer across the bar does not fire it
  }));
  split.addEventListener('pointerleave', e => { clearTimeout(intent); if (e.pointerType === 'mouse' && open >= 0) collapse(); });
  split.addEventListener('click', e => {   // a tap: open the block, or close again (a mouse is already driven by hover)
    const i = blocks.indexOf(e.target.closest('.split > div'));
    if (open >= 0) { if (e.pointerType !== 'mouse') collapse(); } else if (i >= 0) expand(i);
  });
}

/* the tip flashes once per ← / → / space key press (not for a click, a tap or a hash change); the arrow in the pressed direction flashes too, space leaves both arrows alone */
function flashTip(dir) {
  const help = document.getElementById('help');
  help.classList.remove('flash', 'go-l', 'go-r'); void help.offsetWidth;
  help.classList.add('flash');
  if (dir) help.classList.add(dir);   // space flashes the tip but leaves the arrows alone
}
addEventListener('keydown', e => {
  if (e.key === 'ArrowRight') flashTip('go-r'); else if (e.key === 'ArrowLeft') flashTip('go-l'); else if (e.key === ' ') flashTip('');
  if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); show(cur + 1); }
  else if (['ArrowLeft', 'PageUp'].includes(e.key)) show(cur - 1);
  else if (e.key === 'Home') show(0);
  else if (e.key === 'End') show(slides.length - 1);
  else if (e.key === 'f' || e.key === 'F') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
});
/* the cards of slides 0–4 (.fx) and slide 0's tags: the mouse nudges them (parallax), a tap / click lifts one (.hot) instead of turning the page */
['product', 'game', 'insight', 'play', 'money', 'plan'].forEach(id => document.getElementById(`s-${id}`)?.classList.add('fx'));
const fxVis = [...deck.querySelectorAll('.fx .vis')];
const setTilt = (v, px, py) => { v.style.setProperty('--px', px); v.style.setProperty('--py', py); };
fxVis.forEach(v => {
  v.parentElement.addEventListener('pointermove', e => setTilt(v, (e.clientX / innerWidth - .5).toFixed(3), (e.clientY / innerHeight - .5).toFixed(3)));
  v.parentElement.addEventListener('pointerleave', () => setTilt(v, 0, 0));
});
/* everything interactive (the cards, slide 0's tags, the LIVE badge, the Merkle canvas, the 70 / 20 / 10 blocks, the FREE / 1 H / 4 H / 8 H ladder) gives a tiny, tweened shake at random intervals while its slide is showing – a quiet "touch me". It animates the individual `rotate` property, so it never fights the float / lean / zoom transforms. */
const nudgeables = [...deck.querySelectorAll('.fx .shot, .fx .badge, .fx canvas.glyph, .L-wall .tags span, .split > div, .ladder li, .cards5 .cc, .pts li.don, .pts li.adopt')];
const canShake = el => !tkReduced && document.visibilityState === 'visible' && !!el.closest('.slide.on') && !el.matches(':hover,.hot,.drag')
  && ![...(el.closest('.split')?.classList ?? [])].some(c => c.startsWith('s-'));   // not while it is being used
function shakeLater(el) {
  setTimeout(() => {
    if (canShake(el) && el.animate) {
      const a = (0.9 + Math.random() * 0.9) * (Math.random() < .5 ? -1 : 1);   // 0.9–1.8°, either way
      el.animate({ rotate: ['0deg', `${a}deg`, `${-a * .75}deg`, `${a * .5}deg`, `${-a * .25}deg`, '0deg'] }, { duration: 520 + Math.random() * 200, easing: 'ease-out' });
    }
    shakeLater(el);
  }, 2200 + Math.random() * 5800);   // every element on its own random clock, 2.2–8 s
}
nudgeables.forEach(shakeLater);

/* slide 3's DONATIONS bullet: a click is a mock donation – a toast with a real effect price (client/js/live-effects.js) and a handful of SOL coins from above the stage.
   The coins stay: discs under gravity that bounce, roll and pile up on the stage floor between its walls, over every slide (at most COIN_MAX, the oldest go first). */
const DONATE = [['TIP', 0.01], ['NIGHT', 0.02], ['DAY', 0.02], ['POTHOLES', 0.02], ['TRENCH', 0.03], ['SINKHOLE', 0.05]];
const COIN_MAX = 120, G = 2600, FLOOR = 1075, CEIL = 40, E_FLOOR = .45, E_COIN = .3;   // G in stage px/s²; the floor sits on the progress bar, the ceiling under the ticker
const CARD_SEL = '.slide.on :is(.shot, .badge, .cc, .ladder li, .split > div, .tags span)';   // what the coins bounce off on the showing slide
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz', b58 = n => Array.from({ length: n }, () => B58[Math.floor(Math.random() * 58)]).join('');
const coinCv = document.createElement('canvas'), cctx = coinCv.getContext('2d'), coins = [], sucking = [];   // sucking = coins on their way into Web3 adoption (adopt())
coinCv.id = 'coins'; coinCv.setAttribute('aria-hidden', 'true'); stage.insertBefore(coinCv, pager);
const coinImg = (() => {   // one 128 px sprite: the Solana mark on a dark face inside a purple→green rim, a soft highlight on top
  const S = 128, c = document.createElement('canvas'), g = c.getContext('2d'); c.width = c.height = S;
  const sol = g.createLinearGradient(0, S, S, 0); sol.addColorStop(0, '#9945ff'); sol.addColorStop(1, '#14f195');
  const disc = (r, fill) => { g.beginPath(); g.arc(S / 2, S / 2, r, 0, 7); g.fillStyle = fill; g.fill(); };
  disc(S / 2 - 1, sol); disc(S / 2 - 9, '#0b0a12');
  g.fillStyle = sol;
  const bar = (y, back) => { const x0 = 34, x1 = 94, h = 13, k = 12; g.beginPath(); if (back) { g.moveTo(x0, y); g.lineTo(x1 - k, y); g.lineTo(x1, y + h); g.lineTo(x0 + k, y + h); } else { g.moveTo(x0 + k, y); g.lineTo(x1, y); g.lineTo(x1 - k, y + h); g.lineTo(x0, y + h); } g.fill(); };
  bar(37, false); bar(57.5, true); bar(78, false);
  const hi = g.createRadialGradient(S * .35, S * .3, 2, S * .35, S * .3, S * .6); hi.addColorStop(0, '#ffffff40'); hi.addColorStop(1, '#fff0');
  disc(S / 2 - 1, hi);
  return c;
})();
let coinK = 1, coinRaf = 0, coinStill = 0, coinT = 0;
function drawCoins() {
  cctx.setTransform(1, 0, 0, 1, 0, 0); cctx.clearRect(0, 0, coinCv.width, coinCv.height);
  for (const c of coins) { const k = coinK, cs = Math.cos(c.a) * k, sn = Math.sin(c.a) * k; cctx.setTransform(cs, sn, -sn, cs, c.x * k, c.y * k); cctx.drawImage(coinImg, -c.r, -c.r, c.r * 2, c.r * 2); }
  for (const { c, sc, al } of sucking) { const k = coinK * sc, cs = Math.cos(c.a) * k, sn = Math.sin(c.a) * k; cctx.globalAlpha = al; cctx.setTransform(cs, sn, -sn, cs, c.x * coinK, c.y * coinK); cctx.drawImage(coinImg, -c.r, -c.r, c.r * 2, c.r * 2); }
  cctx.globalAlpha = 1;
}
const coinFit = () => { coinK = Math.min(2, devicePixelRatio * scale); coinCv.width = Math.round(1920 * coinK); coinCv.height = Math.round(1080 * coinK); drawCoins(); };   // backing store at screen resolution, drawn in stage px
addEventListener('resize', coinFit); coinFit();
function collide(p, q) {   // two discs, mass ∝ area (a held one is immovable): push apart, then a restitution impulse along the normal
  const dx = q.x - p.x, dy = q.y - p.y, rr = p.r + q.r, d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr || d2 === 0) return;
  const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, ip = p === held ? 0 : 1 / (p.r * p.r), iq = q === held ? 0 : 1 / (q.r * q.r), push = (rr - d) * .9 / (ip + iq);
  p.x -= nx * push * ip; p.y -= ny * push * ip; q.x += nx * push * iq; q.y += ny * push * iq;
  const vn = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
  if (vn < 0) { const j = -(1 + E_COIN) * vn / (ip + iq); p.vx -= j * nx * ip; p.vy -= j * ny * ip; q.vx += j * nx * iq; q.vy += j * ny * iq; }
  p.touch = q.touch = true;
}
/* the showing slide's cards as boxes in stage px, read once a frame (they float, lean, lift and get dragged): centre, half size and tilt from the element's own transform, its corner radius */
let boxes = [], boxTouch = false;
function readBoxes() {
  const s = stage.getBoundingClientRect();
  boxes = [...deck.querySelectorAll(CARD_SEL)].map(el => {
    const r = el.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight, cs = window.getComputedStyle(el);
    if (!w || !h || !r.width) return null;
    const m = cs.transform === 'none' ? null : new window.DOMMatrixReadOnly(cs.transform), th = m ? Math.atan2(m.b, m.a) : 0, co = Math.cos(th), si = Math.sin(th);
    const k = r.width / scale / (w * Math.abs(co) + h * Math.abs(si));   // its own scale (a lifted card is bigger)
    return { x: (r.left + r.width / 2 - s.left) / scale, y: (r.top + r.height / 2 - s.top) / scale, hw: w * k / 2, hh: h * k / 2, co, si, rad: Math.min(parseFloat(cs.borderTopLeftRadius) || 0, w / 2, h / 2) * k };
  }).filter(Boolean);
}
function hitBox(c, b) {   // a disc against a tilted rounded box: into the box's frame, the closest point on the inner box, out along the normal, bounce
  const dx = c.x - b.x, dy = c.y - b.y, lx = dx * b.co + dy * b.si, ly = -dx * b.si + dy * b.co, ix = b.hw - b.rad, iy = b.hh - b.rad, R = c.r + b.rad;
  if (Math.abs(lx) > ix + R || Math.abs(ly) > iy + R) return;
  const qx = Math.max(-ix, Math.min(ix, lx)), qy = Math.max(-iy, Math.min(iy, ly)), d = Math.hypot(lx - qx, ly - qy);
  let nx, ny, pen;
  if (d > 1e-6) { if (d >= R) return; nx = (lx - qx) / d; ny = (ly - qy) / d; pen = R - d; }
  else { const px = ix - Math.abs(lx), py = iy - Math.abs(ly); if (px < py) { nx = Math.sign(lx) || 1; ny = 0; pen = px + R; } else { nx = 0; ny = Math.sign(ly) || 1; pen = py + R; } }   // centre inside: out through the nearest side
  const wx = nx * b.co - ny * b.si, wy = nx * b.si + ny * b.co, vn = c.vx * wx + c.vy * wy;   // the normal back in stage axes
  c.x += wx * pen; c.y += wy * pen;
  if (vn < 0) { const e = vn < -90 ? E_FLOOR : 0; c.vx -= (1 + e) * vn * wx; c.vy -= (1 + e) * vn * wy; }
  c.touch = true; boxTouch = true;
}
function bounds(c, h) {
  if (c.y - c.r >= CEIL) c.in = true;   // the ceiling only once a coin has dropped in: they are born above it
  if (c.in && c.y - c.r < CEIL) { c.y = CEIL + c.r; if (c.vy < 0) c.vy = -c.vy * E_FLOOR; }
  if (c.y + c.r > FLOOR) { c.y = FLOOR - c.r; if (c.vy > 0) c.vy = c.vy > 90 ? -c.vy * E_FLOOR : 0; c.touch = true; }   // a slow landing stops dead: no endless micro-bounce
  if (c.x - c.r < 0) { c.x = c.r; if (c.vx < 0) c.vx = -c.vx * E_FLOOR; } else if (c.x + c.r > 1920) { c.x = 1920 - c.r; if (c.vx > 0) c.vx = -c.vx * E_FLOOR; }
  if (c.touch) { c.vx *= 1 - .5 * h; c.w += (c.vx / c.r - c.w) * Math.min(1, 10 * h); } else c.w *= 1 - .3 * h;   // touching something it rolls (spin = v / r) and slowly loses speed; in the air it keeps its spin
}
function coinTick(t) {
  const dt = Math.min(1 / 30, (t - coinT) / 1000 || 1 / 60), h = dt / 4; coinT = t;
  readBoxes(); boxTouch = false;
  if (suckOn) suckStep(t);
  for (let s = 0; s < 4; s++) {   // 4 substeps a frame, 4 collision passes each: enough for a stable pile of ~120
    for (const c of coins) { if (c === held) { c.vx = Math.max(-4000, Math.min(4000, (hx - c.x) * 20)); c.vy = Math.max(-4000, Math.min(4000, (hy - c.y) * 20)); } else c.vy += G * h; c.x += c.vx * h; c.y += c.vy * h; c.a += c.w * h; c.touch = false; }
    for (let it = 0; it < 4; it++) for (let i = 0; i < coins.length; i++) for (let j = i + 1; j < coins.length; j++) collide(coins[i], coins[j]);
    for (const c of coins) { for (const b of boxes) hitBox(c, b); bounds(c, h); }
  }
  let vmax = 0; for (const c of coins) vmax = Math.max(vmax, Math.abs(c.vx), Math.abs(c.vy), Math.abs(c.w * c.r));
  coinStill = vmax < 20 && !held && !boxTouch && !suckOn ? coinStill + 1 : 0;   // coins on a card never sleep: the card floats under them
  drawCoins();
  coinRaf = coinStill > 60 ? 0 : requestAnimationFrame(coinTick);   // a settled pile sleeps until the next donation
}
/* every coin can be grabbed: a press on one (the topmost) holds it – it chases the pointer, shoves the others aside and is thrown with its last velocity on release.
   A grab is never a page turn, a swipe or a card drag: the press, its click and its touches stop at the window (capture). */
let held = null, hx = 0, hy = 0, eatClick = false, touchCoin = false;
const toStage = e => { const r = stage.getBoundingClientRect(); return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale]; };
const coinAt = (x, y) => { for (let i = coins.length - 1; i >= 0; i--) { const c = coins[i]; if ((c.x - x) ** 2 + (c.y - y) ** 2 < c.r * c.r) return c; } return null; };
addEventListener('pointerdown', e => {
  const [x, y] = toStage(e), c = !e.button && coinAt(x, y);
  eatClick = !!c; if (!c) return;
  e.stopPropagation(); e.preventDefault();
  held = c; hx = x; hy = y; touchCoin = e.pointerType === 'touch';
  coins.splice(coins.indexOf(c), 1); coins.push(c);   // drawn on top
  stage.classList.add('coin-drag'); coinStill = 0; coinRaf ||= requestAnimationFrame(coinTick);
}, true);
addEventListener('pointermove', e => {
  if (!coins.length) return;
  const [x, y] = toStage(e);
  if (held) { hx = x; hy = y; } else stage.classList.toggle('coin-over', !!coinAt(x, y));
  coinStill = 0; coinRaf ||= requestAnimationFrame(coinTick);   // a hovered or dragged card may shove the pile
});
new window.MutationObserver(() => { if (coins.length) { coinStill = 0; coinRaf ||= requestAnimationFrame(coinTick); } }).observe(deck, { subtree: true, attributeFilter: ['class'] });   // another slide, other cards: wake the pile
const letGo = () => { if (held) { held = null; stage.classList.remove('coin-drag'); } };
addEventListener('pointerup', letGo); addEventListener('pointercancel', letGo);
addEventListener('click', e => { if (eatClick) { eatClick = false; e.stopPropagation(); } }, true);
addEventListener('touchstart', e => { if (touchCoin) e.stopPropagation(); }, { capture: true, passive: true });
addEventListener('touchend', e => { if (touchCoin) { touchCoin = false; e.stopPropagation(); } }, { capture: true, passive: true });
const pop = (cls, html, x, y, ms = 2400) => {   // a one-shot stage element (author-made text only) that removes itself when its animation ends
  const el = document.createElement('div'); el.className = cls; el.innerHTML = html; el.style.left = `${x}px`; el.style.top = `${y}px`;
  el.addEventListener('animationend', e => { if (e.target === el) el.remove(); }); stage.append(el);
  if (tkReduced) setTimeout(() => el.remove(), ms);
  return el;
};
const toast = (big, small) => pop('sol-toast', `<b>${big}</b><span>${small}</span>`, 760 + Math.random() * 820, 150 + Math.random() * 520);
const shakeScreen = () => { if (!tkReduced) stage.animate({ translate: ['0 0', '-4px 2px', '3px -3px', '-2px 2px', '1px -1px', '0 0'] }, { duration: 320, easing: 'ease-out' }); };   // a very small jolt: the `translate` property, so fit()'s transform is untouched
function donate() {
  const [what, sol] = DONATE[Math.floor(Math.random() * DONATE.length)];
  toast(`+${sol.toFixed(2)} SOL`, `${what} · ${b58(4)}…${b58(4)}`); shakeScreen();
  if (tkReduced) return;
  for (let i = 5 + Math.floor(Math.random() * 5); i > 0; i--) coins.push({ x: 120 + Math.random() * 1680, y: -60 - Math.random() * 520, vx: (Math.random() - .5) * 260, vy: Math.random() * 200, r: 18 + Math.random() * 12, a: Math.random() * 6.3, w: (Math.random() - .5) * 8 });
  coins.splice(0, Math.max(0, coins.length - COIN_MAX));
  coinStill = 0; coinRaf ||= requestAnimationFrame(coinTick);
}

/* slide 3's "Web3 adoption" bullet: a click pulls every coin into it, one by one (nearest first) – each curves in, speeding up, shrinks to 0.1 and fades as it arrives,
   and pays out a little fiat: a "+$" and a bill pop out of the bullet, which gulps. A total toast once the stage is empty. */
const SUCK_MS = 1100, SUCK_FLY = .7;   // a coin's whole tween; the share of it spent flying (the rest: shrinking and fading at the bullet)
let suckOn = false, suckNext = 0, suckEvery = 200, suckUsd = 0, suckN = 0;
const sinkAt = () => { const r = deck.querySelector('.pts li.adopt .sink').getBoundingClientRect(), s = stage.getBoundingClientRect(); return [(r.left + r.width / 2 - s.left) / scale, (r.top + r.height / 2 - s.top) / scale]; };
function adopt() {
  if (suckOn) return;
  if (!coins.length) { toast('NO SOL YET', 'CLICK DONATIONS FIRST'); return; }
  if (tkReduced) { const n = coins.length; coins.length = 0; drawCoins(); toast(`+$${(n * 3.14).toFixed(2)}`, `${n} SOL ADOPTED`); return; }
  suckOn = true; suckNext = 0; suckUsd = 0; suckN = 0; suckEvery = Math.max(90, Math.min(260, 9000 / coins.length));   // the whole pile in about 9 s, never faster than 90 ms a coin
  coinStill = 0; coinRaf ||= requestAnimationFrame(coinTick);
}
function suckStep(t) {
  const [tx, ty] = sinkAt(), li = deck.querySelector('.pts li.adopt');
  if (t >= suckNext && coins.length) {   // the next coin: the nearest one not in a hand
    let best = -1, bd = Infinity;
    coins.forEach((c, i) => { const d = (c.x - tx) ** 2 + (c.y - ty) ** 2; if (c !== held && d < bd) { bd = d; best = i; } });
    if (best >= 0) { const [c] = coins.splice(best, 1); sucking.push({ c, x0: c.x, y0: c.y, t0: t, bend: (Math.random() - .5) * 320, sc: 1, al: 1, got: false }); }
    suckNext = t + suckEvery;
  }
  for (let i = sucking.length - 1; i >= 0; i--) {
    const s = sucking[i], c = s.c, p = Math.min(1, (t - s.t0) / SUCK_MS), m = Math.min(1, p / SUCK_FLY), e = m * m * m;   // ease-in: a vacuum pulls harder the closer it gets
    const dx = tx - s.x0, dy = ty - s.y0, len = Math.hypot(dx, dy) || 1, off = Math.sin(Math.PI * m) * s.bend;
    c.x = s.x0 + dx * e - dy / len * off; c.y = s.y0 + dy * e + dx / len * off; c.a += .08 + m * .5;
    if (m < 1) s.sc = 1 - .4 * e;
    else {
      const q = (p - SUCK_FLY) / (1 - SUCK_FLY); s.sc = .6 - .5 * q; s.al = 1 - q;
      if (!s.got) { s.got = true; payOut(tx, ty, li); }
    }
    if (p >= 1) sucking.splice(i, 1);
  }
  if (!coins.length && !sucking.length) { suckOn = false; toast(`+$${suckUsd.toFixed(2)}`, `${suckN} SOL · WEB3 ADOPTED`); }
}
/* slide 4's FREE / 1 H / 4 H / 8 H are buttons: a click hangs a second row of secret tiers under them, one by one on a chain (CSS delays by --i), each tile's text scrambling
   before it settles on ??? – another click takes them back up, last first; a click on a secret tile scrambles it again */
const SCRAMBLE = '#%&@$?<>/\\█▓▒░';
function scramble(el, final, ms) {
  const t0 = performance.now(), step = t => {
    const p = (t - t0) / ms;
    el.textContent = p >= 1 ? final : [...final].map((ch, i) => (p > (i + 1) / (final.length + 1) ? ch : SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)])).join('');   // letters lock in left to right
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
const scrambleTile = li => { scramble(li.querySelector('b'), '???', 700); scramble(li.querySelector('span'), 'secret', 900); };
function ladderClick(li) {
  li.animate({ scale: [1, .92, 1.06, 1] }, { duration: 300, easing: 'ease-out' });
  if (li.closest('.secret')) { if (!tkReduced) scrambleTile(li); return; }
  const box = li.closest('.ladders'), open = box.classList.toggle('open');
  if (open && !tkReduced) box.querySelectorAll('.secret li').forEach((s, i) => setTimeout(() => scrambleTile(s), 120 + i * 160));   // in step with the drop-in delays
}
function payOut(x, y, li) {   // one coin in: "+$", a bill thrown up and out, the bullet gulps
  const usd = 1 + Math.random() * 8; suckUsd += usd; suckN++;
  const a = pop('usd', `+$${usd.toFixed(2)}`, x + (Math.random() - .5) * 60, y - 10);
  a.style.setProperty('--dx', `${(Math.random() - .5) * 90}px`);
  const b = pop('bill', '💵', x, y);
  b.style.setProperty('--dx', `${(Math.random() - .5) * 420}px`); b.style.setProperty('--dy', `${-120 - Math.random() * 200}px`); b.style.setProperty('--rot', `${(Math.random() - .5) * 720}deg`);
  li.animate({ scale: [1, 1.1, 1] }, { duration: 240, easing: 'ease-out' });
}

/* dragging a screen: it follows the pointer at about half the distance, trailing behind (a slow lerp), and eases home when let go */
const drags = new Map(); let raf = 0, moved = false;
function trail() {
  let busy = false;
  drags.forEach((d, c) => {
    d.x += (d.tx - d.x) * .06; d.y += (d.ty - d.y) * .06;
    c.style.setProperty('--dx', `${d.x.toFixed(1)}px`); c.style.setProperty('--dy', `${d.y.toFixed(1)}px`);
    const b = c.closest('.vis').querySelector('.badge');   // the LIVE badge tags along, a bit
    if (b) { b.style.setProperty('--fx', `${(d.x * .6).toFixed(1)}px`); b.style.setProperty('--fy', `${(d.y * .6).toFixed(1)}px`); }
    if (!d.down && Math.abs(d.x) < .3 && Math.abs(d.y) < .3) { c.classList.remove('drag'); c.style.removeProperty('--dx'); c.style.removeProperty('--dy'); const b = c.closest('.vis').querySelector('.badge'); b?.style.removeProperty('--fx'); b?.style.removeProperty('--fy'); drags.delete(c); } else busy = true;
  });
  raf = busy ? requestAnimationFrame(trail) : 0;
}
deck.querySelectorAll('.fx .shot').forEach(c => {
  c.addEventListener('pointerdown', e => {
    if (e.button) return;
    try { c.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ }
    moved = false; c.classList.add('drag');
    drags.set(c, { x0: e.clientX, y0: e.clientY, x: drags.get(c)?.x ?? 0, y: drags.get(c)?.y ?? 0, tx: 0, ty: 0, down: true });
    raf ||= requestAnimationFrame(trail);
  });
  c.addEventListener('pointermove', e => {
    const d = drags.get(c); if (!d?.down) return;
    if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 6) moved = true;
    d.tx = Math.max(-150, Math.min(150, (e.clientX - d.x0) / scale * .5)); d.ty = Math.max(-110, Math.min(110, (e.clientY - d.y0) / scale * .5));
  });
  const end = () => { const d = drags.get(c); if (d) { d.down = false; d.tx = d.ty = 0; raf ||= requestAnimationFrame(trail); } };
  c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
});

/* the LIVE badge runs from the mouse: up to ~80 stage px within ~350 px of it, rightwards capped at 32 (the stage edge) */
const badge = document.querySelector('.fx .badge'), bd = { x: 0, y: 0 };
let mouse = null;
addEventListener('pointermove', e => { mouse = e.pointerType === 'touch' ? null : [e.clientX, e.clientY]; });
document.documentElement.addEventListener('pointerleave', () => { mouse = null; });
function badgeTick() {
  let tx = 0, ty = 0;
  if (badge && mouse && badge.closest('.slide.on')) {
    const r = badge.getBoundingClientRect(), R = 352 * scale;
    const dx = r.left + r.width / 2 - bd.x * scale - mouse[0], dy = r.top + r.height / 2 - bd.y * scale - mouse[1], dist = Math.hypot(dx, dy) || 1;   // from the resting centre
    if (dist < R) { const push = 80 * (1 - dist / R) ** 1.2; tx = Math.min(32, dx / dist * push); ty = dy / dist * push; }   // rightwards is capped: the stage edge is just there
  }
  bd.x += (tx - bd.x) * .14; bd.y += (ty - bd.y) * .14;
  badge?.style.setProperty('--bx', `${bd.x.toFixed(1)}px`); badge?.style.setProperty('--by', `${bd.y.toFixed(1)}px`);
  requestAnimationFrame(badgeTick);
}
if (badge) requestAnimationFrame(badgeTick);

addEventListener('pointerdown', e => { if (!e.target.closest('.fx .shot')) moved = false; }, true);   // a drag that ended off a card must not swallow the next click
addEventListener('click', e => {
  if (e.target.closest('.split')) return;   // the bar's own click handler (a tap opens / closes a block)
  if (e.target.closest('#ticker')) { tkHold = performance.now() + 1400; return; }   // a click on the header slows it for a moment instead of turning the page
  if (e.target.closest('.pts li.don')) { donate(); return; }   // slide 3: a mock donation, not a page turn
  if (e.target.closest('.pts li.adopt')) { adopt(); return; }   // slide 3: the coins go into Web3 adoption
  if (e.target.closest('.ladder li')) { ladderClick(e.target.closest('.ladder li')); return; }   // slide 4: the tiers are buttons
  const card = e.target.closest('.fx .shot, .fx .badge, .fx canvas.glyph, .L-wall .tags span, .cards5 .cc, .plan .bar');
  if (card) {
    if (moved) { moved = false; return; }   // the end of a drag is not a tap
    if (card.classList.contains('badge')) { card.classList.remove('pop'); void card.offsetWidth; card.classList.add('pop'); }   // a tween bump on every click
    const on = card.classList.toggle('hot'); (card.closest('.vis') ?? card.parentElement).querySelectorAll('.hot').forEach(c => { if (c !== card && on) c.classList.remove('hot'); });
    return;
  }
  if (e.target.closest('a,button')) return;
  show(cur + (e.clientX > innerWidth / 3 ? 1 : -1));
});

/* phones: a swipe turns the page, the tip says "swipe", a portrait screen is asked to turn sideways, and the gyro tilts the screens */
const touch = matchMedia('(hover: none) and (pointer: coarse)').matches;
document.body.classList.toggle('touch', touch);
let sx = 0, sy = 0, swipe = false;
addEventListener('touchstart', e => { swipe = !e.target.closest('.fx .shot'); sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
addEventListener('touchend', e => {
  if (!swipe) return;
  const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { flashTip(dx < 0 ? 'go-r' : 'go-l'); show(cur + (dx < 0 ? 1 : -1)); }
}, { passive: true });

const turn = document.getElementById('turn'), portrait = matchMedia('(orientation: portrait) and (max-width: 900px)');
let skipTurn = false;
const askTurn = () => { turn.hidden = !(portrait.matches && !skipTurn); };
portrait.addEventListener('change', askTurn); document.getElementById('turn-skip').addEventListener('click', () => { skipTurn = true; askTurn(); }); askTurn();

/* tilt: the phone's gyro drives the same --px / --py as the mouse (zeroed on the first reading and whenever the screen turns); iOS asks for permission on the first tap */
let base = null;
const onTilt = e => {
  if (e.gamma == null || e.beta == null || !fxVis.length) return;
  const a = ((window.screen.orientation?.angle ?? 0) + 360) % 360;
  const [x, y] = a === 90 ? [e.beta, -e.gamma] : a === 270 ? [-e.beta, e.gamma] : a === 180 ? [-e.gamma, -e.beta] : [e.gamma, e.beta];
  base ??= [x, y];
  const f = v => Math.max(-.5, Math.min(.5, v / 40)).toFixed(3);
  fxVis.forEach(v => setTilt(v, f(x - base[0]), f(y - base[1])));
};
const listenTilt = () => { addEventListener('deviceorientation', onTilt); window.screen.orientation?.addEventListener('change', () => { base = null; }); };
if (touch && window.DeviceOrientationEvent) {
  if (typeof window.DeviceOrientationEvent.requestPermission === 'function') {
    addEventListener('click', () => window.DeviceOrientationEvent.requestPermission().then(r => { if (r === 'granted') listenTilt(); }).catch(() => {}), { once: true });
  } else listenTilt();
}

const fromHash = () => show((parseInt(location.hash.slice(1), 10) || 1) - 1);
addEventListener('hashchange', fromHash);
fromHash();
