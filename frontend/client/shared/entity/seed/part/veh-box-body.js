export default {
  id: 'veh-box-body', kind: 'part', v: 1,
  note: 'cab + cargo box (box truck, ambulance, fire truck)',
  params: {
    len: { default: 7.5, min: 4, max: 12 }, w: { default: 2.4, min: 1.6, max: 2.6 }, h: { default: 3.4, min: 2.4, max: 4.2 },
    color: { type: 'color', default: 0x4a5a6a }, cargo: { type: 'color', default: 0xd8d4c8 }, hi: { type: 'bool', default: false },
  },
  consts: { GLASS: 0x1d2a36 },
  vars: { cabL: 'min(2.4, len * 0.3)' },
  parts: [
    { geo: 'box', tag: 'body', mat: { color: 'color' }, s: ['w', 1.1, 'len'], at: [0, 0.9, 0] },
    { geo: 'box', tag: 'cabin', mat: { color: 'color' }, s: ['w', 1.3, 'cabL'], at: [0, 2.1, '-len / 2 + cabL / 2'] },
    { geo: 'box', tag: 'glass', mat: { color: 'GLASS' }, s: ['w * 0.9', 0.6, 0.06], at: [0, 2.3, '-len / 2 - 0.02'] },
    { geo: 'box', tag: 'cargo', mat: { color: 'cargo' }, s: ['w * 0.98', 'h - 1.7', 'len - cabL - 0.1'], at: [0, '1.45 + (h - 1.7) / 2', 'cabL / 2 + 0.05'] },
    { use: 'veh-wheels', with: { w: 'w', zs: ['-len / 2 + 1.4', 'len / 2 - 1.5'], r: 0.42, hub: 'color' } },
    { use: 'veh-lights', with: { w: 'w', len: 'len', y: 1, brakeY: 1.5, hi: 'hi' } },
  ],
};
