// Wraps fetch before the server boots. Logs the PostHog status line only — never the body, never the key.
const orig = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const res = await orig(input, init);
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(raw);
    if (u.hostname.endsWith('posthog.com')) {
      console.log(`posthog-probe status=${res.status} host=${u.host} path=${u.pathname}`);
    }
  } catch { /* a non-URL fetch is not our probe */ }
  return res;
};
