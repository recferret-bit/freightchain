/* The profile's ACHIEVEMENTS: one ladder per family (3-4 tiers, easy → hard), each tier an earned or a locked card. An earned card shows its badge art and the state of
   its soulbound compressed NFT (docs/agents/achievements.md); a locked one shows the badge in steel and how far along the rider is. Server text only through textContent. */
import { el } from './dom.js';
import { CLUSTER, explorerTx, explorerUrl, shortAddr, xIntent } from './pools.js';

/** the art: /site/img/achievements/<id>.svg (earned) and <id>-locked.svg, drawn by design/achievements/generate.mjs. Resolved from this module so a split-host lobby finds it. */
const art = (id, locked) => new URL(`./img/achievements/${id}${locked ? '-locked' : ''}.svg`, import.meta.url).href;

const FAMILY_TITLE = { road: 'ROAD', shift: 'SHIFTS', night: 'NIGHT', distance: 'DISTANCE', clean: 'CLEAN', siberia: 'SIBERIA', solo: 'SOLO', licence: 'LICENCE' };

const q = cluster => (cluster ? `?cluster=${cluster}` : '');
/** where to look at a compressed NFT: Solana Explorer, Solscan and Orb all index cNFTs through DAS; the mint transaction is the receipt that never depends on an indexer */
export const nftLinks = (assetId, signature, cluster = CLUSTER) => [
  ['explorer', 'Explorer', explorerUrl(assetId, cluster)],
  ['solscan', 'Solscan', `https://solscan.io/token/${encodeURIComponent(assetId)}${q(cluster)}`],
  ['orb', 'Orb', `https://orb.helius.dev/address/${encodeURIComponent(assetId)}${q(cluster)}`],
  ...(signature ? [['tx', 'mint tx', explorerTx(signature, cluster)]] : []),
];
export const badgeShareText = a => `Earned “${a.name}” (${a.tierName}) in @FreightChainSol – a soulbound compressed NFT on @solana devnet, minted to my wallet. Proof:`;

/** the NFT line under an earned badge */
function nftLine(a, track) {
  const n = a.nft, click = link => () => track('achievement_nft_clicked', { achievement_id: a.id, tier: a.tier, link });
  const when = el('span', { class: 'when' }, `unlocked ${new Date(a.earnedAt).toLocaleDateString()}`);
  if (!n) return when;
  if (n.status === 'minted' && n.assetId) {
    const links = nftLinks(n.assetId, n.signature);
    return el('span', { class: 'nft' },
      el('span', { class: 'when' }, 'cNFT ', el('a', { href: links[0][2], target: '_blank', rel: 'noopener', title: `soulbound compressed NFT ${n.assetId} (Solana explorer)`, onclick: click('explorer') }, `${shortAddr(n.assetId)} ↗`)),
      el('span', { class: 'lk' }, links.slice(1).map(([k, label, href]) => el('a', { href, target: '_blank', rel: 'noopener', onclick: click(k) }, label)),
        el('a', { href: xIntent(badgeShareText(a), links[0][2]), target: '_blank', rel: 'noopener', onclick: click('share'), title: 'Post this badge on X' }, 'POST ON X')));
  }
  if (n.status === 'planned' || n.status === 'sent') return el('span', { class: 'when mint' }, 'minting to your wallet…');
  if (n.status === 'failed') return el('span', { class: 'when warn' }, 'mint on hold – we are looking at it');
  return when;
}

function card(a, track) {
  const earned = !!a.earnedAt, pct = a.progress.target ? Math.round((100 * a.progress.value) / a.progress.target) : 0;
  return el('div', { class: `ac t${a.tier}${earned ? ' got' : ' lock'}`, 'data-id': a.id, 'data-tier': a.tier },
    el('img', { src: art(a.id, !earned), alt: `${a.name} – ${earned ? a.tierName : 'locked'}`, loading: 'lazy', width: 112, height: 112 }),
    el('span', { class: 'nm' }, a.name),
    el('span', { class: 'tr' }, a.tierName.toUpperCase()),
    el('span', { class: 'ds' }, a.desc),
    earned
      ? nftLine(a, track)
      : el('span', { class: 'pg', title: `${a.progress.value} / ${a.progress.target}` }, el('i', { style: `width:${pct}%` }), el('em', {}, `${a.progress.value.toLocaleString('en')} / ${a.progress.target.toLocaleString('en')}`)));
}

/** the profile section: header + the families + the legacy "awarded at round close" cards */
export function achievementsSection(achievements, track = () => {}, badgeChain = null) {
  const mintable = achievements.filter(a => !a.awardedAtRoundClose), got = mintable.filter(a => a.earnedAt).length;
  const families = [...new Set(mintable.map(a => a.family))];
  return [
    el('h2', {}, `ACHIEVEMENTS · ${got}/${mintable.length}`),
    el('div', { class: 'ach-fam', id: 'ach' }, families.map(f => el('div', { class: 'fam', 'data-family': f },
      el('h3', {}, FAMILY_TITLE[f] ?? f.toUpperCase()),
      el('div', { class: 'ladder' }, mintable.filter(a => a.family === f).sort((x, y) => x.tier - y.tier).map(a => card(a, track)))))),
    ...achievements.filter(a => a.awardedAtRoundClose).map(a => el('div', { class: 'a lock soon' }, el('span', { class: 'ic' }, a.icon), el('span', { class: 'nm' }, a.name), el('span', { class: 'ds' }, a.desc), el('span', { class: 'when' }, 'awarded when the round closes'))),
    ...(badgeChain ? [el('p', { class: 'dim ach-chain' }, 'The badge collection ', el('a', { href: explorerUrl(badgeChain.collection), target: '_blank', rel: 'noopener', onclick: () => track('achievement_nft_clicked', { link: 'collection' }) }, `${shortAddr(badgeChain.collection)} ↗`),
      ' · Merkle tree ', el('a', { href: explorerUrl(badgeChain.tree), target: '_blank', rel: 'noopener', onclick: () => track('achievement_nft_clicked', { link: 'tree' }) }, `${shortAddr(badgeChain.tree)} ↗`),
      ' · Phantom, Solflare and Backpack list them under your collectibles; if a wallet or marketplace does not show them yet, the links on each badge always do.')] : []),
    el('p', { class: 'dim' }, 'Every achievement is minted as a soulbound compressed NFT to your wallet (Solana) a little after you earn it – it can’t be sold or moved, and it can’t be lost.'),
  ];
}
