export default {
  id: 'tuft', kind: 'prop', v: 1, label: 'grass tuft',
  note: 'grass clump: three leaning blades (spinifex / paja brava)',
  params: { s: { default: 1.2, min: 0.8, max: 1.7, note: 'size, m' } },
  slots: { m: { note: 'dry grass' } },
  debris: 'm',
  parts: [
    { for: ['x', 'z', 't'], in: [[0, 0, 0], [0.35, 0.1, 0.3], [-0.3, 0.15, -0.3]], do: [
      { geo: 'cone', tag: 'blade', mat: 'm', s: ['s * 0.35', 's * 1.2', 's * 0.35'], at: ['x * s', 's * 0.55', 'z * s'], rot: [0, 0, 't'] },
    ] },
  ],
};
