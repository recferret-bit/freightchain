export default {
  id: 'bush', kind: 'prop', v: 1, label: 'bush',
  params: { s: { default: 1, min: 0.5, max: 1.5, note: 'size, m' } },
  slots: { m: { note: 'foliage' } },
  debris: 'm',
  parts: [
    { geo: 'cone', tag: 'canopy', mat: 'm', s: ['s', 's * 0.9', 's'], at: [0, 's * 0.45', 0] },
  ],
};
