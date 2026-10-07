import type { CommandBus, QueryBus } from '@nestjs/cqrs';

/** A CommandBus / QueryBus double: records what the controller dispatched and answers with `reply`. */
export function busMock<T = unknown>(reply: T = { ok: true } as T) {
  const sent: object[] = [];
  const bus = { execute: async (message: object) => { sent.push(message); return reply; } };
  return { bus: bus as unknown as CommandBus & QueryBus, sent, last: () => sent.at(-1) };
}
