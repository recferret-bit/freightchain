/* Campaign task points carry into Season 1. They are not spendable TEN4. */
export function xPostId(value) {
  const text = String(value ?? '').trim();
  if (/^\d{1,30}$/.test(text)) return text;
  try {
    const u = new URL(text);
    if (u.protocol !== 'https:' || !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(u.hostname)) return null;
    return u.pathname.match(/^\/[A-Za-z0-9_]{1,15}\/status\/(\d{1,30})\/?$/)?.[1] ?? null;
  } catch { return null; }
}
export function campaignSteps(row) {
  return [
    ['Verified MEDIUM or HARD training ride', row.rideUnlocked],
    ['Telegram account, official channel and group', row.telegram.bound && row.telegram.member && row.telegram.groupMember],
    ['Follow @FreightChainSol and publish your personal code on X', row.x.bound && row.x.ageOk && row.x.followersOk && row.x.follows && row.x.quoteOk],
    ['Participate in the Telegram group after linking', row.telegram.active],
  ];
}
export function telegramUrl(chat) { return /^@[A-Za-z0-9_]+$/.test(chat ?? '') ? `https://t.me/${chat.slice(1)}` : null; }
