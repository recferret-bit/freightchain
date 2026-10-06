import * as road from './road.js';
import * as sky from './sky.js';
import * as terrain from './terrain.js';
import * as mountains from './mountains.js';
import * as props from './props.js';
import { defineTheme } from '../_shared/theme.js';

/* Stuart Highway · Australia – the Explorer's Way through the Northern Territory, home of the road trains. */
export default defineTheme({
  id: 'stuart', name: 'Stuart Highway', country: 'Australia', route: 'Adelaide ⇄ Darwin · Northern Territory outback', difficulty: 1,
  blurb: 'Road-train country. Red earth, ghost gums and termite mounds under a fierce sun. Dead straight – stay awake and fight the side-wind.',
  swatches: ['#d9c6a4', '#b4532a', '#3b3a38'],
  fog: { color: 0xeed2ad, near: 140, far: 1400 },
  weather: { ambient: 34, snow: 0 },
  daylight: { rise: 6.5, set: 18.5, tw: .8, peak: .95, warm: [1, .4, .15], stars: 1.1 },
  grime: '170,88,48', finishText: 'DARWIN PORT',
  livery: { body: '#f2f0e8', stripe: '#c2481f', accent: '#f0b323', text: 'OUTBACK ROAD TRAINS', sub: 'STUART HIGHWAY  •  NT' },
  furniture: { lamp: { color: 0x7a7f84, light: 0xffd9a0, every: 6, side: 1 }, post: { body: 0xf2f2ea, cap: 0xd22a22 }, pole: { color: 0x6a5a48, every: 4 } },
  landmarks: { chance: .14, weights: { hotel: 0, motel: .6, restaurant: 1.6, gas: 1.4, police: .5 }, pal: { walls: ['#c9c4b5', '#a8553b', '#d6cfa8'], roof: '#7a8087', accent: '#b8321f', leaf: '#6a7a3a' }, names: { motel: ['MOTEL', 'OUTBACK INN'], restaurant: ['ROADHOUSE', 'PUB', 'OUTBACK CAFE'], gas: ['ROADHOUSE FUEL', 'DIESEL', 'ROAD TRAIN FUEL'], police: ['POLICE'] } },
}, { road, sky, terrain, mountains, props });
