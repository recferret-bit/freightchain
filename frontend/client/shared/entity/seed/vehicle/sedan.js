export default {
  id: 'sedan', kind: 'vehicle', v: 1, label: 'car',
  note: 'sculpted highway passenger sedan; pick chooses from 7 metallic/classic paints',
  params: { len: { from: 'def', default: 4.6 }, w: { from: 'def', default: 1.85 }, h: { from: 'def', default: 1.7 }, pick: { from: 'code', type: 'int', default: 0, min: 0, max: 99, note: 'variant (sedan paint)' }, hi: { from: 'code', type: 'bool', default: true, note: 'high beams (every third vehicle)' } },
  consts: { palette: [0xb8bcc2, 0x2f4a7a, 0x9a2b2b, 0xe0d8c0, 0x3d5a3a, 0x1e1e22, 0xc9a227] },
  vars: { body: 'palette[pick % len(palette)]' },
  parts: [
    { use: 'veh-car-body', with: { len: 'len', w: 'w', color: 'body', hi: 'hi' } },
    { geo: 'rbox', tag: 'spoiler', mat: { color: 'body == 0x1e1e22 ? 0x4a525d : 0x22262c' }, s: ['w * 0.84', 0.05, 0.14], at: [0, 1.08, 'len * 0.44'] },
    { geo: 'box', tag: 'trim', mat: { color: 0xdce2e8 }, s: ['w * 0.44', 0.035, 0.05], at: [0, 0.84, 'len * 0.48 + 0.02'] },
  ],
};
