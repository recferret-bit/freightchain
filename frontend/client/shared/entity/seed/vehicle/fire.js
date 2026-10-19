export default {
  id: 'fire', kind: 'vehicle', v: 1, label: 'fire truck',
  params: { len: { from: 'def', default: 9 }, w: { from: 'def', default: 2.5 }, h: { from: 'def', default: 3.3 }, pick: { from: 'code', type: 'int', default: 0, min: 0, max: 99, note: 'variant (sedan paint)' }, hi: { from: 'code', type: 'bool', default: true, note: 'high beams (every third vehicle)' } },
  consts: { RED: 0xe02020 },
  parts: [
    { use: 'veh-box-body', with: { len: 'len', w: 'w', h: 'h', color: 'RED', cargo: 'RED', hi: 'hi' } },
    { geo: 'box', tag: 'ladder', mat: { color: 0xc8c8c0 }, s: [0.5, 0.25, 'len * 0.6'], at: [0, 'h - 0.1', 'len * 0.1'] },
    { geo: 'box', tag: 'stripe', mat: { color: 0xe8c020 }, s: ['w * 1.01', 0.15, 'len * 0.6'], at: [0, 1.6, 'len * 0.12'] },
    { use: 'veh-siren', with: { w: 'w', y: 2.85, z: '-len * 0.3' }, note: 'cab roof is 2.75 (centre 2.1 + 1.3/2), forward of the taller cargo; bottom of the bar = that roof + 2 cm' },
  ],
};
