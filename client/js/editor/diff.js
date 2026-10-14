/* A line diff of two entity sources (LCS; the files are small) → [{ op: ' ' | '-' | '+', line }] */
export function diffLines(a, b) {
  const A = a.split('\n'), B = b.split('\n'), n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === B[j]) { out.push({ op: ' ', line: A[i] }); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: '-', line: A[i++] }); else out.push({ op: '+', line: B[j++] }); }
  while (i < n) out.push({ op: '-', line: A[i++] }); while (j < m) out.push({ op: '+', line: B[j++] });
  return out;
}
