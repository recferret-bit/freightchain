export default {
  id: 'guard', kind: 'furniture', v: 1,
  note: '4 m W-beam highway guardrail segment: twin corrugated rails facing traffic (-sd), central web channel, bolt washers, blockout spacers, I-posts & base plates',
  params: {
    sd: { from: 'code', type: 'int', enum: [-1, 1], default: -1, note: 'side of the road: 1 right, -1 left' },
  },
  slots: { rail: { note: 'rail' }, post: { note: 'posts' } },
  debris: 'rail',
  parts: [
    { geo: 'box', tag: 'rail', mat: 'rail', s: [0.04, 0.28, 4.02], at: ['-sd * 0.03', 0.56, 0] },
    { geo: 'rbox', tag: 'rail', mat: 'rail', s: [0.08, 0.11, 4.02], at: ['-sd * 0.055', 0.66, 0] },
    { geo: 'rbox', tag: 'rail', mat: 'rail', s: [0.08, 0.11, 4.02], at: ['-sd * 0.055', 0.46, 0] },
    { for: 'z', in: [-1.35, 1.35], do: [
      { geo: 'oct', tag: 'base', mat: 'post', s: [0.22, 0.06, 0.22], at: ['sd * 0.08', 0.03, 'z'] },
      { geo: 'rbox', tag: 'post', mat: 'post', s: [0.11, 0.76, 0.12], at: ['sd * 0.08', 0.39, 'z'] },
      { geo: 'box', tag: 'spacer', mat: 'post', s: [0.1, 0.22, 0.1], at: ['sd * 0.01', 0.56, 'z'] },
      { geo: 'rbox', tag: 'bolt', mat: 'post', s: [0.03, 0.06, 0.08], at: ['-sd * 0.058', 0.56, 'z'] },
    ] },
  ],
};
