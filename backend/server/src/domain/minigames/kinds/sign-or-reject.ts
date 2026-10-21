export interface SignOrRejectEvent {
  kind: 'sign-or-reject';
  phish: boolean;
  prompt: string;
  correct: 'sign' | 'refuse';
}

/** A dispatch docket is sign. Anything that is not the desk is refuse. Not issued. */
export function buildSignOrReject(rnd: () => number): SignOrRejectEvent {
  const phish = rnd() < 0.5;
  return {
    kind: 'sign-or-reject', phish,
    prompt: phish ? 'Unknown page asks you to approve a transfer' : 'Dispatch docket needs your mark',
    correct: phish ? 'refuse' : 'sign',
  };
}
