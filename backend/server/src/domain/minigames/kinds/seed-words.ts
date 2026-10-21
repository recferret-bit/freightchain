/** Not BIP-39. Templates must not say seed, сид, or recovery. Phish correct answer is refuse. */
const WORDS = ['axle', 'diesel', 'gravel', 'mudflap', 'kingpin', 'gladhand', 'reefer', 'bulkhead', 'dolly', 'berm', 'winch', 'tarp'];

export interface SeedWordsEvent {
  kind: 'seed-words';
  mode: 'unlock' | 'phish';
  words: string[];
  /** The line the driver reads. Generated, never issued while the kind is disabled. */
  template: string;
  correct: string;
}

export function buildSeedWords(rnd: () => number): SeedWordsEvent {
  const words = [0, 1, 2].map(() => WORDS[Math.floor(rnd() * WORDS.length)]!);
  const phish = rnd() < 0.5;
  const template = phish
    ? `A text asks you to type ${words.join(' ')} into a strange form`
    : `Dispatch unlock: type ${words.join(' ')}`;
  return { kind: 'seed-words', mode: phish ? 'phish' : 'unlock', words, template, correct: phish ? 'refuse' : words.join(' ') };
}
