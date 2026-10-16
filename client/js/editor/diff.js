/* A line diff of two entity sources (LCS; the files are small) → [{ op: ' ' | '-' | '+', line }] */
export function diffLines(a, b) {
  const A = a.split('\n'), B = b.split('\n'), n = A.length, m = B.length;
  // A valid 64 KB source can have tens of thousands of lines; never allocate its quadratic LCS table.
  if (n * m > 2_000_000) { let i = 0, j = 0; while (i < n && i < m && A[i] === B[i]) i++; while (j < n - i && j < m - i && A[n - 1 - j] === B[m - 1 - j]) j++; return [...A.slice(i, n - j).map(line => ({ op: '-', line })), ...B.slice(i, m - j).map(line => ({ op: '+', line }))]; }
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === B[j]) { out.push({ op: ' ', line: A[i] }); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: '-', line: A[i++] }); else out.push({ op: '+', line: B[j++] }); }
  while (i < n) out.push({ op: '-', line: A[i++] }); while (j < m) out.push({ op: '+', line: B[j++] });
  return out;
}
