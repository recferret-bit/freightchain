/* Freight Chain pitch deck – the CONTENT: every slide's markup, and the data behind the interactive parts. Author-written constants only (the engine sets them with innerHTML).
   Media paths are absolute: on pitchdeck.<apex> a relative path would resolve against the host's /. */

const A = '/media/pitchdeck/';
export const BADGES = '/badges/';
/* media are LAZY: data-src / data-poster, turned into src by hydrate() (pitchdeck.js) when their slide – or one next to it – is shown; so opening the deck fetches one slide's pictures, not all eight's */
const shot = (src, cls = '', alt = '') => `<figure class="shot ${cls}"><img data-src="${A}${src}" alt="${alt}" decoding="async"></figure>`;
const clip = (src, cls = '') => `<figure class="shot clip ${cls}"><video data-src="${A}${src}" muted playsinline loop preload="none"></video></figure>`;   // promo-clip.mp4 = the promo's 16–24 s, cut once
const pts = items => `<ul class="pts">${items.map(i => Array.isArray(i) ? `<li class="${i[1]}">${i[0]}</li>` : `<li>${i}</li>`).join('')}</ul>`;   // [html, class] for a bullet that does something

/* slide 5 – the on-chain systems. `why` / `fit` show when a card is hovered or tapped; the statuses are honest (TEN4 is on localnet, the pool is devnet). */
const ACH_ICON = `<div class="ach"><div class="ach-stage"></div><div class="ach-cap"><em class="at"></em><b class="an"></b><span class="ad"></span></div></div>`;
const CHAIN = [
  { c: '#14f195', st: 'LIVE LOOKUP', h: 'SIWS & SNS', big: 'YOU.SOL', p: '1-click Sign-In With Solana, QR phone pairing, and .sol name lookup on your profile instead of a wallet string.', small: 'CAIP-122 · 24 h SNS cache',
    why: 'A 44-character address means nothing to a rider. A .sol name is a handle people remember and share.',
    fit: 'Sign-in uses 1-click SIWS or QR pairing, reads your favourite .sol name from chain, and caches it for 24 h.' },
  { c: '#ffcf5a', st: 'DEVNET · V5 BUILT', h: 'Escrow', big: '85 / 5 / 10', p: 'An Anchor program holds every pool (85% boards · 5% rollover · 10% Season Final) with player share capped < 50%.', small: '30 instructions · 28 events',
    why: 'A skill pool only works if nobody can run off with it and base funding exceeds the player bonus (< 50% player share).',
    fit: 'Funds sit in the vault. Winners are committed as a Merkle root after 48 h review, then paid by proof; a missed goal refunds.' },
  { c: '#ff5a4d', st: 'LIVE · DEVNET SOL', h: 'Donations', big: 'NIGHT · SINKHOLE', p: 'Spectators of a live ride can chat, tip SOL, pledge per km, or on free rides turn day to night or open a hole ahead.', small: 'One effect per 20 s · per-km pledges',
    why: 'Watching should be a way to play. A donation turns a quiet stream into an event, and the stream is our ad.',
    fit: 'A donation reaches the driver in ~4 s; the replay shows it ~25 s behind. Ranked runs keep road effects off.' },
  { c: '#b98cff', st: 'LIVE · DEVNET', h: 'Soulbound NFTs', big: '38 BADGES', p: 'Earned from verified rides across 10 ladders (incl. TEN4 & Convoy). Compressed NFTs, frozen in your wallet.', extra: ACH_ICON,
    why: 'Reputation you cannot buy. A badge proves what you actually drove, and it cannot be sold or lent.',
    fit: 'Unlocks are append-only. A separate key mints them after a 1 h re-check that skips rejected rides.' },
  { c: '#ffffff', st: 'LOCALNET · TGE MAR 2027', h: 'TEN4', big: '100M CAP', p: 'Fixed 100M supply (55M rides, 15M LP, 8M airdrop, 4M Convoy, 10M treasury, 8M team) minted at 20 / 50 / 100 % checkpoints.', small: '100k Pre-season + 2M S1 pts · cab & stream burns',
    why: 'A reason to drive beyond the prize pool: a score that is yours, and a currency for the 9-slot Garage and streams.',
    fit: 'Minted on verified paid rides (Era 1: 100 / 500 / 1,200 TEN4). Burn 1 in chat, 10 day/night, 25 weather, 65 / 260 for cab parts.' },
  { c: '#6fb0ff', st: 'DEVNET · PUBLIC', h: 'Blinks & Convoy', big: 'BUY IN A LINK', p: 'Solana Actions turn a link into a ticket buy, and Convoy ?ref= links reward inviters with a free ride, 3 paints, and 100 / 50 TEN4.', small: '/actions.json · ?ref= Convoy ladder',
    why: 'Buying a ticket or inviting a co-driver should take one tap from wherever people already are: a post, a chat, a link.',
    fit: 'Actions return one program-mode ticket to sign; ?ref= binds off chain and unlocks Convoy badges and TEN4.' },
];
const chainCard = c => `<article class="cc" style="--c:${c.c}"><span class="st">${c.st}</span><h3>${c.h}</h3><div class="big">${c.big}</div><p>${c.p}</p>${c.extra ?? `<small>${c.small}</small>`}<div class="more"><h4>Why</h4><p>${c.why}</p><h4>How it fits</h4><p>${c.fit}</p></div></article>`;

