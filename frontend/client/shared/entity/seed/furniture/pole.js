export default {
  id: 'pole', kind: 'furniture', v: 1,
  note: 'highway utility pole: ground sleeve, tapered timber/concrete shaft, braced twin crossarms, pin insulators & distribution transformer',
  slots: { m: { note: 'wood or concrete' } },
  debris: 'm',
  parts: [
    { geo: 'oct', tag: 'base', mat: 'm', s: [0.42, 0.36, 0.42], at: [0, 0.18, 0] },
    { geo: 'cyl16', tag: 'pole', mat: 'm', s: [0.16, 4.4, 0.16], at: [0, 2.3, 0] },
    { geo: 'cyl16', tag: 'pole', mat: 'm', s: [0.125, 3.8, 0.125], at: [0, 6.2, 0] },
    { geo: 'rbox', tag: 'crossbar', mat: 'm', s: [2.7, 0.16, 0.16], at: [0, 7.6, 0] },
    { geo: 'rbox', tag: 'crossbar', mat: 'm', s: [2, 0.14, 0.14], at: [0, 6.85, 0] },
    { for: 'sx', in: [-1, 1], do: [
      { geo: 'box', tag: 'brace', mat: 'm', s: [0.76, 0.06, 0.06], at: ['sx * 0.31', 7.34, 0.06], rot: [0, 0, 'sx * 0.62'] },
    ] },
    { for: 'ix', in: [-1.15, -0.45, 0.45, 1.15], do: [
      { geo: 'cyl16', tag: 'insulator', mat: { global: 'steel' }, s: [0.06, 0.22, 0.06], at: ['ix', 7.76, 0] },
    ] },
    { geo: 'box', tag: 'bracket', mat: { global: 'steel' }, s: [0.16, 0.55, 0.28], at: [0, 5.55, 0.18] },
    { geo: 'cyl16', tag: 'drum', mat: { global: 'steel' }, s: [0.28, 0.88, 0.28], at: [0, 5.55, 0.48] },
  ],
};
