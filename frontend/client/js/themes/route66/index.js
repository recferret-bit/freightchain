import * as road from './road.js';
import * as sky from './sky.js';
import * as terrain from './terrain.js';
import * as mountains from './mountains.js';
import * as props from './props.js';
import { defineTheme } from '../_shared/theme.js';

/* Route 66 · USA Southwest – the Mother Road: desert, saguaros, telephone poles. */
export default defineTheme({
  id: 'route66', name: 'Route 66', country: 'USA', route: 'Santa Monica ⇄ Chicago · Arizona desert', difficulty: 2,
  blurb: 'The Mother Road. Sun-baked desert, saguaro cacti and endless telephone poles. Long, gentle bends.',
  swatches: ['#e6c9a0', '#c9a56e', '#34322f'],
  fog: { color: 0xe6c9a0, near: 120, far: 1300 },
  weather: { ambient: 26, snow: 0 },
  daylight: { rise: 6, set: 19.5, tw: 1.1, peak: .9, warm: [1, .5, .2], stars: 1 },
  grime: '176,146,104', finishText: 'SANTA MONICA PIER',
  livery: { body: '#e9e7df', stripe: '#1d3a5c', accent: '#ffcf5a', text: 'ROUTE 66 EXPRESS', sub: 'LONG HAUL  •  FREIGHT CHAIN' },
  furniture: { lamp: { color: 0x6a6f74, light: 0xffa84a, every: 3, side: 0 }, post: { body: 0xf2f2ea, cap: 0xd22a22 }, pole: { color: 0x5a4630, every: 2 } },
  landmarks: { chance: .24, flag: 'us', pal: { walls: ['#e8d9b8', '#d9b99a', '#b9d4cf'], roof: '#8a4b38' }, names: { motel: ['MOTEL', 'ROUTE 66 INN', 'DESERT LODGE'], restaurant: ['DINER', 'ROUTE 66 CAFE', 'GRILL'], gas: ['GAS', 'FUEL', 'ROUTE 66 GAS'] } },
}, { road, sky, terrain, mountains, props });
