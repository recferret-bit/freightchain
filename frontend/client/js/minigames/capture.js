import { os } from '../phone/os.js';
import { traceKey } from './trace.js';

/* While a minigame screen is up, digits, letters, arrows, Enter, Backspace and Tab belong to the phone.
   They must not reach recordInput: Digit0–7 would shift gears and the replay would drive them.
   Escape, P and M stay with the truck. B stays with the parking brake unless a text field is focused. */

const PASS = new Set(['Escape', 'KeyP', 'KeyM']);

function caught(code) {
  return /^Digit[0-9]$/.test(code) || /^Key[A-Z]$/.test(code) || code === 'Backspace' || code === 'Enter' || code === 'Tab' || code.startsWith('Arrow');
}

export const mgCapture = {
  handles(e) {
    if (!os.wantsKeys()) return false;
    if (PASS.has(e.code)) return false;
    if (e.code === 'KeyB' && !os.field) return false;
    if (e.code === 'Space' && os.field) return true;
    return caught(e.code);
  },
  take(e) {
    traceKey(e);
    if (e.type === 'keyup') return;
    if (os.app()?.onKey(e)) return;
    os.onKey(e);
  },
};
