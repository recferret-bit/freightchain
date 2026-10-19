export default {
  id: 'guard', kind: 'furniture', v: 1,
  note: 'one 4 m guardrail segment on two posts',
  slots: { rail: { note: 'rail' }, post: { note: 'posts' } },
  debris: 'rail',
  parts: [
    { geo: 'box', tag: 'rail', mat: 'rail', s: [0.08, 0.3, 4], at: [0, 0.55, 0] },
    { for: 'z', in: [-1.9, 1.9], do: [
      { geo: 'box', tag: 'post', mat: 'post', s: [0.1, 0.7, 0.1], at: [0, 0.35, 'z'] },
    ] },
  ],
};
