export default {
  id: 'hotel-tower', kind: 'landmark', v: 1, anchor: 'base', label: 'hotel · tower',
  note: 'glass curtain-wall hotel tower on a chamfered lobby podium with pilasters, porte-cochere canopy, mechanical penthouse & rooftop neon sign',
  parts: [
    { geo: 'box', tag: 'plinth', mat: 'dark', s: [11.6, 0.32, 14.2], at: [0.5, 0, 0] },
    { geo: 'rbox', tag: 'wall', mat: 'wall', s: [11.2, 3.85, 13.8], at: [0.5, 0.28, 0] },
    { geo: 'box', tag: 'window', mat: 'glass', s: [0.12, 2.35, 9.6], at: [-5.14, 0.65, 0] },
    { geo: 'box', tag: 'door', mat: 'door', s: [0.16, 2.25, 2.2], at: [-5.18, 0.3, 0] },
    { geo: 'rbox', tag: 'roof', mat: 'roof', s: [11.8, 0.36, 14.4], at: [0.5, 4.08, 0] },
    { geo: 'box', tag: 'wall', mat: { facade: [6, 8] }, s: [8.6, 17.8, 10.8], at: [1.6, 4.38, 0] },
    { for: 'px', in: [-2.65, 5.85], do: [
      { for: 'pz', in: [-5.35, 5.35], do: [
        { geo: 'rbox', tag: 'pilaster', mat: 'trim', s: [0.55, 18, 0.55], at: ['px', 4.36, 'pz'] },
      ] },
    ] },
    { geo: 'rbox', tag: 'roof', mat: 'roof', s: [9.3, 0.44, 11.5], at: [1.6, 22.1, 0] },
    { geo: 'rbox', tag: 'penthouse', mat: 'metal', s: [3.6, 1.4, 5.2], at: [3.9, 22.48, 0] },
    { geo: 'box', tag: 'island', mat: 'lot', s: [2.8, 0.16, 7.2], at: [-6.4, 0, 0] },
    { geo: 'rbox', tag: 'canopy', mat: 'accent', s: [3.1, 0.32, 6.4], at: [-6.3, 3.18, 0] },
    { geo: 'box', tag: 'band', mat: 'neon', s: [3.18, 0.1, 6.48], at: [-6.3, 3.46, 0] },
    { for: 'cz', in: [-2.6, 2.6], do: [
      { geo: 'oct', tag: 'base', mat: 'dark', s: [0.48, 0.32, 0.48], at: [-7.4, 0.14, 'cz'] },
      { geo: 'cyl16', tag: 'post', mat: 'trim', s: [0.16, 3.12, 0.16], at: [-7.4, 0.16, 'cz'] },
    ] },
    { sign: { style: 'neon', w: 7, h: 2 }, at: [0.1, 22.5, 0] },
  ],
};
