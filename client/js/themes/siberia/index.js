import * as road from './road.js';
import * as sky from './sky.js';
import * as terrain from './terrain.js';
import * as mountains from './mountains.js';
import * as props from './props.js';
import { defineTheme } from '../_shared/theme.js';

/* Trans-Siberian Highway · Russia – the longest freight artery on Earth, through the winter taiga. */
export default defineTheme({
  id: 'siberia', name: 'Trans-Siberian', country: 'Russia', route: 'Moscow ⇄ Vladivostok · winter taiga', difficulty: 3,
  blurb: 'The longest road in the world, in deep winter. Overcast sky, falling mist, spruce and birch crowding the verge. Short visibility.',
  swatches: ['#cfd6dc', '#e8eef3', '#2c2f32'],
  fog: { color: 0xcfd6dc, near: 60, far: 700 },
  weather: { ambient: -22, snow: 1 },
  daylight: { rise: 9.5, set: 15.5, tw: 2, peak: .22, warm: [.95, .6, .55], stars: .35 },
  grime: '208,214,220', finishText: 'VLADIVOSTOK PORT',
  livery: { body: '#dfe5ea', stripe: '#b5121b', accent: '#ffffff', text: 'TRANS-SIBERIAN FREIGHT', sub: 'M-58 AMUR  •  RUSSIA' },
  furniture: { lamp: { color: 0x55595d, light: 0xdfe9ff, every: 2, side: 0 }, post: { body: 0xf2f2ea, cap: 0x1a1a1a }, pole: { color: 0x8d8f91, every: 2 } },
  landmarks: { chance: .2, flag: 'ru', weights: { hotel: .6, police: 1.6 }, pal: { walls: ['#c9c2b0', '#8c9aa3', '#a45a3e'], roof: '#e8eef3', trim: '#e6e9ec', lot: '#6e7276', accent: '#b5121b', accent2: '#1f4a9a', leaf: '#24432e' }, names: { motel: ['ГОСТИНИЦА', 'МОТЕЛЬ'], hotel: ['ОТЕЛЬ', 'ГОСТИНИЦА'], restaurant: ['КАФЕ', 'СТОЛОВАЯ', 'ПЕЛЬМЕНИ'], gas: ['АЗС', 'ТОПЛИВО'], police: ['ДПС', 'ПОСТ ГАИ'] } },
}, { road, sky, terrain, mountains, props });
