export default {
  id: 'motel-strip', kind: 'landmark', v: 1, anchor: 'base', label: 'motel · strip',
  note: 'mid-century roadside motel strip: raised walkway, chamfered room wing with AC units & framed doors/windows, office corner, ice alcove & twin-post neon pylon',
  parts: [
    { geo: 'box', tag: 'walkway', mat: 'lot', s: [4.6, 0.14, 24.4], at: [-2.2, 0, 0] },
    { geo: 'box', tag: 'plinth', mat: 'dark', s: [5.05, 0.28, 24.1], at: [2.2, 0, 0] },
    { geo: 'rbox', tag: 'wall', mat: 'wall', s: [4.9, 3.05, 24], at: [2.2, 0.22, 0] },
    { geo: 'rbox', tag: 'office', mat: 'wall', s: [2.2, 3.05, 4.2], at: [-1, 0.12, 9.8] },
    { geo: 'box', tag: 'window', mat: 'glass', s: [0.1, 1.4, 2.8], at: [-2.12, 0.95, 9.8] },
    { geo: 'rbox', tag: 'machine', mat: 'accent', s: [0.85, 1.85, 1.1], at: [-0.55, 0.14, 6.9] },
    { geo: 'rbox', tag: 'roof', mat: 'roof', s: [9.2, 0.3, 25], at: [-0.05, 3.2, 0] },
    { geo: 'box', tag: 'band', mat: 'neon', s: [0.1, 0.2, 25.08], at: [-4.68, 3.25, 0] },
    { geo: 'rbox', tag: 'hvac', mat: 'metal', s: [1.5, 0.55, 1.8], at: [2.4, 3.46, -5.5] },
    { geo: 'rbox', tag: 'hvac', mat: 'metal', s: [1.5, 0.55, 1.8], at: [2.4, 3.46, 5.5] },
    { for: 'i', range: [0, 5], let: { z: '-9.8 + i * 3.9' }, do: [
      { geo: 'box', tag: 'frame', mat: 'trim', s: [0.1, 2.22, 1.24], at: [-0.28, 0.14, 'z'] },
      { geo: 'box', tag: 'door', mat: 'door', s: [0.1, 2.08, 1.04], at: [-0.32, 0.14, 'z'] },
      { geo: 'box', tag: 'window', mat: 'glass', s: [0.1, 1.12, 1.56], at: [-0.3, 1.08, 'z + 1.75'] },
      { geo: 'box', tag: 'sill', mat: 'trim', s: [0.16, 0.08, 1.68], at: [-0.32, 1, 'z + 1.75'] },
      { geo: 'rbox', tag: 'ac', mat: 'metal', s: [0.36, 0.38, 0.68], at: [-0.38, 0.48, 'z + 1.75'] },
    ] },
    { for: 'z', from: -11.5, step: 4.6, while: 'z <= 11.5', do: [
      { geo: 'oct', tag: 'base', mat: 'dark', s: [0.34, 0.22, 0.34], at: [-4.25, 0.12, 'z'] },
      { geo: 'cyl16', tag: 'post', mat: 'trim', s: [0.09, 3.1, 0.09], at: [-4.25, 0.14, 'z'] },
    ] },
    { for: 'dz', in: [-1.1, 1.1], do: [
      { geo: 'oct', tag: 'base', mat: 'dark', s: [0.46, 0.24, 0.46], at: [-5.55, 0, '10.6 + dz'] },
      { geo: 'cyl16', tag: 'pole', mat: 'metal', s: [0.14, 7.1, 0.14], at: [-5.55, 0.16, '10.6 + dz'] },
    ] },
    { geo: 'rbox', tag: 'tie', mat: 'accent', s: [0.32, 0.28, 2.6], at: [-5.55, 5.2, 10.6] },
    { sign: { style: 'neon', w: 4.2, h: 1.8 }, at: [-5.55, 7, 10.6] },
  ],
};
