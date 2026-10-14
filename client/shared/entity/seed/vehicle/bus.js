export default {
  id: 'bus', kind: 'vehicle', v: 1, label: 'bus',
  params: { len: { from: 'def', default: 12 }, w: { from: 'def', default: 2.55 }, h: { from: 'def', default: 3.3 }, pick: { from: 'code', type: 'int', default: 0, min: 0, max: 99, note: 'variant (sedan paint)' }, hi: { from: 'code', type: 'bool', default: true, note: 'high beams (every third vehicle)' } },
  consts: { GLASS: 0x1d2a36 },
  parts: [
    { geo: 'box', tag: 'body', mat: { color: 0xd89a20 }, s: ['w', 'h - 0.6', 'len'], at: [0, '(h + 0.6) / 2', 0] },
    { geo: 'box', tag: 'glass', mat: { color: 'GLASS' }, s: ['w * 1.01', 0.8, 'len * 0.9'], at: [0, 2.1, 0] },
    { geo: 'box', tag: 'glass', mat: { color: 'GLASS' }, s: ['w * 0.9', 1, 0.06], at: [0, 1.9, '-len / 2 - 0.02'] },
    { use: 'veh-wheels', with: { w: 'w', zs: ['-len / 2 + 1.6', 'len / 2 - 2.5'], r: 0.42, hub: 0x8a5a14 } },
    { use: 'veh-lights', with: { w: 'w', len: 'len', y: 0.9, brakeY: 1.2, hi: 'hi' } },
  ],
};
