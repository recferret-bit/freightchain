/** Pure checks for a social read. No network. A figure reaches a total only after these pass. */

const TOMBSTONE = /unavailable|this post (was|has been) deleted|account is suspended|this video isn't available|private video|removed by the uploader/i;
const INEXACT = /[kmb]\b|\d\.\d/i;

export function parseExactCount(text) {
  if (text == null) return null;
  const raw = String(text).trim();
  if (!raw || INEXACT.test(raw)) return null;
  const m = raw.match(/^(\d{1,3}(?:,\d{3})*|\d+)\b/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return n;
}

/** Keep the smaller object that still carries a title, so a page-sized blob does not win. */
export function preferItem(prev, next) {
  if (!prev) return next;
  const prevOk = Boolean(prev.title);
  const nextOk = Boolean(next.title);
  if (nextOk && !prevOk) return next;
  if (prevOk && !nextOk) return prev;
  return next.size < prev.size ? next : prev;
}

export function findStrings(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (typeof node.content === 'string') out.push(node.content);
  if (typeof node.simpleText === 'string') out.push(node.simpleText);
  for (const value of Object.values(node)) findStrings(value, out);
  return out;
}

function fromLockup(lock) {
  const title = lock?.metadata?.lockupMetadataViewModel?.title?.content ?? null;
  const strings = findStrings(lock?.metadata ?? {});
  const gridText = strings.find((s) => /^\d[\d,]* views?$/i.test(s.trim()));
  const id = JSON.stringify(lock).match(/"videoId":"([\w-]{11})"/)?.[1] ?? null;
  if (!id) return null;
  return { id, title, gridViews: parseExactCount(gridText), gridText: gridText ?? null, size: 1 };
}

function fromShort(lock) {
  const id = lock?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId
    ?? String(lock?.entityId ?? '').replace(/^shorts-shelf-item-/, '');
  if (!/^[\w-]{11}$/.test(id)) return null;
  const text = lock?.accessibilityText ?? '';
  const m = text.match(/^(.*), ([\d,]+) views - play Short$/);
  return { id, title: m?.[1] ?? null, gridViews: m ? parseExactCount(m[2]) : null, gridText: m?.[2] ?? null, size: 1 };
}

export function collectVideoItems(root) {
  const found = new Map();
  const add = (item) => { if (item) found.set(item.id, preferItem(found.get(item.id), item)); };
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.lockupViewModel) add(fromLockup(node.lockupViewModel));
    if (node.shortsLockupViewModel) add(fromShort(node.shortsLockupViewModel));
    for (const value of Object.values(node)) walk(value);
  };
  walk(root);
  return [...found.values()].map(({ size, ...item }) => item);
}

const UNAVAILABLE = /this video isn't available|video unavailable|private video|removed by the uploader|sign in to confirm your age/i;

/** A watch-page read. Missing and upcoming are not zero.
 *  The player bundle says "unavailable" on a normal watch page, so that word
 *  only counts when there is no viewCount. */
export function readWatchPage(html) {
  if (!html) return { exclude: 'unavailable' };
  const m = html.match(/"viewCount":"(\d+)"/);
  if (m) {
    const views = Number(m[1]);
    if (!Number.isSafeInteger(views) || views < 0) return { exclude: 'bad-view-count' };
    if (views === 0 && /"isUpcoming":true/.test(html)) return { exclude: 'upcoming' };
    return { views };
  }
  if (/"isUpcoming":true/.test(html)) return { exclude: 'upcoming' };
  return UNAVAILABLE.test(html) ? { exclude: 'unavailable' } : { exclude: 'no-view-count' };
}

/**
 * Headline views are the sum of per-video counts.
 * The channel About number is a check. When it is lower, YouTube has not rolled
 * shorts into it, so it must not replace the sum. When it is higher, some
 * public videos were not listed.
 */
export function reconcileYouTube({ items, listedVideos, aboutViews }) {
  const excluded = [];
  const kept = [];
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) {
      excluded.push({ id: item.id, reason: 'duplicate' });
      continue;
    }
    seen.add(item.id);
    if (item.exclude) {
      excluded.push({ id: item.id, reason: item.exclude });
      continue;
    }
    if (!Number.isSafeInteger(item.views) || item.views < 0) {
      excluded.push({ id: item.id, reason: 'bad-view-count' });
      continue;
    }
    if (item.gridViews != null) {
      const gap = Math.abs(item.views - item.gridViews);
      const tol = Math.max(5, Math.round(item.views * 0.05));
      if (gap > tol) {
        excluded.push({ id: item.id, reason: 'grid-disagrees', views: item.views, gridViews: item.gridViews });
        continue;
      }
    }
    kept.push(item);
  }
  const views = kept.reduce((sum, item) => sum + item.views, 0);
  let complete = listedVideos != null && kept.length === listedVideos;
  let aboutNote = null;
  if (listedVideos == null) aboutNote = 'channel video count was not on the page';
  if (aboutViews != null && aboutViews > views) {
    complete = false;
    aboutNote = 'channel About count is higher than the videos that were listed';
  } else if (aboutViews != null && aboutViews < views) {
    aboutNote = 'That figure lags the videos and was not used';
  }
  if (listedVideos != null && kept.length !== listedVideos) {
    complete = false;
    aboutNote = aboutNote ?? `channel says ${listedVideos} videos, ${kept.length} had a view count`;
  }
  return { kept, excluded, views: complete ? views : null, coveredViews: views, complete, aboutNote, listedVideos, aboutViews };
}

