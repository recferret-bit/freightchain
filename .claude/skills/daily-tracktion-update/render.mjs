/** README traction block. Numbers come from the fetch. This file does not invent any. */

const START = '<!-- traction:start -->';
const END = '<!-- traction:end -->';

export function comma(n) {
  if (!Number.isSafeInteger(n)) return null;
  return n.toLocaleString('en-US');
}

const BANNER = '<img src="landing/public/media/day.webp"';

/** The Traction heading sits on the line after the game banner. */
export function placeTraction(readme) {
  const heading = '## Traction\n';
  const endMark = '<!-- traction:end -->';
  const start = readme.indexOf(heading);
  const end = readme.indexOf(endMark);
  const img = readme.indexOf(BANNER);
  if (start < 0 || end < start || img < 0) return readme;
  const block = readme.slice(start, end + endMark.length).trim();
  const lineEnd = readme.indexOf('\n', img);
  if (lineEnd < 0) return readme;
  if (readme.slice(lineEnd).replace(/^\n+/, '').startsWith(heading) && start < lineEnd + 40) return readme;
  const without = `${readme.slice(0, start)}${readme.slice(end + endMark.length)}`.replace(/\n{3,}/g, '\n\n');
  const img2 = without.indexOf(BANNER);
  const line2 = without.indexOf('\n', img2);
  if (img2 < 0 || line2 < 0) return readme;
  return `${without.slice(0, line2 + 1)}\n${block}\n\n${without.slice(line2 + 1).replace(/^\n+/, '')}`;
}

export function spliceTraction(readme, block) {
  if (readme.includes(START) && readme.includes(END)) {
    const next = readme.replace(
      new RegExp(`${START}[\\s\\S]*?${END}`),
      `${START}\n\n${block.trim()}\n\n${END}`,
    );
    if (next === readme) throw new Error('traction markers did not move');
    if (next.includes('## The truck') === false && readme.includes('## The truck')) {
      throw new Error('splice ate the following section');
    }
    return next;
  }
  const heading = '## Traction\n';
  const at = readme.indexOf(heading);
  const to = readme.indexOf('\n## The truck\n');
  if (at < 0 || to < at) throw new Error('no Traction section before The truck');
  return `${readme.slice(0, at + heading.length)}\n${START}\n\n${block.trim()}\n\n${END}\n${readme.slice(to)}`;
}

function posthogWindow(insights) {
  const windows = insights?.windows ?? [];
  return windows.find((window) => window.label?.includes('through')) ?? windows[0] ?? null;
}

function shownTotal(complete, total, covered) {
  if (complete && Number.isSafeInteger(total)) return total;
  if (Number.isSafeInteger(covered) && covered > 0) return covered;
  return null;
}

function cell(value, label, detail) {
  const shown = value == null ? '—' : value;
  return `<td align="center" width="20%"><h2>${shown}</h2><b>${label}</b><br>${detail}</td>`;
}

function row(cells) {
  return cells.filter(Boolean).map(([k, v]) => `| ${k} | ${v} |`).join('\n');
}

