#!/usr/bin/env node
/** Read @FreightChainSol and @FreightChainGame. Prints one JSON object. Does not write the README.
 *  Three passes. A total is omitted when a pass is partial, blocked, or disagrees with the second source. */

import { collectVideoItems, parseExactCount, parseXProfile, pickPass, readWatchPage, reconcileX, reconcileYouTube, selfTest } from './clean.mjs';

const HANDLE = 'FreightChainSol';
const CHANNEL = 'UC11gGly1Nzw40_CgSxbNGlg';
const YT_HANDLE = '@FreightChainGame';
const PASSES = 3;
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const BOT = 'freightchain-traction/1.0';
const YT_CLIENT = { clientName: 'WEB', clientVersion: '2.20241010.00.00', hl: 'en', gl: 'US' };

if (process.argv.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function get(url, { ua = BROWSER, json = false, attempts = 3 } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': ua, 'Accept-Language': 'en-US,en' }, redirect: 'follow' });
      if (res.status === 429 || res.status >= 500) {
        last = new Error(`HTTP ${res.status}`);
        await sleep(600 * (i + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return json ? await res.json() : await res.text();
    } catch (error) {
      last = error;
      await sleep(400 * (i + 1));
    }
  }
  throw last ?? new Error(`failed ${url}`);
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': BROWSER, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function youtubeBrowse(params) {
  const payload = { context: { client: YT_CLIENT }, browseId: CHANNEL };
  if (params) payload.params = params;
  return postJson('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', payload);
}

function headerCounts(root) {
  const texts = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.content === 'string') texts.push(node.content);
    for (const value of Object.values(node)) walk(value);
  };
  walk(root);
  const videos = texts.map(parseExactCount).find((n, i) => n != null && /videos?$/i.test(texts[i]));
  const subscribers = texts.map(parseExactCount).find((n, i) => n != null && /subscribers?$/i.test(texts[i]));
  return { videos: videos ?? null, subscribers: subscribers ?? null };
}

function tabsOf(root) {
  const tabs = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.tabRenderer) {
      const tab = node.tabRenderer;
      tabs.push({
        title: tab.title ?? '',
        params: tab.endpoint?.browseEndpoint?.params ?? null,
      });
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(root);
  return tabs;
}

async function listVideos() {
  const home = await youtubeBrowse();
  const tabs = tabsOf(home);
  const params = new Map();
  for (const tab of tabs) if (tab.params) params.set(tab.title.toLowerCase(), tab.params);
  if (!params.has('videos')) params.set('videos', 'EgZ2aWRlb3PyBgQKAjoA');
  if (!params.has('shorts')) params.set('shorts', 'EgZzaG9ydHPyBgUKA5oBAA==');
  const items = new Map();
  let header = headerCounts(home);
  for (const name of ['videos', 'shorts']) {
    const page = await youtubeBrowse(params.get(name));
    const pageHeader = headerCounts(page);
    if (header.videos == null && pageHeader.videos != null) header = pageHeader;
    if (header.subscribers == null && pageHeader.subscribers != null) header = { ...header, subscribers: pageHeader.subscribers };
    for (const item of collectVideoItems(page)) {
      const prev = items.get(item.id);
      items.set(item.id, { ...prev, ...item, tab: prev ? 'both' : name });
    }
  }
  return { header, items: [...items.values()] };
}

async function watchViews(id) {
  const html = await get(`https://www.youtube.com/watch?v=${id}&hl=en&gl=US`, { attempts: 3 });
  return readWatchPage(html);
}

async function aboutViews() {
  const html = await get(`https://www.youtube.com/${YT_HANDLE}/about?hl=en&gl=US`);
  const m = html.match(/"viewCountText":"([^"]+)"/);
  return m ? parseExactCount(m[1]) : null;
}

async function oneYouTubePass() {
  const [{ header, items }, about] = await Promise.all([listVideos(), aboutViews()]);
  const detailed = [];
  for (const item of items) {
    const watch = await watchViews(item.id);
    if (watch.exclude) detailed.push({ ...item, exclude: watch.exclude });
    else detailed.push({ ...item, views: watch.views });
    await sleep(150);
  }
  const reconciled = reconcileYouTube({ items: detailed, listedVideos: header.videos, aboutViews: about });
  return { ...reconciled, subscribers: header.subscribers };
}

async function mirrorProfile() {
  const [fx, vx] = await Promise.all([
    get(`https://api.fxtwitter.com/${HANDLE}`, { ua: BOT, json: true }),
    get(`https://api.vxtwitter.com/${HANDLE}`, { ua: BOT, json: true }),
  ]);
  const a = fx?.user;
  const postsA = a?.tweets;
  const postsB = vx?.tweet_count;
  const followersA = a?.followers;
  const followersB = vx?.followers_count;
  if (a?.screen_name !== HANDLE || vx?.screen_name !== HANDLE) throw new Error('mirror returned a different account');
  if (postsA !== postsB || followersA !== followersB) {
    return { error: 'mirrors-disagree', postsA, postsB, followersA, followersB };
  }
  return { posts: postsA, followers: followersA, following: a.following ?? null };
}

