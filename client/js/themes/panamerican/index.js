import * as road from './road.js';
import * as sky from './sky.js';
import * as terrain from './terrain.js';
import * as mountains from './mountains.js';
import * as props from './props.js';
import { defineTheme } from '../_shared/theme.js';

/* Pan-American Highway · Chile – Ruta 5 across the Atacama / Andean altiplano, the road that links two continents. */
export default defineTheme({
  id: 'panamerican', name: 'Pan-American', country: 'Chile', route: 'Alaska ⇄ Ushuaia · Atacama altiplano', difficulty: 2,
  blurb: 'The road that links two continents, here across the Atacama altiplano. Salt flats, cardón cacti and snow-capped volcanoes in thin, blinding air.',
  swatches: ['#cfd9e8', '#ddd3c4', '#3d3b3a'],
  fog: { color: 0xe3d8cc, near: 160, far: 1600 },
  weather: { ambient: 12, snow: 0 },
  daylight: { rise: 7, set: 19, tw: .7, peak: .85, warm: [.95, .45, .35], stars: 1.3 },
  grime: '205,190,165', finishText: 'USHUAIA  END OF ROAD',
  livery: { body: '#ecebe4', stripe: '#1c6b3a', accent: '#f2c230', text: 'PAN-AMERICANA CARGA', sub: 'RUTA 5  •  ATACAMA' },
  furniture: { lamp: { color: 0x6a6f74, light: 0xffb34a, every: 5, side: -1 }, post: { body: 0xe8c030, cap: 0x222222 }, pole: { color: 0x5a4630, every: 3 } },
  landmarks: { chance: .15, flag: 'cl', weights: { hotel: .5, motel: 1.2 }, pal: { walls: ['#d8b896', '#c46b45', '#e4dccc'], roof: '#a3482e', lot: '#4a4640', accent: '#c8281f', accent2: '#2b6cb0', leaf: '#6a7a3a' }, names: { motel: ['HOSPEDAJE', 'RESIDENCIAL'], hotel: ['HOTEL', 'HOSTAL'], restaurant: ['COMEDOR', 'FONDA', 'PARRILLA'], gas: ['COPEC', 'GRIFO', 'DIESEL'], police: ['CARABINEROS', 'CONTROL'] } },
}, { road, sky, terrain, mountains, props });