/* the 34 soulbound badge SVGs in public/badges/ (names and rules from server/src/domain/achievements/achievements.ts; Convoy + free-level ladders add 4+6 more) */
export const ACH = [
  ['first-mile', 'First Mile', 'Start your first ride.'], ['first-mile-2', 'Regular Hauler', 'Start 10 rides.'], ['first-mile-3', 'Road Dog', 'Start 50 rides.'], ['first-mile-4', 'Asphalt Legend', 'Start 250 rides.'],
  ['shift-complete', 'Shift Complete', 'Finish a paid shift.'], ['shift-complete-2', 'Shift Worker', 'Finish 5 paid shifts.'], ['shift-complete-3', 'Company Driver', 'Finish 25 paid shifts.'], ['shift-complete-4', 'Cargo Captain', 'Finish 100 paid shifts.'],
  ['night-owl', 'Night Owl', 'Finish a shift driven mostly in the dark.'], ['night-owl-2', 'Moonlighter', 'Finish 5 night shifts.'], ['night-owl-3', 'Graveyard Shift', 'Finish 20 night shifts.'], ['night-owl-4', 'Lord of the Dark', 'Finish 50 night shifts.'],
  ['century', 'Century', 'Drive 100 km in total.'], ['century-2', 'Five Hundred Club', 'Drive 500 km in total.'], ['century-3', 'Cross-Continental', 'Drive 2,000 km in total.'], ['century-4', 'Odometer Legend', 'Drive 10,000 km in total.'],
  ['clean-run', 'Clean Run', 'Finish a shift without a scratch.'], ['clean-run-2', 'Spotless', 'Finish 5 shifts without a scratch.'], ['clean-run-3', 'Untouchable', 'Finish 20 shifts without a scratch.'], ['clean-run-4', 'Mirror Finish', 'Finish 50 shifts without a scratch.'],
  ['cold-start', 'Cold Start', 'Finish a Trans-Siberian shift.'], ['cold-start-2', 'Permafrost Hauler', 'Finish 5 Siberian shifts.'], ['cold-start-3', 'Ice Road King', 'Finish 15 Siberian shifts.'], ['cold-start-4', 'Siberian Legend', 'Finish 40 Siberian shifts.'],
  ['on-my-own', 'On My Own', 'Complete a free ride without assist.'], ['on-my-own-2', 'No Training Wheels', 'Complete 5 free rides without assist.'], ['on-my-own-3', 'Hands of Steel', 'Complete 20 free rides without assist.'], ['on-my-own-4', 'Pure Driver', 'Complete 50 free rides without assist.'],
  ['free-easy', 'Learner\'s Permit', 'Clear the EASY free run.'], ['free-crossroads', 'Crossroads', 'Clear the MEDIUM free run.'], ['free-hard', 'Long Haul', 'Clear the HARD free run.'],
  ['honk-haul', 'First Mint', 'A verified paid ride mints TEN4.'], ['honk-haul-2', 'Checkpoint Hauler', 'Five verified paid rides mint the finish band.'], ['honk-haul-3', 'Long Haul Mint', 'Twenty-five verified paid rides mint the finish band.'],
];
const TIER = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];
export const achTier = id => id.startsWith('free-') ? 'LICENCE' : TIER[(id.match(/-(\d)$/)?.[1] ?? 1) - 1];

