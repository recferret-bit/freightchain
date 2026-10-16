// Minimal DOM + deterministic Math.random for the parity bundles (imported first by entry.mjs).
import { recordingContext } from '../../js/world/scene.js';
let seed = 12345; Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
class El { constructor(id) { this.id = id; this.style = {}; this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false }; this.dataset = {}; this.children = []; this.log = []; } getContext() { return recordingContext(this.log); } addEventListener() {} removeEventListener() {} append() {} appendChild() {} setAttribute() {} querySelector() { return null; } querySelectorAll() { return []; } getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; } }
const els = {};
globalThis.document = { getElementById: id => (els[id] ??= new El(id)), createElement: () => new El('x'), addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], body: new El('body'), documentElement: new El('html'), hidden: false };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.innerWidth = 1280; globalThis.innerHeight = 720; globalThis.devicePixelRatio = 1;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }; globalThis.requestAnimationFrame = () => {};
try { Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', maxTouchPoints: 0 }, configurable: true }); } catch { /* read-only */ }
globalThis.location = { search: '', hash: '', hostname: 'localhost', href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:' };
