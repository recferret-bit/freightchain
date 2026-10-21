import { phone } from '../phone.js';
import { openPhoneApp, returnPhoneHome, PHONE_POWER } from '../ui/map/power-fsm.js';
import { APPS, appById } from './catalog.js';
import { homeLayout } from './home.js';
import { hitsJob, hitsSeed, hosts, keyJob, paintJob, paintSeed, pressJob } from '../minigames/play.js';
import { machine } from '../minigames/machine.js';
import { traceHit } from '../minigames/trace.js';
import { telemetryUs } from '../telemetry.js';
import { t } from '../minigames/i18n/index.js';
import { bindPhone } from '../minigames/runtime.js';
import { MONO } from '../util.js';
import { gulp } from './gulp-state.js';
import { pike } from './pike-state.js';

/* Phone OS. Power (off / boot / home / app) stays in the power FSM, because the cab mount reads phone.power.
   This machine owns which application is up, the inner screen, and the minigame job sitting on top of an app.
     HOME --open(id)--> APP --back at the root--> HOME
     a revealed seed-words job covers every app until it is answered. */

export const OS_SCREEN = Object.freeze({ OFF: 'off', BOOT: 'boot', HOME: 'home', APP: 'app' });

export class PhoneOS {
  constructor(apps) {
    this.apps = apps;
    this.focus = 0;
    this.job = null;
    this.lesson = null;
    this.onAnswer = null;
  }

  screen() {
    if (phone.power === PHONE_POWER.OFF) return OS_SCREEN.OFF;
    if (phone.power === PHONE_POWER.BOOT) return OS_SCREEN.BOOT;
    if (!phone.app || phone.power === PHONE_POWER.HOME) return OS_SCREEN.HOME;
    return OS_SCREEN.APP;
  }

  app() { return appById(phone.app); }

  get field() {
    const k = this.job?.kind;
    if (k === 'seed-words' || (k === 'phone-sms' && this.job?.ui === 'keys') || (k === 'buy-shitcoin' && this.job?.ui === 'amount')) return true;
    return (phone.app === 'gulp' && gulp.phase === 'code') || (phone.app === 'pike' && pike.phase === 'code');
  }

  wantsKeys() {
    if (!phone.open) return false;
    if (this.job?.phase === 'revealed' || this.job?.phase === 'answering') return true;
    return (phone.app === 'gulp' && gulp.phase === 'code') || (phone.app === 'pike' && pike.phase === 'code');
  }

  open(id) {
    if (!appById(id)) return;
    this.app()?.onClose();
    openPhoneApp(id);
    this.app()?.onOpen();
  }

  home() {
    this.app()?.onClose();
    returnPhoneHome();
  }

  back() {
    if (this.job?.ui && this.job.ui !== 'list') { this.job.ui = this.job.ui === 'keys' ? 'body' : this.job.ui === 'amount' ? 'list' : 'list'; return; }
    if (this.app()?.back()) return;
    if (phone.app) this.home();
  }

  paint(g, W, H) {
    if (this.job?.kind === 'seed-words') paintSeed(g, W, H, this.job);
    else if (this.job && hosts(phone.app, this.job.kind)) paintJob(g, W, H, this.job);
    else this.app()?.paint(g, W, H, this);
    this.paintChrome(g, W, H);
  }

  paintChrome(g, W, H) {
    g.fillStyle = 'rgba(255,255,255,.16)'; g.beginPath(); g.roundRect(W / 2 - 46, H - 28, 92, 18, 9); g.fill();
    g.fillStyle = '#f4f7fb'; g.font = `700 10px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t('os.home'), W / 2, H - 19);
    if (this.lesson && performance.now() < this.lesson.until) {
      g.fillStyle = 'rgba(12,16,22,.9)'; g.fillRect(8, 8, W - 16, 36);
      g.fillStyle = '#f4f7fb'; g.font = `600 11px ${MONO}`; g.fillText(t(this.lesson.id), W / 2, 26);
    }
  }

  hits(W, H) {
    const hits = [{ id: 'os:home', x: W / 2 - 46, y: H - 28, w: 92, h: 18 }];
    if (this.job?.kind === 'seed-words') hits.push(...hitsSeed(W, H, this.job));
    else if (this.job && hosts(phone.app, this.job.kind)) hits.push(...hitsJob(W, H, this.job));
    else if (this.screen() === OS_SCREEN.APP) hits.push(...(this.app()?.hits(W, H) ?? []));
    return hits;
  }

  onPress(id, hit, rx = 0.5, ry = 0.5) {
    if (id === 'os:home') { this.home(); return; }
    const covered = this.job && (this.job.kind === 'seed-words' || hosts(phone.app, this.job.kind));
    if (!covered) { this.app()?.onPress(id, hit, rx, ry); return; }
    if (!this.job.touched) { this.job.touched = true; machine.touched = true; if (!this.job.firstTouchUs) this.job.firstTouchUs = telemetryUs(); }
    if (hit) traceHit(id, rx, ry);
    const answer = pressJob(id, this.job);
    if (answer) this.onAnswer?.(answer);
  }

  onKey(e) {
    if (this.screen() === OS_SCREEN.HOME) {
      const icons = homeLayout(0, 0, 300, 600, false).icons, n = icons.length || 1;
      if (e.code === 'ArrowRight' || e.code === 'ArrowDown') this.focus = (this.focus + 1) % n;
      else if (e.code === 'ArrowLeft' || e.code === 'ArrowUp') this.focus = (this.focus - 1 + n) % n;
      else if (e.code === 'Enter') { const ic = icons[this.focus]; if (ic) this.open(ic.id); }
      return true;
    }
    if (this.job && (this.job.phase === 'revealed' || this.job.phase === 'answering')) {
      if (!this.job.touched) { this.job.touched = true; machine.touched = true; if (!this.job.firstTouchUs) this.job.firstTouchUs = telemetryUs(); }
      const r = keyJob(e, this.job);
      if (r === 'submit' && this.job.draft) this.onAnswer?.({ type: 'code', value: this.job.draft });
      return r !== false;
    }
    return !!this.app()?.onKey(e);
  }
}

export const os = new PhoneOS(APPS);
bindPhone(os);
