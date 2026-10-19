export default {
  id: 'police', kind: 'vehicle', v: 1, label: 'police car',
  params: { len: { from: 'def', default: 4.8 }, w: { from: 'def', default: 1.9 }, h: { from: 'def', default: 1.8 }, pick: { from: 'code', type: 'int', default: 0, min: 0, max: 99, note: 'variant (sedan paint)' }, hi: { from: 'code', type: 'bool', default: true, note: 'high beams (every third vehicle)' } },
  parts: [
    { use: 'veh-car-body', with: { len: 'len', w: 'w', color: 0x15191f, hi: 'hi' } },
    { geo: 'box', tag: 'stripe', mat: { color: 0xf0f0ea }, s: ['w * 1.01', 0.3, 'len * 0.55'], at: [0, 0.75, 0] },
    { use: 'veh-siren', with: { w: 'w', y: 1.75, z: 'len * 0.06' } },
  ],
};
