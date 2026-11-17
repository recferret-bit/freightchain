export default {
  id: 'police-checkpoint', kind: 'landmark', v: 1, anchor: 'base', label: 'police · checkpoint',
  note: 'highway inspection checkpoint: glazed guard house on pad with AC & roof beacons, counterweighted striped boom gate, grounded cones, cruiser & STOP sign',
  parts: [
    { geo: 'rbox', tag: 'pad', mat: 'lot', s: [3.2, 0.2, 3.2], at: [2.7, 0, -3.4] },
    { geo: 'rbox', tag: 'wall', mat: 'wall', s: [2.45, 2.55, 2.45], at: [2.7, 0.18, -3.4] },
    { geo: 'box', tag: 'band', mat: 'blue', s: [2.52, 0.28, 2.52], at: [2.7, 0.65, -3.4] },
    { geo: 'box', tag: 'window', mat: 'glass', s: [0.12, 1.12, 1.85], at: [1.44, 1.15, -3.4] },
    { geo: 'box', tag: 'door', mat: 'door', s: [1, 2.05, 0.12], at: [2.7, 0.18, -2.14] },
    { geo: 'rbox', tag: 'ac', mat: 'metal', s: [0.48, 0.45, 0.72], at: [4.05, 1.4, -3.4] },
    { geo: 'rbox', tag: 'roof', mat: 'blue', s: [3.05, 0.26, 3.05], at: [2.7, 2.68, -3.4] },
    { geo: 'rbox', tag: 'mount', mat: 'metal', s: [1.3, 0.1, 0.34], at: [2.7, 2.92, -3.4] },
    { geo: 'rbox', tag: 'beacon', mat: 'red', s: [0.44, 0.18, 0.38], at: [2.26, 2.98, -3.4] },
    { geo: 'rbox', tag: 'beacon', mat: 'blue', s: [0.44, 0.18, 0.38], at: [3.14, 2.98, -3.4] },
    { geo: 'rbox', tag: 'post', mat: 'dark', s: [0.42, 1.12, 0.42], at: [0.4, 0, -0.9] },
    { group: {}, at: [0.4, 1.05, -0.9], rot: [0, 0, -1.08], note: 'barrier arm, raised', do: [
      { geo: 'rbox', tag: 'weight', mat: 'dark', s: [0.46, 0.24, 0.22], at: [0.24, 0, 0] },
      { for: 'i', range: [0, 6], do: [
        { geo: 'box', tag: 'barrier', mat: { if: 'i % 2', then: 'white', else: 'red' }, s: [0.7, 0.14, 0.14], at: ['-0.35 - i * 0.68', 0, 0] },
      ] },
    ] },
    { use: 'lm-cones', with: { x: -2.8, z0: -4.4, n: 5, dz: 1.55 } },
    { ref: 'cruiser', at: [2.3, 0, 2.8], rot: [0, 0, 0] },
    { geo: 'oct', tag: 'base', mat: 'dark', s: [0.42, 0.2, 0.42], at: [-3.4, 0, 4.6] },
    { geo: 'cyl16', tag: 'pole', mat: 'metal', s: [0.08, 2.45, 0.08], at: [-3.4, 0.16, 4.6] },
    { sign: { style: 'red', w: 1.8, h: 1, text: 'STOP' }, at: [-3.4, 2.45, 4.6] },
  ],
};
