export type ProfileName = 'perfect' | 'human-like' | 'drowsy' | 'aggro' | 'bot-quantized';

type ProfileRow = { gas: number; brake: number; gear: number; holdMs: number; trusted: boolean };

const PROFILES: Record<ProfileName, ProfileRow> = {
  perfect: { gas: 1, brake: 0, gear: 6, holdMs: 180, trusted: true },
  'human-like': { gas: 0.7, brake: 0, gear: 4, holdMs: 160, trusted: true },
  drowsy: { gas: 0.4, brake: 0.1, gear: 3, holdMs: 400, trusted: true },
  aggro: { gas: 1, brake: 0.2, gear: 5, holdMs: 90, trusted: true },
  'bot-quantized': { gas: 1, brake: 0, gear: 4, holdMs: 100, trusted: false },
};

export function profileOf(name: ProfileName): ProfileRow & { name: ProfileName } {
  const row = PROFILES[name];
  if (!row) throw new Error(`unknown profile ${name}`);
  return { name, gas: row.gas, brake: row.brake, gear: row.gear, holdMs: row.holdMs, trusted: row.trusted };
}
