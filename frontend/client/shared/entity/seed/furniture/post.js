export default {
  id: 'post', kind: 'furniture', v: 1,
  note: 'highway delineator post every 16 m: ground collar, chamfered post shaft, dual reflector bands & angled weather cap',
  slots: { body: { note: 'post' }, cap: { note: 'reflector cap' } },
  debris: 'body',
  parts: [
    { geo: 'oct', tag: 'base', mat: 'body', s: [0.22, 0.1, 0.22], at: [0, 0.05, 0] },
    { geo: 'rbox', tag: 'pole', mat: 'body', s: [0.12, 1.04, 0.1], at: [0, 0.56, 0] },
    { geo: 'rbox', tag: 'cap', mat: 'cap', s: [0.135, 0.16, 0.115], at: [0, 0.92, 0] },
    { geo: 'box', tag: 'cap', mat: 'cap', s: [0.135, 0.06, 0.115], at: [0, 0.7, 0] },
    { geo: 'wedge', tag: 'top', mat: 'body', s: [0.13, 0.08, 0.11], at: [0, 1.1, 0] },
  ],
};
