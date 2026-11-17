export default {
  id: 'gum-tree', kind: 'prop', v: 1, label: 'gum tree',
  note: 'Outback ghost gum: flared buttress roots, leaning tapered pale trunk, forked boughs & separated flat eucalyptus foliage pads',
  params: { h: { default: 7, min: 5, max: 9, note: 'tree height, m' } },
  slots: { trunk: { note: 'pale bark' }, leaf: { note: 'foliage' } },
  debris: 'leaf',
  parts: [
    { geo: 'cyl16', tag: 'root', mat: 'trunk', s: [0.3, 'h * 0.035', 0.3], at: [0, 'h * 0.0175', 0] },
    { geo: 'cyl16', tag: 'collar', mat: 'trunk', s: [0.23, 'h * 0.06', 0.23], at: [0, 'h * 0.045', 0] },
    { for: 'ry', in: [0, 2.09, 4.19], do: [
      { group: {}, rot: [0, 'ry', 0], do: [
        { geo: 'wedge', tag: 'root', mat: 'trunk', s: [0.16, 'h * 0.075', 0.34], at: [0, 'h * 0.0375', -0.21] },
      ] },
    ] },
    { geo: 'cyl16', tag: 'trunk', mat: 'trunk', s: [0.185, 'h * 0.44', 0.185], at: ['h * 0.008', 'h * 0.25', 0], rot: [0, 0, -0.045] },
    { geo: 'cyl16', tag: 'limb', mat: 'trunk', s: [0.145, 'h * 0.13', 0.145], at: ['h * 0.019', 'h * 0.5', 0], rot: [0, 0, -0.06] },
    { geo: 'cone', tag: 'limb', mat: 'trunk', s: [0.142, 'h * 0.16', 0.142], at: ['h * 0.025', 'h * 0.61', 0], rot: [0, 0, -0.07] },
    { geo: 'cone', tag: 'limb', mat: 'trunk', s: [0.115, 'h * 0.36', 0.115], at: ['h * 0.115', 'h * 0.65', 'h * 0.02'], rot: [0.12, 0, -0.68] },
    { geo: 'cone', tag: 'limb', mat: 'trunk', s: [0.11, 'h * 0.34', 0.11], at: ['-h * 0.088', 'h * 0.66', '-h * 0.025'], rot: [-0.15, 0, 0.66] },
    { geo: 'cone', tag: 'limb', mat: 'trunk', s: [0.105, 'h * 0.38', 0.105], at: ['h * 0.032', 'h * 0.73', '-h * 0.03'], rot: [-0.18, 0, -0.1] },
    { geo: 'cone', tag: 'limb', mat: 'trunk', s: [0.095, 'h * 0.3', 0.095], at: ['-h * 0.012', 'h * 0.69', 'h * 0.085'], rot: [0.62, 0, 0.12] },
    { geo: 'rock', tag: 'canopy', mat: 'leaf', s: ['h * 0.19', 'h * 0.075', 'h * 0.17'], at: ['h * 0.23', 'h * 0.76', 'h * 0.04'] },
    { geo: 'rock', tag: 'canopy', mat: 'leaf', s: ['h * 0.18', 'h * 0.072', 'h * 0.16'], at: ['-h * 0.2', 'h * 0.77', '-h * 0.05'] },
    { geo: 'rock', tag: 'canopy', mat: 'leaf', s: ['h * 0.21', 'h * 0.08', 'h * 0.19'], at: ['h * 0.05', 'h * 0.91', '-h * 0.06'] },
    { geo: 'rock', tag: 'canopy', mat: 'leaf', s: ['h * 0.15', 'h * 0.065', 'h * 0.15'], at: ['-h * 0.04', 'h * 0.8', 'h * 0.18'] },
  ],
};
