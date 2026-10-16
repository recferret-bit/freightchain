export default {
  id: 'diner-chrome', kind: 'landmark', v: 1, anchor: 'base', label: 'restaurant · chrome',
  note: 'barrel-roof chrome diner with a stripe, a wrap-around window and a roof sign. The wall is z ±7; the pier from the corner to the door is 0.45 m, and the window and the stripe keep that pier past the door and at the far corner',
  vars: { doorZ: -6, doorW: 1.1, half: 7, pier: 'doorZ - doorW / 2 + half', z0: 'doorZ + doorW / 2 + pier', z1: 'half - pier', span: 'z1 - z0', zc: '(z0 + z1) / 2' },
  parts: [
    { geo: 'box', tag: 'wall', mat: 'wall', s: [5.5, 2.8, 14], at: [1, 0, 0] },
    { geo: 'box', tag: 'stripe', mat: 'accent', s: [0.1, 0.45, 'span'], at: [-1.77, 0.35, 'zc'] },
    { geo: 'box', tag: 'window', mat: 'glass', s: [0.1, 1.2, 'span'], at: [-1.77, 1.2, 'zc'] },
    { geo: 'box', tag: 'door', mat: 'door', s: [0.1, 2.1, 'doorW'], at: [-1.77, 0, 'doorZ'] },
    { geo: 'barrel', anchor: 'center', tag: 'roof', mat: 'metal', s: [2.75, 14, 1.9], at: [1, 2.8, 0], rot: ['PI / 2', 0, 0], note: 'the -z half of a cylinder stood up as an arch' },
    { geo: 'box', tag: 'pole', mat: 'metal', s: [0.25, 7, 0.25], at: [-2, 0, -7.4] },
    { sign: { style: 'neon', w: 4, h: 1.6 }, at: [-2, 7, -7.4] },
  ],
};
