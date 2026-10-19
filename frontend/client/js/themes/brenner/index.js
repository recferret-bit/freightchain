import * as road from './road.js';
import * as sky from './sky.js';
import * as terrain from './terrain.js';
import * as mountains from './mountains.js';
import * as props from './props.js';
import { defineTheme } from '../_shared/theme.js';

/* Brenner Pass · Austria/Italy – Europe's busiest Alpine freight crossing (Innsbruck ⇄ Bolzano). */
export default defineTheme({
  id: 'brenner', name: 'Brenner Pass', country: 'Austria · Italy', route: 'Munich ⇄ Verona · Alpine crossing', difficulty: 5,
  blurb: 'Europe\'s busiest Alpine freight crossing. Snow-capped peaks, green meadows, spruce forest and guardrails – with tight serpentine bends.',
  swatches: ['#bcd9f2', '#5d9a42', '#3a3b3d'],
  fog: { color: 0xbcd8f0, near: 150, far: 1500 },
  weather: { ambient: 3, snow: .25 },
  daylight: { rise: 6, set: 20, tw: 1.5, peak: .7, warm: [1, .6, .5], stars: .8 },
  grime: '150,140,118', finishText: 'INNSBRUCK DEPOT',
  livery: { body: '#f4f4f0', stripe: '#c8102e', accent: '#ffffff', text: 'ALPEN CARGO', sub: 'BRENNER PASS  •  A13' },
  furniture: { lamp: { color: 0x7a7f84, light: 0xffc77a, every: 3, side: 0 }, guard: { color: 0xb9bdc1, post: 0x7a7f84 } },
  landmarks: { chance: .24, near: [13, 17], flag: ['at', 'it'], weights: { hotel: 1.6, restaurant: 1.5, police: .6 }, pal: { walls: ['#efe6d2', '#d8c8a8', '#c7d3dc'], roof: '#7a3a2a', accent: '#2f6b3a', accent2: '#8a1f1f', leaf: '#2f5a33' }, names: { motel: ['PENSION', 'GASTHOF'], hotel: ['HOTEL', 'ALPENHOF', 'ALBERGO'], restaurant: ['GASTHAUS', 'RISTORANTE', 'STUBE'], gas: ['TANKSTELLE', 'AGIP', 'DIESEL'], police: ['POLIZEI', 'CARABINIERI'] } },
}, { road, sky, terrain, mountains, props });