export function parseXProfile(html, handle) {
  if (!html || html.length < 20000) return { error: 'short-page' };
  if (/just a moment|cf-browser-verification|enable javascript/i.test(html) && !html.includes(`@${handle}`)) {
    return { error: 'blocked' };
  }
  if (!html.includes(handle)) return { error: 'wrong-account' };
  const posts = Number(html.match(/tweet_counts:\$R\[\d+\]=\{tweets:(\d+)\}/)?.[1]);
  const follow = html.match(/relationship_counts:\$R\[\d+\]=\{followers:(\d+),following:(\d+)\}/);
  if (!Number.isSafeInteger(posts)) return { error: 'no-post-count' };
  const items = [];
  const re = /views:\$R\[\d+\]=\{count:"(\d+)"\}[\s\S]{0,160}?entry_id:"tweet-(\d+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const views = Number(m[1]);
    const id = m[2];
    const at = m.index;
    const back = html.slice(Math.max(0, at - 12000), at);
    const text = readFullText(back);
    const retweet = /retweeted_status|Reposted/.test(back.slice(-600));
    items.push({ id, views, text, retweet });
  }
  return {
    posts,
    followers: follow ? Number(follow[1]) : null,
    following: follow ? Number(follow[2]) : null,
    items,
  };
}

function readFullText(back) {
  const at = back.lastIndexOf('full_text:"');
  if (at < 0) return null;
  let i = at + 'full_text:"'.length;
  let out = '';
  while (i < back.length) {
    const ch = back[i];
    if (ch === '\\') {
      const n = back[i + 1];
      out += n === 'n' ? '\n' : n === '"' ? '"' : n ?? '';
      i += 2;
      continue;
    }
    if (ch === '"') break;
    out += ch;
    i += 1;
  }
  return out;
}

export function reconcileX({ profile, mirrorPosts, mirrorFollowers, checks }) {
  const excluded = [];
  if (!profile || profile.error) return { error: profile?.error ?? 'no-profile', excluded, kept: [], views: null, complete: false };
  if (mirrorPosts != null && mirrorPosts !== profile.posts) {
    return { error: 'post-count-disagrees', profilePosts: profile.posts, mirrorPosts, excluded, kept: [], views: null, complete: false };
  }
  if (mirrorFollowers != null && profile.followers != null && mirrorFollowers !== profile.followers) {
    return { error: 'follower-count-disagrees', excluded, kept: [], views: null, complete: false };
  }
  const seen = new Set();
  const kept = [];
  for (const item of profile.items) {
    if (seen.has(item.id)) {
      excluded.push({ id: item.id, reason: 'duplicate' });
      continue;
    }
    seen.add(item.id);
    if (item.retweet) {
      excluded.push({ id: item.id, reason: 'repost' });
      continue;
    }
    if (item.text && TOMBSTONE.test(item.text)) {
      excluded.push({ id: item.id, reason: 'tombstone' });
      continue;
    }
    if (!Number.isSafeInteger(item.views) || item.views < 0) {
      excluded.push({ id: item.id, reason: 'bad-view-count' });
      continue;
    }
    const check = checks?.get(item.id);
    let unchecked = false;
    if (check && check.views != null) {
      const gap = Math.abs(check.views - item.views);
      const tol = Math.max(3, Math.round(item.views * 0.1));
      if (gap > tol) {
        excluded.push({ id: item.id, reason: 'second-source-disagrees', views: item.views, other: check.views });
        continue;
      }
      item.views = Math.max(item.views, check.views);
    } else {
      // A failed second read is not a zero and is not dropped. The passes still have to agree.
      unchecked = true;
    }
    kept.push({ id: item.id, views: item.views, text: item.text, unchecked });
  }
  const coveredViews = kept.reduce((sum, item) => sum + item.views, 0);
  const complete = kept.length === profile.posts && kept.every((item) => !item.unchecked) && excluded.length === 0;
  return {
    posts: profile.posts,
    followers: profile.followers,
    following: profile.following,
    kept,
    excluded,
    coveredViews,
    views: complete ? coveredViews : null,
    listed: kept.length,
    complete,
  };
}

