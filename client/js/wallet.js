import { CFG } from './config.js';

/* MOCK wallet kept in localStorage. Replace with a real backend – never trust client-side balances. */

export const Wallet = {
  key: 'freightchain.wallet.v1', _mem: null,
  balance() {
    try { const v = localStorage.getItem(this.key); if (v === null) { this.set(CFG.START_BALANCE); return CFG.START_BALANCE; } return Number.isFinite(+v) ? +v : CFG.START_BALANCE; }
    catch { if (this._mem === null) this._mem = CFG.START_BALANCE; return this._mem; }
  },
  set(v) { try { localStorage.setItem(this.key, String(v)); } catch { this._mem = v; } },
  charge(n) { if (this.balance() < n) return false; this.set(this.balance() - n); return true; },
  credit(n) { this.set(this.balance() + n); },
};
