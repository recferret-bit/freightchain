export default {
  id: 'post', kind: 'furniture', v: 1,
  note: 'delineator post, every 16 m on both sides',
  slots: { body: { note: 'post' }, cap: { note: 'reflector cap' } },
  debris: 'body',
  parts: [
    { geo: 'box', tag: 'pole', mat: 'body', s: [0.12, 1.1, 0.12], at: [0, 0.55, 0] },
    { geo: 'box', tag: 'cap', mat: 'cap', s: [0.13, 0.2, 0.13], at: [0, 0.95, 0] },
  ],
};
