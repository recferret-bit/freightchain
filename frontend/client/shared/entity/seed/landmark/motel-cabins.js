export default {
  id: 'motel-cabins', kind: 'landmark', v: 1, anchor: 'base', label: 'motel · cabins',
  note: 'motor-court cabins + manager lodge: hip roofs, brick chimneys, timber porch decks & awnings, framed doors & windows, pylon sign',
  parts: [
    { for: 'i', range: [0, 3], let: { z: '-8.2 + i * 5.4' }, do: [
      { geo: 'box', tag: 'plinth', mat: 'dark', s: [4.2, 0.22, 4.2], at: [2.1, 0, 'z'] },
      { geo: 'rbox', tag: 'wall', mat: 'wall', s: [4, 2.55, 4], at: [2.1, 0.18, 'z'] },
      { geo: 'pyr', tag: 'roof', mat: 'roof', s: [5.3, 1.65, 5.3], at: [2.1, 2.68, 'z'] },
      { geo: 'rbox', tag: 'chimney', mat: 'dark', s: [0.55, 3.8, 0.55], at: [3.4, 0, 'z + 1.1'] },
      { geo: 'rbox', tag: 'porch', mat: 'trim', s: [1.5, 0.2, 3.6], at: [-0.55, 0, 'z'] },
      { geo: 'wedge', tag: 'awning', mat: 'roof', s: [3.6, 0.45, 1.55], at: [-0.55, 2.22, 'z'], rot: [0, 'PI / 2', 0] },
      { for: 'pz', in: [-1.55, 1.55], do: [
        { geo: 'box', tag: 'post', mat: 'trim', s: [0.13, 2.1, 0.13], at: [-1.18, 0.18, 'z + pz'] },
      ] },
      { geo: 'box', tag: 'door', mat: 'door', s: [0.1, 1.98, 0.96], at: [0.06, 0.18, 'z - 0.85'] },
      { geo: 'box', tag: 'window', mat: 'glass', s: [0.1, 0.98, 1.18], at: [0.04, 1.08, 'z + 0.95'] },
      { geo: 'box', tag: 'sill', mat: 'trim', s: [0.16, 0.08, 1.3], at: [0.02, 1, 'z + 0.95'] },
    ] },
    { geo: 'box', tag: 'plinth', mat: 'dark', s: [4.7, 0.24, 5.2], at: [2.2, 0, 8.4] },
    { geo: 'rbox', tag: 'wall', mat: 'wall', s: [4.5, 2.95, 5], at: [2.2, 0.2, 8.4] },
    { geo: 'pyr', tag: 'roof', mat: 'roof', s: [6, 1.95, 6.2], at: [2.2, 3.08, 8.4] },
    { geo: 'rbox', tag: 'porch', mat: 'trim', s: [1.6, 0.22, 4.6], at: [-0.7, 0, 8.4] },
    { geo: 'wedge', tag: 'awning', mat: 'accent', s: [4.6, 0.45, 1.6], at: [-0.7, 2.42, 8.4], rot: [0, 'PI / 2', 0] },
    { for: 'pz', in: [6.4, 10.4], do: [
      { geo: 'box', tag: 'post', mat: 'trim', s: [0.14, 2.28, 0.14], at: [-1.35, 0.2, 'pz'] },
    ] },
    { geo: 'box', tag: 'window', mat: 'glass', s: [0.1, 1.32, 2.4], at: [-0.08, 1.05, 9.1] },
    { geo: 'box', tag: 'door', mat: 'door', s: [0.1, 2.02, 1], at: [-0.06, 0.2, 6.7] },
    { geo: 'oct', tag: 'base', mat: 'dark', s: [0.68, 0.35, 0.68], at: [-3.8, 0, -11.6] },
    { geo: 'cyl16', tag: 'pole', mat: 'metal', s: [0.16, 5.1, 0.16], at: [-3.8, 0.2, -11.6] },
    { sign: { style: 'red', w: 3.6, h: 1.6 }, at: [-3.8, 5.1, -11.6] },
  ],
};
