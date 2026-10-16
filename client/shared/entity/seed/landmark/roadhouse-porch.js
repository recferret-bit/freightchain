export default {
  id: 'roadhouse-porch', kind: 'landmark', v: 1, anchor: 'base', label: 'restaurant · porch',
  note: 'timber roadhouse: hip roof, porch, chimney and a hanging sign',
  parts: [
    { geo: 'box', tag: 'wall', mat: 'wall', s: [8, 3.2, 12], at: [1.5, 0, 0] },
    { geo: 'pyr', tag: 'roof', mat: 'roof', s: [9.8, 2.6, 13.8], at: [1.5, 3.2, 0] },
    { geo: 'box', tag: 'porch', mat: 'trim', s: [3, 0.18, 12], at: [-4, 3, 0] },
    { geo: 'box', tag: 'porch', mat: 'trim', s: [3, 0.15, 12], at: [-4, 0.2, 0] },
    { for: 'z', in: [-5.5, -1.8, 1.8, 5.5], do: [
      { geo: 'box', tag: 'post', mat: 'trim', s: [0.2, 2.9, 0.2], at: [-5.4, 0, 'z'] },
    ] },
    { geo: 'box', tag: 'door', mat: 'door', s: [0.1, 2.1, 1.2], at: [-2.52, 0.2, -1.5] },
    { geo: 'box', tag: 'window', mat: 'glass', s: [0.1, 1.2, 2.2], at: [-2.52, 1, 2.5] },
    { geo: 'box', tag: 'window', mat: 'glass', s: [0.1, 1.2, 2.2], at: [-2.52, 1, -4.6] },
    { geo: 'box', tag: 'chimney', mat: 'dark', s: [1, 4.8, 1], at: [3.5, 0, 4] },
    { geo: 'box', tag: 'pole', mat: 'metal', s: [0.2, 3.7, 0.2], at: [-5.4, 0, 6.5], note: 'the porch roof tops at 3.18; the board used to start at 2.6 and ran through that slab' },
    { sign: { style: 'cream', w: 2.8, h: 1.8 }, at: [-5.4, 3.7, 6.5] },
  ],
};
