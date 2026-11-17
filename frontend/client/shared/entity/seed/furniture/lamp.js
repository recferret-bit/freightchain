export default {
  id: 'lamp', kind: 'furniture', v: 1,
  note: 'highway cobra-head street lamp: octagonal concrete pedestal, tapered mast, braced outreach arm, luminaire hood & glowing bulb',
  params: {
    h: { from: 'code', default: 8.4, min: 5, max: 12, note: 'mast height, m (the route sets it)' },
    arm: { from: 'code', default: 3.6, min: 1, max: 6, note: 'arm length, m (the route sets it)' },
    sd: { from: 'code', type: 'int', enum: [-1, 1], default: 1, note: 'side of the road: 1 right, -1 left' },
    light: { from: 'code', type: 'color', default: 0xffa84a, note: 'bulb colour' },
  },
  slots: { mast: { note: 'mast and arm' }, bulb: { note: 'self-lit bulb' } },
  debris: 'mast',
  vars: { ax: '-sd * arm / 2', bl: 'min(arm * 0.55, 1.5)' },
  parts: [
    { geo: 'oct', tag: 'base', mat: 'mast', s: [0.52, 0.45, 0.52], at: [0, 0.225, 0] },
    { geo: 'cyl16', tag: 'collar', mat: 'mast', s: [0.17, 1.1, 0.17], at: [0, 0.95, 0] },
    { geo: 'cyl16', tag: 'pole', mat: 'mast', s: [0.12, 'h - 0.35', 0.12], at: [0, '0.35 + (h - 0.35) / 2', 0] },
    { geo: 'rbox', tag: 'arm', mat: 'mast', s: ['arm + 0.2', 0.13, 0.13], at: ['ax', 'h - 0.06', 0] },
    { geo: 'box', tag: 'brace', mat: 'mast', s: ['bl', 0.08, 0.08], at: ['-sd * bl * 0.43', 'h - 0.06 - bl * 0.24', 0], rot: [0, 0, '-sd * 0.52'] },
    { geo: 'rbox', tag: 'hood', mat: 'mast', s: [1.18, 0.18, 0.48], at: ['-sd * arm', 'h - 0.04', 0] },
    { geo: 'rbox', tag: 'bulb', mat: 'bulb', s: [0.92, 0.1, 0.36], at: ['-sd * arm', 'h - 0.15', 0] },
    { glow: { color: 'light', size: 7, gain: 1.1 }, role: 'glow', at: ['-sd * arm', 'h - 0.35', 0] },
  ],
};
