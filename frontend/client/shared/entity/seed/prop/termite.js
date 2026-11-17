export default {
  id: 'termite', kind: 'prop', v: 1, label: 'termite mound',
  note: 'Outback cathedral termite mound: earthen apron base, tall central spire & fluted buttress turrets',
  params: { h: { default: 2.3, min: 1.2, max: 3.4, note: 'height, m' } },
  slots: { m: { note: 'red earth' } },
  debris: 'm',
  parts: [
    { geo: 'cone', tag: 'base', mat: 'm', s: ['h * 0.56', 'h * 0.36', 'h * 0.56'], at: [0, 'h * 0.18', 0] },
    { geo: 'cone', tag: 'mound', mat: 'm', s: ['h * 0.36', 'h', 'h * 0.34'], at: [0, 'h * 0.5', 0] },
    { geo: 'cone', tag: 'mound', mat: 'm', s: ['h * 0.24', 'h * 0.74', 'h * 0.24'], at: ['h * 0.22', 'h * 0.37', 'h * 0.1'] },
    { geo: 'cone', tag: 'mound', mat: 'm', s: ['h * 0.21', 'h * 0.62', 'h * 0.21'], at: ['-h * 0.2', 'h * 0.31', '-h * 0.12'] },
    { geo: 'cone', tag: 'mound', mat: 'm', s: ['h * 0.18', 'h * 0.48', 'h * 0.18'], at: ['-0.04', 'h * 0.24', 'h * 0.24'] },
  ],
};
