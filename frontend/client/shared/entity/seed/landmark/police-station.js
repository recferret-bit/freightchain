export default {
  id: 'police-station', kind: 'landmark', v: 1, anchor: 'base', label: 'police · station',
  note: 'small station house with a blue band, a flag pole, a rooftop sign and two cruisers',
  params: { flags: { from: 'code', type: 'int', default: 0, min: 0, max: 2, note: 'how many national flags the route flies' } },
  parts: [
    { geo: 'box', tag: 'wall', mat: 'wall', s: [7, 3.4, 12], at: [2.5, 0, 3] },
    { geo: 'box', tag: 'roof', mat: 'roof', s: [7.6, 0.3, 12.6], at: [2.5, 3.4, 3] },
    { geo: 'box', tag: 'band', mat: 'blue', s: [0.1, 0.7, 12], at: [-1.02, 2.2, 3] },
    { geo: 'box', tag: 'window', mat: 'glass', s: [0.1, 1.3, 5], at: [-1.02, 0.8, 3] },
    { geo: 'box', tag: 'door', mat: 'door', s: [0.1, 2.1, 1.2], at: [-1.02, 0, 6.8] },
    { geo: 'box', tag: 'roof', mat: 'blue', s: [0.8, 0.5, 0.8], at: [2.5, 3.7, 3], note: 'roof joint, top at 4.2' },
    { sign: { style: 'blue', w: 4, h: 1.3 }, at: [2.5, 4.18, 3], note: 'centred on the joint, 2 cm into it so the shared top plane does not flicker' },
    { geo: 'box', tag: 'pole', mat: 'metal', s: [0.2, 8, 0.2], at: [-3.5, 0, -5] },
    { for: 'i', range: [0, 'max(1, flags)'], note: 'the hoist overlaps the pole by 2 cm; a second country hangs below', do: [
      { geo: 'box', anchor: 'center', tag: 'flag', mat: [{ flag: 'i', side: 0 }, { flag: 'i', side: 1 }, { flag: 'i', side: 0 }, { flag: 'i', side: 0 }, { flag: 'i', side: 0 }, { flag: 'i', side: 0 }], s: [0.06, 1, 1.6], at: [-3.5, '7.5 - i * 1.15', -5.88] },
    ] },
    { ref: 'cruiser', at: [-3, 0, -1.5], rot: [0, 0, 0] },
    { ref: 'cruiser', with: { lights: false }, at: [-3, 0, 3.6], rot: [0, 0, 0] },
  ],
};