/* slide 6 – the plan: four windows (Nov – Mar), one lane each; a bar spans the months it runs. `more` shows on hover / tap. It is a plan, not a promise: the audit gates the mainnet, the mainnet gates the token. */
const MONTHS = [['NOV', 'PRE-SEASON · 2026'], ['DEC', 'AUDIT & LEGAL'], ['JAN', 'SEASON 1 · 2027'], ['FEB–MAR', 'FINAL & TEN4 TGE']];
const PLAN = [
  { k: 'PRE-SEASON', sub: 'Nov 2–17 · devnet', c: '#ff5a4d', from: 1, to: 1, t: '$500 USDC + 100k TEN4 pts', n: '1 h board · Top 20 · free entry',
    more: 'Nov 2–17 Pre-season: $500 USDC 1 h board (Top 20: $100–$12, equal ties) + 100,000 TEN4 points (50k board + 50k referrals).' },
  { k: 'LOAD · AUDIT', sub: 'legal, security, v5', c: '#ffcf5a', from: 1, to: 2, t: 'Skill-contest legal → v5 audit', n: 'server + freightchain_pools v5',
    more: 'Skill-contest opinion (< 50% player share, AMOE, equal ties), KYC/geo gates, load test, and Program v5 audit.' },
  { k: 'COMMUNITY', sub: 'streamers & Convoy', c: '#b98cff', from: 1, to: 4, t: 'Streamers · Convoy ?ref= · cups', n: 'build in public, every week',
    more: 'Streamer runs, Convoy ?ref= ladder (free ride + 3 paints + 100/50 TEN4), Discord and weekly cups.' },
  { k: 'SEASON 1', sub: 'Jan 11 – Feb 28 · 7 wk', c: '#14f195', from: 3, to: 4, t: '7-week Season 1 + Live Final', n: '85 / 5 / 10 · $300→$3,000/wk base',
    more: '6 regular weeks (1h 25% · 4h 30% · 8h 45%, 80% top-10 + 20% finishers) + Week 7 Final ($1,000 base + 10% reserve) + 2M TEN4 pts.' },
  { k: 'TOKEN LAUNCH', sub: 'TEN4 · Mar 2027', c: '#ffffff', from: 4, to: 4, t: 'TEN4 TGE · 100M fixed cap', n: '15M LP · 8M Merkle · 55M rides',
    more: 'March 2027 TGE: 100M supply (55M rides, 15M LP, 8M airdrop, 4M Convoy, 10M treasury, 8M team) + cab & stream burns.' },
  { k: 'AI MODS', sub: '3D editor + MCP live', c: '#ff9ad5', from: 3, to: 4, t: 'AI-built mods via MCP', n: 'vehicles, props, landmarks',
    more: 'Describe a vehicle, prop or landmark to an AI; our MCP server builds it in the 3D editor with signed publishing.' },
  { k: 'NEW GAME MODES', sub: 'convoys & fixed-point', c: '#6fb0ff', from: 3, to: 4, t: 'Team convoys · fixed-point', n: 'same road, same verification',
    more: '3–5 driver convoys sharing a side pot by combined distance, plus an input-only fixed-point replay core.' },
];

/* the storybook sneak peek: real screenshots of the model viewer (client/viewer.html#<id>) – shown one after another while the card is hovered / tapped */
export const STORY = [['storybook.webp', 'car'], ['storybook-truck.webp', 'truck'], ['storybook-police.webp', 'police car'], ['storybook-fire.webp', 'fire truck'], ['storybook-diner.webp', 'roadside diner'], ['storybook-truckstop.webp', 'truck stop'], ['storybook-cactus.webp', 'desert cactus']];

