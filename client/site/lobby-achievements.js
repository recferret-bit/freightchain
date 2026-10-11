/* The profile's ACHIEVEMENTS: one ladder per family (3-4 tiers, easy → hard), each tier an earned or a locked card. An earned card shows its badge art and the state of
   its soulbound compressed NFT (docs/agents/achievements.md); a locked one shows the badge in steel and how far along the rider is. Server text only through textContent. */
import { el } from './dom.js';
import { explorerUrl, shortAddr } from './pools.js';

/** the art: /site/img/achievements/<id>.svg (earned) and <id>-locked.svg, drawn by design/achievements/generate.mjs. Resolved from this module so a split-host lobby finds it. */
const art = (id, locked) => new URL(`./img/achievements/${id}${locked ? '-locked' : ''}.svg`, import.meta.url).href;

const FAMILY_TITLE = { road: 'ROAD', shift: 'SHIFTS', night: 'NIGHT', distance: 'DISTANCE', clean: 'CLEAN', siberia: 'SIBERIA', solo: 'SOLO', licence: 'LICENCE' };

/** the NFT line under an earned badge */
function nftLine(a, track) {
  const n = a.nft;
  if (!n) return el('span', { class: 'when' }, `unlocked ${new Date(a.earnedAt).toLocaleDateString()}`);
  if (n.status === 'minted' && n.assetId) {
    return el('span', { class: 'when' }, 'cNFT ',
      el('a', { href: explorerUrl(n.assetId), target: '_blank', rel: 'noopener', title: `soulbound compressed NFT ${n.assetId} (Solana explorer)`, onclick: () => track('achievement_nft_clicked', { achievement_id: a.id, tier: a.tier }) }, `${shortAddr(n.assetId)} ↗`));
  }
  if (n.status === 'planned' || n.status === 'sent') return el('span', { class: 'when mint' }, 'minting to your wallet…');
  if (n.status === 'failed') return el('span', { class: 'when warn' }, 'mint on hold – we are looking at it');
  return el('span', { class: 'when' }, `unlocked ${new Date(a.earnedAt).toLocaleDateString()}`);
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
export function achievementsSection(achievements, track = () => {}) {
  const mintable = achievements.filter(a => !a.awardedAtRoundClose), got = mintable.filter(a => a.earnedAt).length;
  const families = [...new Set(mintable.map(a => a.family))];
  return [
    el('h2', {}, `ACHIEVEMENTS · ${got}/${mintable.length}`),
    el('div', { class: 'ach-fam', id: 'ach' }, families.map(f => el('div', { class: 'fam', 'data-family': f },
      el('h3', {}, FAMILY_TITLE[f] ?? f.toUpperCase()),
      el('div', { class: 'ladder' }, mintable.filter(a => a.family === f).sort((x, y) => x.tier - y.tier).map(a => card(a, track)))))),
    ...achievements.filter(a => a.awardedAtRoundClose).map(a => el('div', { class: 'a lock soon' }, el('span', { class: 'ic' }, a.icon), el('span', { class: 'nm' }, a.name), el('span', { class: 'ds' }, a.desc), el('span', { class: 'when' }, 'awarded when the round closes'))),
    el('p', { class: 'dim' }, 'Every achievement is minted as a soulbound compressed NFT to your wallet (Solana) a little after you earn it – it can’t be sold or moved, and it can’t be lost.'),
  ];
}
