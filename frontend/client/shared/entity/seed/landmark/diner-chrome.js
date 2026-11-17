export default {
  id: 'diner-chrome', kind: 'landmark', v: 1, anchor: 'base', label: 'restaurant · chrome',
  note: '1950s stainless streamliner diner: barrel-vault chrome roof, entry vestibule, fluted racing stripes, mullioned ribbon glass, kitchen vent & twin-pole neon sign',
  vars: { doorZ: -5.4, half: 7, z0: -3.6, z1: 6.3, span: 'z1 - z0', zc: '(z0 + z1) / 2' },
  parts: [
    { geo: 'box', tag: 'plinth', mat: 'dark', s: [5.9, 0.28, 14.4], at: [1.1, 0, 0] },
    { geo: 'rbox', tag: 'wall', mat: 'wall', s: [5.5, 2.75, 14], at: [1.1, 0.24, 0] },
    { geo: 'rbox', tag: 'vestibule', mat: 'metal', s: [1.4, 2.67, 2.2], at: [-1.95, 0.22, 'doorZ'] },
    { geo: 'rbox', tag: 'canopy', mat: 'accent', s: [1.7, 0.2, 2.5], at: [-2.05, 2.84, 'doorZ'] },
    { geo: 'box', tag: 'step', mat: 'lot', s: [0.9, 0.22, 2.2], at: [-2.85, 0, 'doorZ'] },
    { geo: 'box', tag: 'door', mat: 'door', s: [0.1, 2.1, 1.15], at: [-2.68, 0.22, 'doorZ'] },
    { geo: 'box', tag: 'stripe', mat: 'accent', s: [0.1, 0.42, 'span'], at: [-1.68, 0.42, 'zc'] },
    { geo: 'box', tag: 'band', mat: 'neon', s: [0.12, 0.14, 'span'], at: [-1.7, 2.58, 'zc'] },
    { geo: 'box', tag: 'window', mat: 'glass', s: [0.1, 1.22, 'span'], at: [-1.68, 1.22, 'zc'] },
    { for: 'mz', in: [-1.6, 0.9, 3.4, 5.9], do: [
      { geo: 'box', tag: 'mullion', mat: 'metal', s: [0.1, 1.28, 0.1], at: [-1.73, 1.2, 'mz'] },
    ] },
    { geo: 'barrel', anchor: 'center', tag: 'roof', mat: 'metal', s: [2.78, 14.2, 1.75], at: [1.1, 2.94, 0], rot: ['PI / 2', 0, 0] },
    { geo: 'rbox', tag: 'vent', mat: 'dark', s: [1.1, 0.68, 1.6], at: [1.45, 4.32, 2.5] },
    { for: 'px', in: [-2.7, -1.7], do: [
      { geo: 'cyl16', tag: 'pole', mat: 'metal', s: [0.11, 7.1, 0.11], at: ['px', 0, -7.35] },
    ] },
    { geo: 'rbox', tag: 'tie', mat: 'accent', s: [1.3, 0.22, 0.24], at: [-2.2, 5.4, -7.35] },
    { sign: { style: 'neon', w: 4, h: 1.6 }, at: [-2.2, 7, -7.35] },
  ],
};
