export default {
  id: 'round-tree', kind: 'prop', v: 1, label: 'broadleaf tree',
  note: 'broadleaf: trunk + two canopy blobs',
  params: { h: { default: 6.5, min: 5, max: 8, note: 'tree height, m' } },
  slots: { trunk: { note: 'bark' }, leaf: { note: 'foliage' } },
  debris: 'leaf',
  parts: [
    { geo: 'cyl', tag: 'trunk', mat: 'trunk', s: [0.3, 'h * 0.5', 0.3], at: [0, 'h * 0.25', 0] },
    { geo: 'rock', tag: 'canopy', mat: 'leaf', s: ['h * 0.32', 'h * 0.28', 'h * 0.32'], at: [0, 'h * 0.72', 0] },
    { geo: 'rock', tag: 'canopy', mat: 'leaf', s: ['h * 0.22', 'h * 0.2', 'h * 0.22'], at: ['h * 0.12', 'h * 0.92', 'h * 0.05'] },
  ],
};
