export default {
  id: 'cactus', kind: 'prop', v: 1, label: 'cactus',
  note: 'saguaro: trunk + up to two arms (r2 picks how many)',
  params: { h: { default: 3.6, min: 2, max: 6, note: 'height, m' }, r2: { default: 0.5, min: 0, max: 1, note: 'variant: arms appear past 0.3 and 0.65' } },
  slots: { m: { note: 'cactus green' } },
  debris: 'm',
  parts: [
    { geo: 'cyl', tag: 'trunk', mat: 'm', s: [0.32, 'h', 0.32], at: [0, 'h / 2', 0] },
    { when: 'r2 > 0.3', geo: 'box', tag: 'arm', mat: 'm', s: [0.7, 0.2, 0.2], at: [0.5, 'h * 0.45', 0] },
    { when: 'r2 > 0.3', geo: 'cyl', tag: 'arm', mat: 'm', s: [0.2, 'h * 0.35', 0.2], at: [0.8, 'h * 0.45 + h * 0.17', 0] },
    { when: 'r2 > 0.65', geo: 'box', tag: 'arm', mat: 'm', s: [0.6, 0.2, 0.2], at: [-0.45, 'h * 0.62', 0] },
    { when: 'r2 > 0.65', geo: 'cyl', tag: 'arm', mat: 'm', s: [0.2, 'h * 0.3', 0.2], at: [-0.7, 'h * 0.62 + h * 0.14', 0] },
  ],
};
