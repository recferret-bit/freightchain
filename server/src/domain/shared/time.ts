export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const DAY_MS = 24 * 60 * MINUTE_MS;

/** The next 00:00 UTC strictly after `at` – when the next daily free ride arrives. */
export const nextUtcMidnight = (at: Date): Date => new Date(Math.floor(at.getTime() / DAY_MS) * DAY_MS + DAY_MS);

/** UTC calendar day (YYYY-MM-DD) of an instant – the unit of the daily free ride. */
export const utcDay = (at: Date): string => at.toISOString().slice(0, 10);
