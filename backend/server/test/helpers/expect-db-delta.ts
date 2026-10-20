/** A Prisma client, or a test double, that can count rows of the named models. Keys are model names (`Ride`), not SQL. */
export type DeltaClient = object;

const MODEL = /^[A-Z][A-Za-z0-9]*$/;

const delegateName = (model: string): string => model.charAt(0).toLowerCase() + model.slice(1);

const countOf = async (prisma: DeltaClient, model: string): Promise<number> => {
  if (!MODEL.test(model)) throw new Error(`expected a Prisma model name, got ${model}`);
  const delegate = (prisma as Record<string, unknown>)[delegateName(model)];
  if (!delegate || typeof delegate !== 'object' || typeof (delegate as { count?: unknown }).count !== 'function') throw new Error(`no count() for ${model}`);
  return (delegate as { count: () => Promise<number> }).count();
};

const statusOf = (value: unknown): number | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as { status?: unknown; statusCode?: unknown };
  if (typeof record.status === 'number') return record.status;
  if (typeof record.statusCode === 'number') return record.statusCode;
  return null;
};

/**
 * Snapshot the named tables, run `fn`, and require those exact row deltas.
 * A 4xx result (or a thrown `statusCode` in 400–499) must leave every named table unchanged:
 * a refusal is not allowed to commit.
 */
export async function expectDbDelta<T>(prisma: DeltaClient, expectedDeltas: Record<string, number>, fn: () => Promise<T>): Promise<T> {
  const models = Object.keys(expectedDeltas);
  const before = new Map(await Promise.all(models.map(async (model) => [model, await countOf(prisma, model)] as const)));
  let result: T | undefined;
  let thrown: unknown;
  try {
    result = await fn();
  } catch (error) {
    thrown = error;
  }
  const deltas = new Map<string, number>();
  for (const model of models) deltas.set(model, (await countOf(prisma, model)) - (before.get(model) ?? 0));
  const status = thrown === undefined ? statusOf(result) : statusOf(thrown);
  const problems: string[] = [];
  if (status !== null && status >= 400 && status < 500) {
    for (const model of models) {
      const delta = deltas.get(model) ?? 0;
      if (delta !== 0) problems.push(`${model} changed by ${delta} on HTTP ${status}`);
      if (expectedDeltas[model] !== 0) problems.push(`${model} expected ${expectedDeltas[model]} on a 4xx path; a refusal must expect 0`);
    }
  }
  for (const model of models) {
    const actual = deltas.get(model) ?? 0;
    if (actual !== expectedDeltas[model]) problems.push(`${model}: expected ${expectedDeltas[model] >= 0 ? '+' : ''}${expectedDeltas[model]}, got ${actual >= 0 ? '+' : ''}${actual}`);
  }
  if (problems.length > 0) {
    const cause = thrown instanceof Error ? `\nwhile handling: ${thrown.message}` : '';
    throw new Error(problems.join('\n') + cause);
  }
  if (thrown !== undefined) throw thrown;
  return result as T;
}
