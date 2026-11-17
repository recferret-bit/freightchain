export default {
  id: 'lm-cones', kind: 'part', v: 1, anchor: 'base',
  note: 'grounded highway traffic cones along z: weighted dark rubber base pad, orange cone body & reflective white collar',
  params: { x: { default: 0 }, z0: { default: 0 }, n: { type: 'int', default: 3, min: 1, max: 8 }, dz: { default: 1.5 } },
  slots: { cone: {}, dark: { optional: true, default: 'cone' }, white: { optional: true, default: 'cone' } },
  parts: [
    { for: 'i', range: [0, 'n'], let: { cz: 'z0 + i * dz' }, do: [
      { geo: 'rbox', tag: 'base', mat: 'dark', s: [0.46, 0.06, 0.46], at: ['x', 0, 'cz'] },
      { geo: 'cone', tag: 'cone', mat: 'cone', s: [0.22, 0.68, 0.22], at: ['x', 0.04, 'cz'] },
      { geo: 'cyl16', tag: 'collar', mat: 'white', s: [0.125, 0.15, 0.125], at: ['x', 0.34, 'cz'] },
    ] },
  ],
};
