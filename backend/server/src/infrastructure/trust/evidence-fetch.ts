/** No retries or redirects. Provider credentials stay in headers; errors never include request URLs. */
export async function evidenceJson(url: string, headers: Record<string, string>): Promise<{ status: number; data: unknown }> {
  const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(2000) });
  if (!response.ok) { await response.body?.cancel(); return { status: response.status, data: null }; }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('empty evidence');
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 256_000) throw new Error('oversize evidence');
      chunks.push(value);
    }
    return { status: response.status, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown };
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