/* slide 8 – go to market as six highway exits, in the order they come up (the months match the plan slide); `more` is the back of the sign (hover / tap) */
const EXITS = [
  { t: 'Co-driver wanted', s: 'co-founder: growth & partners', when: 'NOW',
    more: 'Built solo so far. The next leg needs a second seat: growth, partners and community, while I keep the game and chain.' },
  { t: '$500 Pre-season', s: 'Nov 2–17 · $500 USDC + 100k TEN4', when: 'NOV',
    more: 'Zero-entry Pre-season on the 1 h board: $500 USDC Top-20 table + 100,000 TEN4 points (50k board + 50k referrals).' },
  { t: 'Streamers & Convoy', s: 'CB streams + ?ref= referral loop', when: 'NOV',
    more: 'Streamers drive live while chat tips and triggers effects; Convoy ?ref= links gift a free ride, 3 paints, and 100/50 TEN4.' },
  { t: 'Audit & compliance', s: '< 50% player share · AMOE · audit', when: 'DEC',
    more: 'Program v5 enforces < 50% player share on chain, with weekly AMOE tickets, equal ties, KYC/geo gates, and audit.' },
  { t: 'Season 1 Mainnet', s: '7-week season + Week 7 Final', when: 'JAN',
    more: 'Jan 11 – Feb 28: base $300 → $3,000/wk across 1h/4h/8h boards (85/5/10), $1,000 Final, and 2M TEN4 points.' },
  { t: 'TEN4 TGE & Garage', s: '100M fixed cap · cab & stream burns', when: 'MAR', sol: true,
    more: 'March 2027: 100M TEN4 launch (15M LP, 8M airdrop, 55M rides, 4M Convoy) burned in the 9-slot Garage and streams.' },
];
/* the truck that drives to the exit you look at: a side view facing right (trailer, red cab with an exhaust stack, four wheels with a spoke each, so they visibly turn) */
const TRUCK = `<svg viewBox="0 0 184 74" aria-hidden="true"><rect x="2" y="6" width="118" height="46" rx="5" fill="#ece6d3"/><text x="61" y="35" text-anchor="middle" font-family="Anton,Impact,sans-serif" font-size="15" fill="#050505" letter-spacing="1">FREIGHT CHAIN</text><rect x="127" y="0" width="5" height="17" rx="2" fill="#9a9a9a"/><path d="M124 54V22a7 7 0 0 1 7-7h23l22 22v17z" fill="#ff3b2f"/><path d="M154 20h-19v15h33z" fill="#bfe6ff"/><rect x="0" y="52" width="178" height="6" rx="2" fill="#2b2b2b"/>${[22, 48, 140, 164].map(x => `<g class="wh"><circle cx="${x}" cy="60" r="10" fill="#111" stroke="#777" stroke-width="3"/><path d="M${x} 52v16" stroke="#777" stroke-width="2"/></g>`).join('')}</svg>`;

