export default {
  id: 'termite', kind: 'prop', v: 1, label: 'termite mound',
  params: { h: { default: 2.3, min: 1.2, max: 3.4, note: 'height, m' } },
  slots: { m: { note: 'red earth' } },
  debris: 'm',
  parts: [
    { geo: 'cone', tag: 'mound', mat: 'm', s: ['h * 0.45', 'h', 'h * 0.45'], at: [0, 'h / 2', 0] },
    { geo: 'cone', tag: 'mound', mat: 'm', s: ['h * 0.28', 'h * 0.7', 'h * 0.28'], at: ['h * 0.25', 'h * 0.35', 'h * 0.1'] },
  ],
};
