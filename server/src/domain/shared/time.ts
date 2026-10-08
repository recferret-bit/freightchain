export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const DAY_MS = 24 * 60 * MINUTE_MS;

/** The next 00:00 UTC strictly after `at` – when the next daily free ride arrives. */
export const nextUtcMidnight = (at: Date): Date => new Date(Math.floor(at.getTime() / DAY_MS) * DAY_MS + DAY_MS);

/** UTC calendar day (YYYY-MM-DD) of an instant – the unit of the daily free ride. */
export const utcDay = (at: Date): string => at.toISOString().slice(0, 10);

/** 00:00 UTC of the day `at` falls in – where per-UTC-day caps (the gas sponsor's per-wallet budget) start counting. */
export const startOfUtcDay = (at: Date): Date => new Date(Math.floor(at.getTime() / DAY_MS) * DAY_MS);

/** Midnight UTC of a `utcDay` string. PostHog dedupes on timestamp, so a once-per-day key needs this instant, not the request clock. */
export const utcDayStart = (day: string): Date => new Date(`${day}T00:00:00.000Z`);
