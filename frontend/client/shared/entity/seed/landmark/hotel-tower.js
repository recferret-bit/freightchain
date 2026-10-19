export default {
  id: 'hotel-tower', kind: 'landmark', v: 1, anchor: 'base', label: 'hotel · tower',
  note: 'glass-grid tower on a lobby podium with an entrance canopy and a roof sign',
  parts: [
    { geo: 'box', tag: 'wall', mat: 'wall', s: [12, 4, 14], at: [0, 0, 0] },
    { geo: 'box', tag: 'window', mat: 'glass', s: [0.1, 2.2, 10], at: [-6.02, 0.6, 0] },
    { geo: 'box', tag: 'roof', mat: 'roof', s: [12.4, 0.3, 14.4], at: [0, 4, 0] },
    { geo: 'box', tag: 'wall', mat: { facade: [6, 8] }, s: [9, 18, 11], at: [1.5, 4, 0] },
    { geo: 'box', tag: 'roof', mat: 'roof', s: [9.3, 0.4, 11.3], at: [1.5, 22, 0] },
    { geo: 'box', tag: 'canopy', mat: 'accent', s: [3, 0.25, 6], at: [-7, 3.1, 0] },
    { geo: 'box', tag: 'post', mat: 'trim', s: [0.2, 3, 0.2], at: [-8.3, 0, -2.7] },
    { geo: 'box', tag: 'post', mat: 'trim', s: [0.2, 3, 0.2], at: [-8.3, 0, 2.7] },
    { sign: { style: 'neon', w: 7, h: 2 }, at: [1.5, 22.4, 0] },
  ],
};