export const SLIDES = [
  { layout: 'wall', id: 'product',
    html: `
      <div class="copy">
        <div class="lbl">00 · The product</div>
        <h1>Freight Chain<small>Competitive · GameFi</small></h1>
        ${pts(['<b>Site</b> · landing, lobby, whitepaper', '<b>Streams</b> · live watch + replays', '<b>Analytics</b> · PostHog funnels', '<b>Solana</b> · Program v5 escrow + TEN4', '<b>Details</b> · gearbox, cold engine, night', '<b>Passion</b> · built solo, shipped fast'])}
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
        ${pts(['Unlimited training · no download', 'Weekly granted 1 h ticket (AMOE)', 'Watch live or replay · no wallet', 'Nov 2–17: $500 USDC + 100k TEN4', '1-click SIWS or QR phone pairing'])}
        <div class="ladders"><ol class="ladder">
          <li class="on"><b>FREE</b><span>3–30 min</span></li>
          <li class="on"><b>1 H</b><span>$5 · Sprint</span></li>
          <li><b>4 H</b><span>$15 · Haul</span></li>
          <li><b>8 H</b><span>$50 · Long</span></li>
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
        <div class="split" role="group" aria-label="85 percent prizes, 5 percent to the next pool, 10 percent Season Final and fee">
          <div style="--w:85"><b>85%</b><i class="desc">Of every pool: weekly boards (80% top 10, 20% finishers)</i><span>weekly boards · by skill</span></div>
          <div style="--w:5"><b>5%</b><i class="desc">Of every pool: seeds the next pool</i><span>next pool</span></div>
          <div style="--w:10"><b>10%</b><i class="desc">Of every pool: Season Final &amp; fee</i><span>final · fee</span></div>
        </div>
        ${pts(['Player share capped &lt; 50% on chain', 'Too few tickets · refund, without me', 'Pays only attested rides via Merkle root'])}
        <div class="fine">DEVNET · V5 BUILT · &lt; 50% PLAYER SHARE</div>
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
        <h1>The next <em>5 months.</em></h1>
      </div>
      <div class="vis peek">
        <figure class="shot peek-card"><span class="pk-imgs">${STORY.map(([f, n], i) => `<img class="${i ? '' : 'on'}" data-src="${A}${f}" alt="Storybook sneak peek: ${n}" decoding="async">`).join('')}</span><i class="pk-flash"></i><em class="pk-name">${STORY[0][1]}</em></figure>
        <div class="badge live peekb"><i class="dot"></i>SNEAK PEEK · STORYBOOK · AI + MCP</div>
      </div>
      <div class="plan">
        <div class="pr today"><span class="pin"><i></i>TODAY · OCT 17</span></div>
        ${MONTHS.map((m, i) => `<div class="pr mo" style="--m:${i + 1}"><b>${m[0]}</b><small>${m[1]}</small></div>`).join('')}
        ${PLAN.map((l, i) => `<div class="pl" style="--c:${l.c};--i:${i};grid-row:${i + 2}"><b>${l.k}</b><small>${l.sub}</small></div>
        <div class="bar${l.from === l.to ? ' n1' : ''}" style="--c:${l.c};--i:${i};grid-row:${i + 2};grid-column:${l.from + 1} / ${l.to + 2}"><b>${l.t}</b><small>${l.n}</small><p>${l.more}</p></div>`).join('')}
      </div>` },

  { layout: 'gtm', id: 'market',
    html: `
      <div class="copy">
        <div><div class="lbl">07 · Go to market</div><h1>Six exits <em>to market.</em></h1></div>
        <p class="gfine">Revenue · 10 % Season Final / fee + TEN4 cab &amp; stream burns<br>A plan, not a promise · Nov Pre-season → Dec audit → Jan Season 1 → Mar TEN4 TGE</p>
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
  'Unlimited training + 1 weekly granted ticket', 'Three free levels: easy · medium · hard', 'Five routes', 'Live watch and replays · no wallet to watch', '38 soulbound badges across 10 ladders',
  ['code', 'GEAR_RATIOS = [0, 6.15, 4.33, 3.05, 2.15, 1.51, 1.065, 0.75]'],
  ['code', 'thrust = (TRUCK_POWER / TRUCK_MASS) * ratio ** TRUCK_GEAR_EXP * gas'],
  ['code', 'drag = ROLL_RES + (DRAG / MASS) * v * v + offroad * 1.2 + brake * 5.5'],
  ['code', 'v = max(0, min(HOLE_REF_SPEED, v + (thrust - drag) * h))'],
  'Physics at 10 Hz · 2 substeps · the server re-runs every ride',
  ['code', 'TRUCK_MASS = 2.5 · TRUCK_POWER = 2.4 · TRUCK_BRAKE = 5.5'],
  ['code', 'TORQUE_PEAK = 2000 rpm · SHIFT_TIME = 0.4 s'],
  ['code', 'HOLE_CHANCE = 0.045 · HOLE_FIRST = 150 · OFFROAD_FAIL_SECONDS = 20'],
  ['code', 's = (s + 0x6D2B79F5) | 0   // mulberry32: the same road in your browser and on the server'],
  'Vanilla ES modules · three.js r160 · no build step · no framework', 'NestJS · Prisma · PostgreSQL', 'Prize pool split 85 / 5 / 10 · player share < 50%',
  'Solana devnet · $500 Pre-season Nov 2–17 · TEN4 100M cap', ['code', 'program id 8No42h2QXb9opgp3pJfNXL2o77o288SsF8o7CwJGCA1p'], 'Anchor program v5 · 30 instructions · 28 events · 50 errors',
  'Built solo in Belgrade'];

/* donations on slide 3 (a show, not the game's own effect prices) and the real SOL price: a snapshot, not a feed – the deck makes no request of its own.
   CoinGecko $104.24 / Binance $104.47 on Oct 15 2026; ~$104.3. Update the number before presenting if the market has moved. */
export const SOL_USD = 104.3;
export const DONATE = [['TIP', 0.15], ['NIGHT', 0.25], ['DAY', 0.25], ['POTHOLES', 0.4], ['TRENCH', 0.6], ['SINKHOLE', 1]];
