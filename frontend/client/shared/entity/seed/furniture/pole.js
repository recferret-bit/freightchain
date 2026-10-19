export default {
  id: 'pole', kind: 'furniture', v: 1,
  note: 'utility pole with a crossbar',
  slots: { m: { note: 'wood or concrete' } },
  debris: 'm',
  parts: [
    { geo: 'box', tag: 'pole', mat: 'm', s: [0.28, 8, 0.28], at: [0, 4, 0] },
    { geo: 'box', tag: 'crossbar', mat: 'm', s: [2.6, 0.18, 0.18], at: [0, 7.5, 0] },
  ],
};
