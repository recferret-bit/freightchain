/* Desktop with no extension: a QR the phone camera opens. The phone signs in (the wallet app injects there) and the server moves that session onto this browser.
   WalletConnect's wc: code needs a third-party relay and a project id; this code is ours, one use, three minutes, and the secret cookie never enters the picture. */

/** Ask the server for a code. `api` is the site's `api()` (credentials included). */
export async function startPhonePair(api) {
  const opened = await api('auth/pair', {});
  return { id: opened.id, url: `${location.origin}/?pair=${opened.id}`, expiresAt: opened.expiresAt };
}

/** Poll until the phone has signed in, or `stop()` becomes true. */
export async function watchPhonePair(api, id, stop) {
  while (!stop()) {
    const row = await api(`auth/pair/${id}`, null, { report: false });
    if (row.status === 'ready') return row;
    await new Promise(r => setTimeout(r, 2000));
  }
  return null;
}
