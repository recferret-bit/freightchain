import { sourceFiles } from './source-files.js';

/* Every JSON controller route declares @ZodResponse. Non-JSON routes (none today: no PNG, redirect, SSE, or raw buffer) use @ZodResponseRaw and are exempt. */
describe('@ZodResponse on every controller route', () => {
  const controllers = sourceFiles().filter((file) => file.path.endsWith('.http.controller.ts'));

  it('finds the controllers', () => {
    expect(controllers.length).toBeGreaterThanOrEqual(30);
  });

  it('every route method is @ZodResponse or @ZodResponseRaw', () => {
    const missing: string[] = [];
    for (const file of controllers) {
      const starts = [...file.text.matchAll(/@(?:Get|Post|Put|Patch|Delete)\(/g)].map((match) => match.index ?? 0);
      starts.forEach((start, index) => {
        const chunk = file.text.slice(start, starts[index + 1] ?? file.text.length);
        if (!/@ZodResponse(?:Raw)?\(/.test(chunk)) missing.push(`${file.path}: ${chunk.split('\n')[0]}`);
      });
    }
    expect(missing).toEqual([]);
    expect(startsCount(controllers)).toBeGreaterThanOrEqual(151);
  });
});

function startsCount(files: { text: string }[]): number {
  return files.reduce((n, file) => n + [...file.text.matchAll(/@(?:Get|Post|Put|Patch|Delete)\(/g)].length, 0);
}
