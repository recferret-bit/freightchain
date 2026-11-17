export default {
  id: 'drift', kind: 'prop', v: 1, label: 'snow drift',
  note: 'wind-sculpted roadside snowbank: central pitched snow ridge flanked by overlapping drift mounds',
  params: { s: { default: 1.6, min: 1, max: 2.2, note: 'size, m' } },
  slots: { m: { note: 'snow' } },
  debris: 'm',
  parts: [
    { geo: 'gable', tag: 'snow', mat: 'm', s: ['s * 1.9', 's * 0.46', 's * 1.35'], at: [0, 's * 0.23', 0] },
    { geo: 'rock', tag: 'snow', mat: 'm', s: ['s * 0.95', 's * 0.34', 's * 0.72'], at: ['s * 0.42', 's * 0.32', 's * 0.18'] },
    { geo: 'rock', tag: 'snow', mat: 'm', s: ['s * 0.82', 's * 0.28', 's * 0.66'], at: ['-s * 0.48', 's * 0.26', '-s * 0.16'] },
  ],
};
