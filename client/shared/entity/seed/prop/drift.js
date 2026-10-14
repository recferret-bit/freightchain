export default {
  id: 'drift', kind: 'prop', v: 1, label: 'snow drift',
  params: { s: { default: 1.6, min: 1, max: 2.2, note: 'size, m' } },
  slots: { m: { note: 'snow' } },
  debris: 'm',
  parts: [
    { geo: 'rock', tag: 'snow', mat: 'm', s: ['s * 1.5', 's * 0.45', 's * 1.1'], at: [0, 's * 0.15', 0] },
  ],
};
