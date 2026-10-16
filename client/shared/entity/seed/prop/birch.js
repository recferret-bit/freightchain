export default {
  id: 'birch', kind: 'prop', v: 1, label: 'birch',
  note: 'winter birch: white trunk with dark marks and bare twigs',
  params: { h: { default: 6.5, min: 5, max: 8, note: 'tree height, m' } },
  slots: { trunk: { note: 'white bark' }, mark: { note: 'dark marks' } },
  debris: 'trunk',
  vars: { half: 'h * 0.11', R: 0.13 },
  parts: [
    { geo: 'cyl', tag: 'trunk', mat: 'trunk', s: [0.13, 'h', 0.13], at: [0, 'h / 2', 0] },
    { for: 'y', in: [0.15, 0.32, 0.5, 0.68], do: [
      { geo: 'box', tag: 'mark', mat: 'mark', s: [0.16, 0.07, 0.16], at: [0, 'h * y', 0] },
    ] },
    { for: ['y', 'a'], in: [[0.7, 0.7], [0.82, -0.6], [0.9, 0.4]], let: { s: 'sin(a)' },
      note: 'a twig is a long box spun about its centre; the centre sits out past the bark or the box pokes out the far side of the trunk',
      do: [
        { geo: 'box', tag: 'twig', mat: 'trunk', s: [0.05, 'h * 0.22', 0.05], at: ['sign(s) * R + s * half', 'h * y', 0], rot: [0, 0, '-a'] },
      ] },
  ],
};
