export default {
  id: 'birch', kind: 'prop', v: 1, label: 'birch',
  note: 'winter silver birch: stepped dark basal bark collar, white trunk with lenticel bark rings, smoothly tapered forked crown & outer winter limbs/twigs (no leaf canopy)',
  params: { h: { default: 6.5, min: 5, max: 8, note: 'tree height, m' } },
  slots: { trunk: { note: 'white bark' }, mark: { note: 'dark marks' } },
  debris: 'trunk',
  parts: [
    { geo: 'cyl16', tag: 'root', mat: 'mark', s: [0.21, 'h * 0.045', 0.21], at: [0, 'h * 0.0225', 0] },
    { geo: 'cyl16', tag: 'collar', mat: 'mark', s: [0.158, 'h * 0.06', 0.158], at: [0, 'h * 0.055', 0] },
    { geo: 'cyl16', tag: 'trunk', mat: 'trunk', s: [0.125, 'h * 0.44', 0.125], at: [0, 'h * 0.26', 0] },
    { geo: 'cyl16', tag: 'limb', mat: 'trunk', s: [0.106, 'h * 0.18', 0.106], at: [0, 'h * 0.55', 0] },
    { geo: 'cyl16', tag: 'limb', mat: 'trunk', s: [0.086, 'h * 0.14', 0.086], at: [0, 'h * 0.69', 0] },
    { geo: 'cone', tag: 'limb', mat: 'trunk', s: [0.076, 'h * 0.26', 0.076], at: ['-h * 0.014', 'h * 0.87', 'h * 0.008'], rot: [0.07, 0, 0.11] },
    { geo: 'cone', tag: 'limb', mat: 'trunk', s: [0.058, 'h * 0.22', 0.058], at: ['h * 0.028', 'h * 0.84', '-h * 0.018'], rot: [-0.18, 0, -0.28] },
    { for: 'y', in: [0.14, 0.25, 0.36, 0.45], do: [
      { geo: 'cyl16', tag: 'mark', mat: 'mark', s: [0.133, 0.048, 0.133], at: [0, 'h * y', 0] },
    ] },
    { for: 'y', in: [0.54, 0.61], do: [
      { geo: 'cyl16', tag: 'mark', mat: 'mark', s: [0.114, 0.042, 0.114], at: [0, 'h * y', 0] },
    ] },
    { geo: 'cyl16', tag: 'mark', mat: 'mark', s: [0.093, 0.038, 0.093], at: [0, 'h * 0.7', 0] },
    { for: ['by', 'len', 'rb', 'rx', 'rz'], in: [
      [0.46, 0.28, 0.052, 0.18, -0.64],
      [0.52, 0.27, 0.048, -0.22, 0.6],
      [0.58, 0.26, 0.046, 0.58, 0.16],
      [0.63, 0.25, 0.044, -0.56, -0.18],
      [0.69, 0.23, 0.04, 0.24, -0.52],
      [0.74, 0.21, 0.036, -0.26, 0.48],
    ], let: { half: 'h * len * 0.5' }, do: [
      { geo: 'cone', tag: 'limb', mat: 'trunk', s: ['rb', 'h * len', 'rb'], at: ['-half * sin(rz)', 'h * by + half * cos(rx) * cos(rz)', 'half * sin(rx) * cos(rz)'], rot: ['rx', 0, 'rz'] },
    ] },
    { for: ['by', 'plen', 'prx', 'prz', 'len', 'rx', 'rz'], in: [
      [0.46, 0.28, 0.18, -0.64, 0.14, 0.44, -1.02],
      [0.52, 0.27, -0.22, 0.6, 0.14, -0.46, 0.96],
      [0.58, 0.26, 0.58, 0.16, 0.13, 0.96, 0.36],
      [0.63, 0.25, -0.56, -0.18, 0.13, -0.94, -0.38],
    ], let: { ps: 'h * plen * 0.45', half: 'h * len * 0.5' }, do: [
      { geo: 'cone', tag: 'twig', mat: 'trunk', s: [0.024, 'h * len', 0.024], at: ['-ps * sin(prz) - half * sin(rz)', 'h * by + ps * cos(prx) * cos(prz) + half * cos(rx) * cos(rz)', 'ps * sin(prx) * cos(prz) + half * sin(rx) * cos(rz)'], rot: ['rx', 0, 'rz'] },
    ] },
  ],
};