export function renderTraction({ fetchedAt, social, stats, insights }) {
  const when = fetchedAt?.slice(0, 16).replace('T', ' ') ?? 'unknown';
  const yt = social?.youtube ?? {};
  const x = social?.x ?? {};
  const ytViews = shownTotal(yt.complete, yt.views, yt.coveredViews);
  const xViews = shownTotal(x.complete, x.views, x.coveredViews);
  const lines = [];
  lines.push(`Public numbers for a reviewer, read ${when} UTC. Each headline was fetched three times. A partial page, a deleted post, a repost, a premiere, or a count the second source did not support is not in a headline. Links go to the page the number was read from.`);
  lines.push('');
  lines.push('<table><tr>');
  lines.push(cell(
    comma(ytViews ?? yt.coveredViews),
    yt.complete ? 'YouTube views' : 'YouTube views read',
    `${yt.videos ?? '—'} videos${yt.subscribers != null ? ` · ${comma(yt.subscribers)} subscribers` : ''}<br><a href="https://www.youtube.com/@FreightChainGame">@FreightChainGame</a>`,
  ));
  lines.push(cell(
    comma(x.posts),
    'X posts',
    `<a href="https://x.com/FreightChainSol">@FreightChainSol</a>${x.followers != null ? `<br>${comma(x.followers)} followers` : ''}`,
  ));
  lines.push(cell(
    comma(xViews ?? (x.listed ? x.coveredViews : null)),
    x.complete ? 'X views' : 'X views on public posts',
    x.complete ? 'every post on the profile' : `${x.listed ?? 0} of ${x.posts ?? '—'} posts have a public view count`,
  ));
  lines.push(cell(
    stats ? comma(stats.rides) : null,
    'shifts started',
    stats ? `${comma(stats.ridesCompleted)} finished · <a href="https://freightchain.fun/api/stats">api/stats</a>` : 'public stats unread',
  ));
  lines.push(cell(
    stats ? `${(stats.metres / 1000).toFixed(1)} km` : null,
    'driven',
    stats ? `${comma(stats.drivers)} drivers · ${comma(stats.crashes)} crashes` : '',
  ));
  lines.push('</tr>');
  const open = posthogWindow(insights);
  lines.push('<tr>');
  lines.push(cell(
    open ? comma(open.landingPeople) : null,
    'landing people',
    open ? `PostHog · ${open.label}` : 'PostHog unread',
  ));
  lines.push(cell(
    open ? comma(open.whitepaperPeople) : null,
    'whitepaper readers',
    'PostHog · same window',
  ));
  lines.push(cell(
    open ? comma(open.signinsReal) : null,
    'wallet sign-ins',
    'real wallets · demo excluded',
  ));
  lines.push(cell(
    open ? comma(open.startsReal) : null,
    'real shifts started',
    open && Number.isSafeInteger(open.startsDemo) ? `${comma(open.startsDemo)} demo starts` : 'server events',
  ));
  lines.push(cell(
    open && Number.isSafeInteger(open.completesReal) && Number.isSafeInteger(open.completesDemo)
      ? comma(open.completesReal + open.completesDemo)
      : null,
    'shifts finished',
    open ? `${comma(open.completesDemo)} demo · ${comma(open.completesReal)} real` : 'PostHog unread',
  ));
  lines.push('</tr></table>');
  lines.push('');
  lines.push('The second row is PostHog Cloud EU, project 297915. Probe events (`surface=prod-check`) are out. Ride counts are `source=server`. Demo wallets are separate from real ones. Client `ride_completed` is not counted.');
  lines.push('');
  if (yt.aboutNote) lines.push(`YouTube channel About says ${yt.aboutViews == null ? 'no total' : `${comma(yt.aboutViews)} views`}. ${yt.aboutNote}. The headline is the sum of the videos below.`);
  if (x.note) lines.push(x.note);
  if (!yt.complete && yt.error) lines.push(`YouTube total withheld: ${yt.error}.`);
  if (x.error) lines.push(`X total withheld: ${x.error}.`);
  lines.push('');
  lines.push('### YouTube');
  lines.push('');
  lines.push('Watch-page `viewCount` for every video on the Videos and Shorts tabs. The grid count had to land within 5%.');
  lines.push('');
  if (yt.items?.length) {
    lines.push('| Video | Views |');
    lines.push('| --- | ---: |');
    for (const item of [...yt.items].sort((a, b) => b.views - a.views)) {
      const title = (item.title || item.id).replace(/\|/g, '/');
      lines.push(`| [${title}](${item.url}) | ${comma(item.views)} |`);
    }
    lines.push(`| **Sum** | **${comma(yt.coveredViews)}** |`);
  } else lines.push('No video passed the checks.');
  if (yt.excluded?.length) {
    lines.push('');
    lines.push(`Left out: ${yt.excluded.map((row) => `${row.id} (${row.reason})`).join(', ')}.`);
  }
  lines.push('');
  lines.push('### X');
  lines.push('');
  lines.push('Profile post count is the number both public mirrors returned. View counts are the posts tab, checked against the status endpoint.');
  lines.push('');
  if (x.items?.length) {
    lines.push('| Post | Views |');
    lines.push('| --- | ---: |');
    for (const item of [...x.items].sort((a, b) => b.views - a.views)) {
      const text = (item.text || item.id).replace(/\|/g, '/');
      lines.push(`| [${text}](${item.url}) | ${comma(item.views)} |`);
    }
    lines.push(`| **Sum of these posts** | **${comma(x.coveredViews)}** |`);
  } else lines.push('No public post passed the checks.');
  if (x.excluded?.length) {
    lines.push('');
    lines.push(`Left out: ${x.excluded.map((row) => `${row.id} (${row.reason})`).join(', ')}.`);
  }
  lines.push('');
  lines.push('### The product');
  lines.push('');
  lines.push('These are [`https://freightchain.fun/api/stats`](https://freightchain.fun/api/stats), read twice. Free and paid are the split of shifts started. The site and this table use this response, not a PostHog chart.');
  lines.push('');
  if (stats && open && Number.isSafeInteger(open.completesReal) && Number.isSafeInteger(open.completesDemo)
    && open.completesReal + open.completesDemo === stats.ridesCompleted) {
    lines.push(`PostHog counts those ${comma(stats.ridesCompleted)} finished shifts as ${comma(open.completesDemo)} demo-wallet finishes and ${comma(open.completesReal)} others. A demo wallet runs the paid clock at 1/60.`);
  }
  if (!stats) lines.push('The public stats endpoint did not return two matching reads.');
  else {
    lines.push('');
    lines.push('| | |');
    lines.push('| --- | ---: |');
    lines.push(row([
      ['Shifts started', comma(stats.rides)],
      ['Free', comma(stats.ridesFree)],
      ['Paid', comma(stats.ridesPaid)],
      ['Finished', comma(stats.ridesCompleted)],
      ['Driven', `${(stats.metres / 1000).toFixed(1)} km`],
      ['Time', formatSeconds(stats.seconds)],
      ['Crashes', comma(stats.crashes)],
      ['Drivers', comma(stats.drivers)],
      ['Stream donations', comma(stats.donations)],
    ]));
  }
  lines.push('');
  lines.push('### Analytics');
  lines.push('');
  lines.push('Insight definitions are checked by `posthog-audit` (EU project 297915, dashboard 1006663). That skill does not change PostHog from here. Probe events (`surface=prod-check`) are not in the counts. A server ride event is `source=server`. Demo wallets are separate. Client `ride_completed` is not a metric.');
  lines.push('');
  if (insights?.audit) {
    const audit = insights.audit;
    lines.push(`Audit: ${audit.fixes} fix${audit.fixes === 1 ? '' : 'es'} waiting, ${audit.matching} insights match the spec, ${audit.leftAlone} left off the judge board.${audit.exitCode === 0 ? '' : ' Exit 1 means a fix is waiting. It was not applied.'}`);
    if (audit.fixNames?.length) lines.push(`Waiting: ${audit.fixNames.join('; ')}.`);
  } else lines.push('The insight audit did not run.');
  if (insights?.windows?.length) {
    lines.push('');
    lines.push('| Window | Landing people | Real finishes | Demo finishes | Real sign-ins |');
    lines.push('| --- | ---: | ---: | ---: | ---: |');
    for (const window of insights.windows) {
      lines.push(`| ${window.label} | ${show(window.landingPeople)} | ${show(window.completesReal)} | ${show(window.completesDemo)} | ${show(window.signinsReal)} |`);
    }
  } else if (insights?.error) lines.push(`Live insight counts were not written: ${insights.error}.`);
  if (insights?.disagreement) lines.push(insights.disagreement);
  lines.push('');
  lines.push('Refresh with `node .claude/skills/daily-tracktion-update/update.mjs`. The raw read is `docs/traction/latest.json`.');
  return lines.join('\n');
}

