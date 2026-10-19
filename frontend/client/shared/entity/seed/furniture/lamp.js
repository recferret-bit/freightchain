export default {
  id: 'lamp', kind: 'furniture', v: 1,
  note: 'street lamp: mast beside the road, an arm over the lane edge, a bulb and its night glow',
  params: {
    h: { from: 'code', default: 8.4, min: 5, max: 12, note: 'mast height, m (the route sets it)' },
    arm: { from: 'code', default: 3.6, min: 1, max: 6, note: 'arm length, m (the route sets it)' },
    sd: { from: 'code', type: 'int', enum: [-1, 1], default: 1, note: 'side of the road: 1 right, -1 left' },
    light: { from: 'code', type: 'color', default: 0xffa84a, note: 'bulb colour' },
  },
  slots: { mast: { note: 'mast and arm' }, bulb: { note: 'self-lit bulb' } },
  debris: 'mast',
  vars: { ax: '-sd * arm / 2' },
  parts: [
    { geo: 'box', tag: 'pole', mat: 'mast', s: [0.22, 'h', 0.22], at: [0, 'h / 2', 0] },
    { geo: 'box', tag: 'arm', mat: 'mast', s: ['arm', 0.14, 0.14], at: ['ax', 'h', 0] },
    { geo: 'box', tag: 'bulb', mat: 'bulb', s: [1.1, 0.16, 0.45], at: ['-sd * arm', 'h - 0.1', 0] },
    { glow: { color: 'light', size: 7, gain: 1.1 }, role: 'glow', at: ['-sd * arm', 'h - 0.35', 0] },
  ],
};
