/* The profile's ACHIEVEMENTS: one ladder per family (3-4 tiers, easy → hard), each tier an earned or a locked card. An earned card shows its badge art and the state of
   its soulbound compressed NFT (docs/spec/web3_solana.md); a locked one shows the badge in steel and how far along the rider is. Server text only through textContent. */
import { el } from './dom.js';
import { bindFlipCards } from './effects.js';
import { extLink } from './ui.js';
import { CLUSTER, explorerTx, explorerUrl, shortAddr, xIntent } from './pools.js';

/** the art: /site/img/achievements/<id>.svg (earned) and <id>-locked.svg, drawn by design/achievements/generate.mjs. Resolved from this module so a split-host lobby finds it. */
const art = (id, locked) => new URL(`./img/achievements/${id}${locked ? '-locked' : ''}.svg`, import.meta.url).href;

const FAMILY_TITLE = { road: 'ROAD', shift: 'SHIFTS', night: 'NIGHT', distance: 'DISTANCE', clean: 'CLEAN', siberia: 'SIBERIA', solo: 'SOLO', licence: 'LICENCE', medium: 'MEDIUM', hard: 'HARD', honk: 'TEN4', convoy: 'CONVOY' };

const q = cluster => (cluster ? `?cluster=${cluster}` : '');
/** where to look at a compressed NFT: Solana Explorer, Solscan and Orb all index cNFTs through DAS; the mint transaction is the receipt that never depends on an indexer */
export const nftLinks = (assetId, signature, cluster = CLUSTER) => [
  ['explorer', 'Explorer', explorerUrl(assetId, cluster)],
  ['solscan', 'Solscan', `https://solscan.io/token/${encodeURIComponent(assetId)}${q(cluster)}`],
  ['orb', 'Orb', `https://orb.helius.dev/address/${encodeURIComponent(assetId)}${q(cluster)}`],
  ...(signature ? [['tx', 'mint tx', explorerTx(signature, cluster)]] : []),
];
export const badgeShareText = a => `Earned “${a.name}” (${a.tierName}) in @FreightChainSol – a soulbound compressed NFT on @solana${CLUSTER === 'devnet' ? ' devnet' : ''}, minted to my wallet. Proof:`;

const fmtDate = t => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** the back of an earned card: where the soulbound compressed NFT lives (cNFT, Solscan, Orb, the mint transaction) and the share link */
function nftLinksRow(a, track) {
  const n = a.nft, click = link => () => track('achievement_nft_clicked', { achievement_id: a.id, tier: a.tier, link });
  if (n && n.status === 'minted' && n.assetId) {
    const links = nftLinks(n.assetId, n.signature), ln = (k, label, href, extra = {}) => extLink(href, { onclick: click(k), ...extra }, label);
    return el('span', { class: 'lk' },
      ln('explorer', 'cNFT', links[0][2], { title: `soulbound compressed NFT ${n.assetId} (Solana Explorer)` }),
      links.slice(1).map(([k, label, href]) => ln(k, label, href)),
      ln('share', 'Post on X', xIntent(badgeShareText(a), links[0][2]), { class: 'x', title: 'Post this badge on X' }));
  }
  if (n && (n.status === 'planned' || n.status === 'sent')) return el('span', { class: 'when mint' }, 'minting to your wallet…');
  if (n && n.status === 'skipped') return el('span', { class: 'when dim' }, 'no NFT was minted for this one');
  if (n && n.status === 'failed') return el('span', { class: 'when warn' }, 'mint on hold – we are looking at it');
  return null;
}

/** one tier = one flip card: the front is the badge, the date (or the progress) and – for the next level up – what to do; the back (hover / tap) the condition and the NFT links */
function card(a, track, next, i) {
  const earned = !!a.earnedAt, pct = a.progress.target ? Math.round((100 * a.progress.value) / a.progress.target) : 0;
  const prog = () => el('span', { class: 'pg', title: `${a.progress.value} / ${a.progress.target}` }, el('i', { style: `width:${pct}%` }), el('em', {}, `${a.progress.value.toLocaleString('en')} / ${a.progress.target.toLocaleString('en')}`));
  const front = el('div', { class: 'fr' },
    el('img', { src: art(a.id, !earned), alt: `${a.name} – ${earned ? `level ${a.tier}` : 'locked'}`, loading: 'lazy', width: 112, height: 112 }),
    el('span', { class: 'nm' }, a.name),
    earned ? el('span', { class: 'when' }, `✓ ${fmtDate(a.earnedAt)}`) : [next ? el('span', { class: 'nx' }, a.desc) : null, prog()]);
  const back = el('div', { class: 'bk' },
    el('span', { class: 'nm' }, a.name),
    el('span', { class: 'ds' }, a.desc),
    earned ? [el('span', { class: 'when' }, `unlocked ${fmtDate(a.earnedAt)}`), nftLinksRow(a, track)] : [prog(), el('span', { class: 'when dim' }, 'earn it to get a soulbound cNFT')]);
  const c = el('div', { class: `ac t${a.tier}${earned ? ' got' : ' lock'}${next ? ' next' : ''}`, 'data-id': a.id, 'data-tier': a.tier, tabindex: 0, role: 'button', 'aria-label': `${a.name} – details`, 'aria-expanded': 'false', style: `--i:${i}`, title: 'Hover or tap for details' }, el('div', { class: 'in' }, front, back));
  bindFlipCards([c]);
  return c;
}

/** the profile section: header + the families + the legacy "awarded at round close" cards */
export function achievementsSection(achievements, track = () => {}, badgeChain = null) {
  const mintable = achievements.filter(a => !a.awardedAtRoundClose), got = mintable.filter(a => a.earnedAt).length;
  const families = [...new Set(mintable.map(a => a.family))];
  return [
    el('h2', {}, `ACHIEVEMENTS · ${got}/${mintable.length}`),
    el('div', { class: 'ach-fam', id: 'ach' }, families.map(f => el('div', { class: 'fam', 'data-family': f },
      el('h3', {}, FAMILY_TITLE[f] ?? f.toUpperCase()),
      el('div', { class: 'ladder' }, (list => { const nextId = list.find(a => !a.earnedAt)?.id; return list.map((a, i) => card(a, track, a.id === nextId, i)); })(mintable.filter(a => a.family === f).sort((x, y) => x.tier - y.tier)))))),
    ...achievements.filter(a => a.awardedAtRoundClose).map(a => el('div', { class: 'a lock soon' }, el('span', { class: 'ic' }, a.icon), el('span', { class: 'nm' }, a.name), el('span', { class: 'ds' }, a.desc), el('span', { class: 'when' }, 'awarded when the round closes'))),
    ...(badgeChain ? [el('p', { class: 'dim ach-chain' }, 'The badge collection ', extLink(explorerUrl(badgeChain.collection), { onclick: () => track('achievement_nft_clicked', { link: 'collection' }) }, `${shortAddr(badgeChain.collection)} ↗`),
      ' · Merkle tree ', extLink(explorerUrl(badgeChain.tree), { onclick: () => track('achievement_nft_clicked', { link: 'tree' }) }, `${shortAddr(badgeChain.tree)} ↗`),
      ' · Phantom, Solflare and Backpack list them under your collectibles; if a wallet or marketplace does not show them yet, the links on the back of each badge always do.')] : []),
    el('p', { class: 'dim' }, 'Every achievement is minted as a soulbound compressed NFT to your wallet (Solana) a little after you earn it – it can’t be sold or moved, and it can’t be lost.'),
  ];
}

