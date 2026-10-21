/* Client state machine for one minigame event. It does not know the answer.
   idle → armed → opening → revealed → answering → revealed (tries left) | done
   revealed → armed when the truck rolls away before the first touch (one deferral). */

export const MG_PHASE = Object.freeze({
  IDLE: 'idle', ARMED: 'armed', OPENING: 'opening', REVEALED: 'revealed', ANSWERING: 'answering', DONE: 'done',
});

const NEXT = {
  idle: ['arm'],
  armed: ['open', 'idle'],
  opening: ['reveal', 'armed'],
  revealed: ['answer', 'defer', 'expire', 'idle'],
  answering: ['again', 'final', 'armed'],
  done: ['arm', 'idle'],
};

export class MiniGameMachine {
  constructor() { this.phase = MG_PHASE.IDLE; this.event = null; this.touched = false; this.deferred = false; }

  send(type) {
    if (!NEXT[this.phase]?.includes(type)) return false;
    if (type === 'idle') { this.event = null; this.touched = false; this.deferred = false; }
    if (type === 'defer') { this.deferred = true; this.touched = false; this.phase = MG_PHASE.ARMED; return true; }
    if (type === 'again') { this.phase = MG_PHASE.REVEALED; return true; }
    if (type === 'final' || type === 'expire') { this.phase = MG_PHASE.DONE; return true; }
    const to = { arm: MG_PHASE.ARMED, armed: MG_PHASE.ARMED, open: MG_PHASE.OPENING, reveal: MG_PHASE.REVEALED, answer: MG_PHASE.ANSWERING, idle: MG_PHASE.IDLE };
    this.phase = to[type] ?? this.phase;
    return true;
  }
}

export const machine = new MiniGameMachine();
