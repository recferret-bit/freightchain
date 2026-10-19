export default {
  id: 'lm-cones', kind: 'part', v: 1,
  note: 'a row of traffic cones along z. Uses the landmark slot cone',
  params: { x: { default: 0 }, z0: { default: 0 }, n: { type: 'int', default: 3, min: 1, max: 8 }, dz: { default: 1.5 } },
  slots: { cone: {} },
  parts: [
    { for: 'i', range: [0, 'n'], do: [
      { geo: 'cone', tag: 'cone', mat: 'cone', s: [0.3, 0.7, 0.3], at: ['x', 0.35, 'z0 + i * dz'] },
    ] },
  ],
};
