export default {
  id: 'police-speedtrap', kind: 'landmark', v: 1, anchor: 'base', label: 'police · speedtrap',
  note: 'cruiser tucked behind a billboard, radar on a tripod, nose to the road',
  parts: [
    { geo: 'box', tag: 'pole', mat: 'metal', s: [0.2, 3, 0.2], at: [-0.5, 0, -2.2] },
    { geo: 'box', tag: 'pole', mat: 'metal', s: [0.2, 3, 0.2], at: [-0.5, 0, 2.2] },
    { sign: { style: 'blue', w: 5, h: 1.8 }, at: [-0.5, 2.6, 0] },
    { ref: 'cruiser', at: [2.4, 0, 0], rot: [0, '-PI / 2', 0] },
    { geo: 'box', tag: 'pole', mat: 'dark', s: [0.1, 1.3, 0.1], at: [-3, 0, 3.8] },
    { geo: 'box', tag: 'radar', mat: 'dark', s: [0.5, 0.3, 0.3], at: [-3, 1.3, 3.8] },
    { use: 'lm-cones', with: { x: -3.6, z0: -3.8, n: 3, dz: 1.5 } },
  ],
};
