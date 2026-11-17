export default {
  id: 'gantry', kind: 'gantry', v: 1, label: 'finish gantry',
  note: 'highway overhead space-frame truss gantry: concrete plinths, twin latticed steel towers, double-chord overhead bridge, sign luminaires & route banner',
  parts: [
    { for: 'sx', in: [-1, 1], let: { px: 'sx * 7.2' }, do: [
      { geo: 'oct', tag: 'plinth', mat: { global: 'steel' }, s: [1.1, 0.45, 1.35], at: ['px', 0.225, 0] },
      { geo: 'cyl16', tag: 'pole', mat: { global: 'steel' }, s: [0.18, 7.35, 0.18], at: ['px', 3.78, -0.36] },
      { geo: 'cyl16', tag: 'pole', mat: { global: 'steel' }, s: [0.18, 7.35, 0.18], at: ['px', 3.78, 0.36] },
      { for: 'ty', in: [1.6, 3.3, 5, 6.8], do: [
        { geo: 'rbox', tag: 'strut', mat: { global: 'steel' }, s: [0.22, 0.14, 0.88], at: ['px', 'ty', 0] },
      ] },
      { geo: 'rbox', tag: 'marker', mat: { global: 'red' }, s: [0.28, 0.55, 0.12], at: ['px', 1.2, 0.52] },
    ] },
    { for: 'by', in: [5.05, 7.35], do: [
      { for: 'bz', in: [-0.36, 0.36], do: [
        { geo: 'rbox', tag: 'chord', mat: { global: 'steel' }, s: [14.8, 0.2, 0.2], at: [0, 'by', 'bz'] },
      ] },
    ] },
    { for: 'bx', in: [-6, -3.6, -1.2, 1.2, 3.6, 6], do: [
      { geo: 'box', tag: 'web', mat: { global: 'steel' }, s: [0.14, 2.35, 0.84], at: ['bx', 6.2, 0] },
    ] },
    { for: 'hx', in: [-5.4, -1.8, 1.8, 5.4], do: [
      { geo: 'box', tag: 'mount', mat: { global: 'steel' }, s: [0.14, 2.38, 0.24], at: ['hx', 6.2, 0.43] },
    ] },
    { for: 'lx', in: [-4.2, 0, 4.2], do: [
      { geo: 'rbox', tag: 'hood', mat: { global: 'steel' }, s: [0.68, 0.14, 0.86], at: ['lx', 7.46, 0.68] },
    ] },
    { banner: { w: 14.4, h: 2.55 }, at: [0, 6.2, 0.56] },
  ],
};