async function oneXPass(mirror) {
  const html = await get(`https://x.com/${HANDLE}`);
  const profile = parseXProfile(html, HANDLE);
  if (profile.error) return profile;
  const checks = new Map();
  for (const item of profile.items) {
    try {
      const body = await get(`https://api.fxtwitter.com/${HANDLE}/status/${item.id}`, { ua: BOT, json: true, attempts: 2 });
      const tweet = body?.tweet;
      if (!tweet || tweet.author?.screen_name !== HANDLE) checks.set(item.id, { error: 'author' });
      else if (tweet.views == null) checks.set(item.id, { error: 'no-views' });
      else checks.set(item.id, { views: Number(tweet.views) });
    } catch (error) {
      checks.set(item.id, { error: error.message });
    }
    await sleep(120);
  }
  return reconcileX({
    profile,
    mirrorPosts: mirror.posts,
    mirrorFollowers: mirror.followers,
    checks,
  });
}

function sameIdSet(passes) {
  const sets = passes.map((pass) => new Set(pass.kept.map((item) => item.id)));
  const first = [...sets[0]].sort().join();
  return sets.every((set) => [...set].sort().join() === first);
}

async function youtube() {
  const passes = [];
  let lastError = null;
  for (let i = 0; i < PASSES; i++) {
    try {
      passes.push(await oneYouTubePass());
    } catch (error) {
      lastError = error.message;
    }
    await sleep(500);
  }
  const full = passes.filter((pass) => pass.complete && pass.views != null);
  const pool = full.length ? full : passes;
  if (!pool.length) return { error: lastError ?? 'no-pass', views: null, complete: false };
  if (!sameIdSet(pool)) return { error: 'passes-disagree-on-ids', views: null, complete: false, passes: pool.length };
  const views = pool.map((pass) => pass.coveredViews);
  const min = Math.min(...views);
  const max = Math.max(...views);
  if (max - min > Math.max(10, Math.round(max * 0.05))) {
    return { error: 'view-total-moved', min, max, views: null, complete: false };
  }
  const best = pool[pool.length - 1];
  return {
    handle: YT_HANDLE,
    url: `https://www.youtube.com/${YT_HANDLE}`,
    channelId: CHANNEL,
    subscribers: best.subscribers ?? null,
    listedVideos: best.listedVideos,
    videos: best.kept.length,
    views: best.complete ? max : null,
    coveredViews: max,
    complete: best.complete,
    aboutViews: best.aboutViews,
    aboutNote: best.aboutNote,
    excluded: best.excluded,
    items: best.kept.map((item) => ({
      id: item.id,
      title: item.title,
      views: item.views,
      url: `https://www.youtube.com/watch?v=${item.id}`,
      tab: item.tab ?? null,
    })),
    passes: pool.length,
  };
}

async function x() {
  let mirror = null;
  let mirrorError = null;
  for (let i = 0; i < PASSES; i++) {
    try {
      const read = await mirrorProfile();
      if (read.error) mirrorError = read.error;
      else { mirror = read; break; }
    } catch (error) {
      mirrorError = error.message;
    }
    await sleep(400);
  }
  if (!mirror) return { error: mirrorError ?? 'no-mirror', handle: HANDLE, views: null, complete: false };
  const passes = [];
  for (let i = 0; i < PASSES; i++) {
    try { passes.push(await oneXPass(mirror)); } catch (error) { passes.push({ error: error.message }); }
    await sleep(500);
  }
  const picked = pickPass(passes);
  if (picked.error) return { ...picked, handle: HANDLE, url: `https://x.com/${HANDLE}`, followers: mirror.followers };
  return {
    handle: HANDLE,
    url: `https://x.com/${HANDLE}`,
    posts: picked.posts,
    followers: mirror.followers,
    following: mirror.following,
    listed: picked.listed,
    views: picked.views,
    coveredViews: picked.coveredViews,
    complete: picked.complete,
    excluded: picked.excluded,
    items: picked.kept.map((item) => ({
      id: item.id,
      views: item.views,
      text: (item.text ?? '').replace(/\s+/g, ' ').slice(0, 140),
      url: `https://x.com/${HANDLE}/status/${item.id}`,
    })),
    note: picked.complete
      ? null
      : `Profile counts ${picked.posts} posts. ${picked.listed} are on the public posts tab with a view count checked twice. Logged-out X does not serve the replies tab, so those views are not guessed.`,
    passes: picked.passes,
  };
}

const [xResult, youtubeResult] = await Promise.all([x(), youtube()]);
const report = {
  fetchedAt: new Date().toISOString(),
  x: xResult,
  youtube: youtubeResult,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(xResult.coveredViews == null && youtubeResult.coveredViews == null ? 1 : 0);