function show(n) {
  return Number.isSafeInteger(n) ? comma(n) : '—';
}

function formatSeconds(seconds) {
  if (!Number.isSafeInteger(seconds) || seconds < 0) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes} min`;
  return `${hours} h ${minutes} min`;
}

export function acceptStats(body) {
  if (!body || typeof body !== 'object') return null;
  const keys = ['rides', 'ridesFree', 'ridesPaid', 'ridesCompleted', 'seconds', 'metres', 'crashes', 'crashesVehicle', 'crashesBuilding', 'donations', 'donationLamports', 'drivers'];
  for (const key of keys) if (!Number.isSafeInteger(body[key]) || body[key] < 0) return null;
  if (body.rides !== body.ridesFree + body.ridesPaid) return null;
  if (body.ridesCompleted > body.rides) return null;
  if (body.crashes !== body.crashesVehicle + body.crashesBuilding) return null;
  if (!Number.isSafeInteger(body.updatedAt) || body.updatedAt < 1_700_000_000_000) return null;
  if (body.updatedAt > Date.now() + 86_400_000) return null;
  return body;
}

export function selfTest() {
  const failures = [];
  const check = (name, ok) => { if (!ok) failures.push(name); };
  const readme = '# Hi\n\n## Traction\n\nold paragraph\n\n## The truck\n\nstays\n';
  const next = spliceTraction(readme, 'NEW');
  check('insert', next.includes('<!-- traction:start -->') && next.includes('NEW') && next.includes('## The truck') && !next.includes('old paragraph'));
  const again = spliceTraction(next, 'NEWER');
  check('replace', again.includes('NEWER') && !again.includes('\nNEW\n') && again.includes('stays'));
  check('stats-split', acceptStats({ rides: 3, ridesFree: 2, ridesPaid: 1, ridesCompleted: 1, seconds: 10, metres: 20, crashes: 1, crashesVehicle: 1, crashesBuilding: 0, donations: 0, donationLamports: 0, drivers: 1, updatedAt: 1_791_000_000_000 }));
  check('stats-bad-split', acceptStats({ rides: 3, ridesFree: 3, ridesPaid: 1, ridesCompleted: 0, seconds: 0, metres: 0, crashes: 0, crashesVehicle: 0, crashesBuilding: 0, donations: 0, donationLamports: 0, drivers: 0, updatedAt: 1_791_000_000_000 }) === null);
  const block = renderTraction({
    fetchedAt: '2026-10-14T09:00:00.000Z',
    social: { youtube: { complete: false, coveredViews: 10, videos: 1, aboutViews: 4, aboutNote: 'channel About count is lower than the sum of the videos and was not used', items: [] }, x: { posts: 21, listed: 1, coveredViews: 5, complete: false, items: [], note: 'partial' } },
    stats: null,
    insights: { error: 'skipped' },
  });
  check('no-fake-total', !block.includes('all views') && block.includes('1 of 21'));
  const withHog = renderTraction({
    fetchedAt: '2026-10-14T09:00:00.000Z',
    social: { youtube: { complete: true, views: 10, coveredViews: 10, videos: 1, items: [] }, x: { posts: 1, complete: true, views: 2, coveredViews: 2, listed: 1, items: [] } },
    stats: null,
    insights: { windows: [{ label: '8 Oct 2026 through 2026-10-14 UTC', landingPeople: 131, whitepaperPeople: 12, signinsReal: 59, startsReal: 3, startsDemo: 29, completesReal: 0, completesDemo: 6 }] },
  });
  check('posthog-headline', withHog.includes('landing people') && withHog.includes('131') && withHog.includes('6 demo · 0 real'));
  const parked = `# T\n\n<img src="landing/public/media/day.webp" alt="cab" width="780">\n\nThe live site.\n\n## Traction\n\n<!-- traction:start -->\n\nOLD\n\n<!-- traction:end -->\n\n## The truck\n`;
  const moved = placeTraction(parked);
  check('under-banner', moved.indexOf('## Traction') < moved.indexOf('The live site') && moved.includes('## The truck'));
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  console.log('daily-tracktion-update self-test ok');
}