/** Drop a pass that lost posts the other passes saw, or whose view count fell. */
export function pickPass(passes) {
  const good = passes.filter((pass) => pass && !pass.error && pass.kept);
  if (!good.length) return { error: passes.find((pass) => pass?.error)?.error ?? 'no-pass' };
  const most = Math.max(...good.map((pass) => pass.kept.length));
  const full = good.filter((pass) => pass.kept.length === most);
  const byId = new Map();
  for (const pass of full) {
    for (const item of pass.kept) {
      const prev = byId.get(item.id);
      if (!prev) byId.set(item.id, [item.views]);
      else prev.push(item.views);
    }
  }
  const views = new Map();
  for (const [id, list] of byId) {
    if (list.length !== full.length) return { error: 'passes-disagree-on-ids' };
    const min = Math.min(...list);
    const max = Math.max(...list);
    if (min < max * 0.5 && max - min > 20) return { error: 'view-count-fell', id };
    views.set(id, max);
  }
  const base = full[full.length - 1];
  const kept = base.kept.map((item) => ({ ...item, views: views.get(item.id) }));
  const coveredViews = kept.reduce((sum, item) => sum + item.views, 0);
  return { ...base, kept, coveredViews, views: base.complete ? coveredViews : null, passes: full.length };
}

export function selfTest() {
  const failures = [];
  const check = (name, ok) => { if (!ok) failures.push(name); };
  check('exact', parseExactCount('9 views') === 9);
  check('commas', parseExactCount('1,234 videos') === 1234);
  check('reject-k', parseExactCount('1.2K views') === null);
  check('reject-decimal', parseExactCount('16.0K views') === null);
  check('watch', readWatchPage('{"viewCount":"960","isUpcoming":false} video unavailable')?.views === 960);
  const listed = collectVideoItems({
    lockupViewModel: { metadata: { lockupMetadataViewModel: { title: { content: 'Cab' } } }, videoId: 'aaaaaaaaaaa' },
    shortsLockupViewModel: { entityId: 'shorts-shelf-item-bbbbbbbbbbb', onTap: { innertubeCommand: { reelWatchEndpoint: { videoId: 'bbbbbbbbbbb' } } }, accessibilityText: 'A short, 12 views - play Short' },
  });
  check('titles', listed.find((item) => item.id === 'aaaaaaaaaaa')?.title === 'Cab' && listed.find((item) => item.id === 'bbbbbbbbbbb')?.gridViews === 12);
  check('upcoming', readWatchPage('{"isUpcoming":true,"viewCount":"0"}')?.exclude === 'upcoming');
  check('missing-not-zero', readWatchPage('<html>no count</html>')?.exclude === 'no-view-count');
  const html = [
    'FreightChainSol',
    'relationship_counts:$R[42]={followers:6,following:29}',
    'tweet_counts:$R[43]={tweets:2}',
    'full_text:"Hello road"',
    'views:$R[1]={count:"10"}',
    'entry_id:"tweet-111"',
    'full_text:"This Post was deleted"',
    'views:$R[2]={count:"4"}',
    'entry_id:"tweet-222"',
  ].join(',');
  const parsed = parseXProfile(html.padEnd(20000, ' '), 'FreightChainSol');
  check('parse-posts', parsed.posts === 2 && parsed.items.length === 2);
  const reconciled = reconcileX({
    profile: parsed,
    mirrorPosts: 2,
    mirrorFollowers: 6,
    checks: new Map([['111', { views: 10 }], ['222', { views: 4 }]]),
  });
  check('drop-tombstone', reconciled.kept.length === 1 && reconciled.kept[0].id === '111');
  check('incomplete', reconciled.complete === false && reconciled.views === null && reconciled.coveredViews === 10);
  const unchecked = reconcileX({
    profile: { ...parsed, posts: 1, items: parsed.items.filter((item) => item.id === '111') },
    mirrorPosts: 1,
    mirrorFollowers: 6,
    checks: new Map([['111', { error: 'down' }]]),
  });
  check('keep-when-mirror-blips', unchecked.kept.length === 1 && unchecked.complete === false && unchecked.views === null);
  const youtube = reconcileYouTube({
    items: [
      { id: 'aaaaaaaaaaa', views: 10, gridViews: 10, title: 'A' },
      { id: 'aaaaaaaaaaa', views: 10, gridViews: 10, title: 'A again' },
      { id: 'bbbbbbbbbbb', views: 100, gridViews: 400, title: 'B' },
    ],
    listedVideos: 2,
    aboutViews: 5,
  });
  check('yt-dedupe', youtube.excluded.some((row) => row.reason === 'duplicate'));
  check('yt-grid', youtube.excluded.some((row) => row.reason === 'grid-disagrees'));
  check('yt-about-not-used', youtube.aboutNote?.includes('lags') && youtube.coveredViews === 10);
  const picked = pickPass([
    { kept: [{ id: '1', views: 5, text: 'a' }], complete: false, posts: 2 },
    { kept: [{ id: '1', views: 3, text: 'a' }], complete: false, posts: 2 },
  ]);
  check('views-rise', picked.kept?.[0].views === 5);
  const fell = pickPass([
    { kept: [{ id: '1', views: 100, text: 'a' }], complete: true, posts: 1 },
    { kept: [{ id: '1', views: 10, text: 'a' }], complete: true, posts: 1 },
  ]);
  check('views-fell', fell.error === 'view-count-fell');
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  console.log('social-fetch self-test ok');
}
