// Explicit acceptance for generated local test wallets. Real wallet consent belongs to the browser UI.
export async function acceptLocalTestTerms(base, cookie) {
  const url = new URL(base);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !cookie) throw new Error('terms fixture requires a loopback API and signed-in test wallet');
  const call = async body => {
    const response = await fetch(`${url.origin}/api/profile/terms`, { method: body ? 'POST' : 'GET', credentials: 'include', headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`local terms fixture ${response.status}`);
    return response.json();
  };
  const terms = await call();
  if (!Number.isInteger(terms.termsVersion) || !Number.isInteger(terms.privacyVersion) || typeof terms.required !== 'boolean') throw new Error('invalid terms fixture status');
  if (terms.required) {
    const accepted = await call({ termsVersion: terms.termsVersion, privacyVersion: terms.privacyVersion, age18: true, accepted: true });
    if (accepted.required !== false || accepted.acceptedTermsVersion !== terms.termsVersion || accepted.acceptedPrivacyVersion !== terms.privacyVersion) throw new Error('local terms acceptance did not persist');
  }
  return cookie;
}
