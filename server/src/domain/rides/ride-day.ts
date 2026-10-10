/** The UTC calendar day of `now` ("2026-10-10"). Pay-per-ride orders of one paid tier on one day share a road seed (DailySeedRepositoryPort): the day's riders drive one ride. */
export const seedDayOf = (now: Date): string => now.toISOString().slice(0, 10);
