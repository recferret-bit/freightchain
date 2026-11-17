export default {
  id: 'round-tree', kind: 'prop', v: 1, label: 'broadleaf tree',
  note: 'broadleaf oak: flared root collar, trunk, forked limbs & 5-lobe organic foliage crown',
  params: { h: { default: 6.5, min: 5, max: 8, note: 'tree height, m' } },
  slots: { trunk: { note: 'bark' }, leaf: { note: 'foliage' } },
  debris: 'leaf',
  parts: [
    { geo: 'cone', tag: 'root', mat: 'trunk', s: [0.48, 'h * 0.12', 0.48], at: [0, 'h * 0.06', 0] },
    { geo: 'cyl', tag: 'trunk', mat: 'trunk', s: [0.28, 'h * 0.54', 0.28], at: [0, 'h * 0.27', 0] },
    { geo: 'cyl', tag: 'limb', mat: 'trunk', s: [0.14, 'h * 0.24', 0.14], at: ['h * 0.08', 'h * 0.54', 0], rot: [0, 0, -0.55] },
    { geo: 'cyl', tag: 'limb', mat: 'trunk', s: [0.13, 'h * 0.22', 0.13], at: ['-h * 0.08', 'h * 0.52', 'h * 0.04'], rot: [0.2, 0, 0.52] },
    { geo: 'rock', tag: 'canopy', mat: 'leaf', s: ['h * 0.3', 'h * 0.24', 'h * 0.3'], at: [0, 'h * 0.72', 0] },
    { geo: 'rock', tag: 'canopy', mat: 'leaf', s: ['h * 0.23', 'h * 0.19', 'h * 0.23'], at: ['h * 0.16', 'h * 0.66', 'h * 0.06'] },
    { geo: 'rock', tag: 'canopy', mat: 'leaf', s: ['h * 0.22', 'h * 0.18', 'h * 0.22'], at: ['-h * 0.15', 'h * 0.64', '-h * 0.05'] },
    { geo: 'rock', tag: 'canopy', mat: 'leaf', s: ['h * 0.2', 'h * 0.17', 'h * 0.2'], at: [0.05, 'h * 0.89', '-h * 0.04'] },
  ],
};
