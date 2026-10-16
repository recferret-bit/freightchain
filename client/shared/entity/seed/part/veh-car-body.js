export default {
  id: 'veh-car-body', kind: 'part', v: 1,
  note: 'passenger car: body, glasshouse, roof, 4 wheels, lamps',
  params: {
    len: { default: 4.6, min: 3, max: 6 }, w: { default: 1.85, min: 1.4, max: 2.4 },
    color: { type: 'color', default: 0xb8bcc2 }, hi: { type: 'bool', default: false },
  },
  consts: { GLASS: 0x1d2a36 },
  parts: [
    { geo: 'box', tag: 'body', mat: { color: 'color' }, s: ['w', 0.7, 'len'], at: [0, 0.65, 0] },
    { geo: 'box', tag: 'glass', mat: { color: 'GLASS' }, s: ['w * 0.86', 0.6, 'len * 0.5'], at: [0, 1.3, 'len * 0.06'] },
    { geo: 'box', tag: 'roof', mat: { color: 'color' }, s: ['w * 0.88', 0.06, 'len * 0.46'], at: [0, 1.63, 'len * 0.06'] },
    { use: 'veh-wheels', with: { w: 'w', zs: ['-len * 0.32', 'len * 0.32'], r: 0.32, hub: 'color == 0xb8bcc2 ? 0x2f4a7a : color' } },
    { use: 'veh-lights', with: { w: 'w', len: 'len', y: 0.75, brakeY: 0.85, hi: 'hi' } },
  ],
};
