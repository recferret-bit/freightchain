export default {
  id: 'gum-tree', kind: 'prop', v: 1, label: 'gum tree',
  note: 'eucalyptus / ghost gum: pale slim trunk, wide flat canopy',
  params: { h: { default: 7, min: 5, max: 9, note: 'tree height, m' } },
  slots: { trunk: { note: 'pale bark' }, leaf: { note: 'foliage' } },
  debris: 'leaf',
  parts: [
    { geo: 'cyl', tag: 'trunk', mat: 'trunk', s: [0.22, 'h * 0.8', 0.22], at: [0, 'h * 0.4', 0], rot: [0, 0, 0.08] },
    { geo: 'rock', tag: 'canopy', mat: 'leaf', s: ['h * 0.38', 'h * 0.13', 'h * 0.38'], at: [0.2, 'h * 0.86', 0] },
    { geo: 'rock', tag: 'canopy', mat: 'leaf', s: ['h * 0.26', 'h * 0.1', 'h * 0.26'], at: [-0.5, 'h * 0.72', 0.3] },
  ],
};
