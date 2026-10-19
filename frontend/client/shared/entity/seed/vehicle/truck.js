export default {
  id: 'truck', kind: 'vehicle', v: 1, label: 'truck',
  params: { len: { from: 'def', default: 7.5 }, w: { from: 'def', default: 2.4 }, h: { from: 'def', default: 3.4 }, pick: { from: 'code', type: 'int', default: 0, min: 0, max: 99, note: 'variant (sedan paint)' }, hi: { from: 'code', type: 'bool', default: true, note: 'high beams (every third vehicle)' } },
  parts: [
    { use: 'veh-box-body', with: { len: 'len', w: 'w', h: 'h', color: 0x4a5a6a, cargo: 0xd8d4c8, hi: 'hi' } },
  ],
};
