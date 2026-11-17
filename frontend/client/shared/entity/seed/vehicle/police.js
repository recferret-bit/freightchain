export default {
  id: 'police', kind: 'vehicle', v: 1, label: 'police car',
  note: 'highway patrol interceptor: black-and-white livery, steel front push-bar, A-pillar spotlight, whip aerial & roof lightbar',
  params: { len: { from: 'def', default: 4.8 }, w: { from: 'def', default: 1.9 }, h: { from: 'def', default: 1.8 }, pick: { from: 'code', type: 'int', default: 0, min: 0, max: 99, note: 'variant (sedan paint)' }, hi: { from: 'code', type: 'bool', default: true, note: 'high beams (every third vehicle)' } },
  consts: { BLACK: 0x15191f, WHITE: 0xf0f0ea, BLUE: 0x2a5cff, DARK: 0x22262c, CHROME: 0xdce2e8 },
  parts: [
    { use: 'veh-car-body', with: { len: 'len', w: 'w', color: 'BLACK', roofColor: 'WHITE', hi: 'hi' } },
    { geo: 'rbox', tag: 'stripe', mat: { color: 'WHITE' }, s: ['w * 0.966', 0.5, 'len * 0.42'], at: [0, 0.7, 'len * 0.03'] },
    { geo: 'box', tag: 'decal', mat: { color: 'BLUE' }, s: ['w * 0.976', 0.11, 'len * 0.56'], at: [0, 0.76, 'len * 0.02'] },
    { for: 'px', in: [-0.34, 0.34], do: [
      { geo: 'rbox', tag: 'pushbar', mat: { color: 'DARK' }, s: [0.08, 0.48, 0.14], at: ['px', 0.58, '-len * 0.48 - 0.08'] },
    ] },
    { geo: 'box', tag: 'pushbar', mat: { color: 'DARK' }, s: [0.8, 0.07, 0.12], at: [0, 0.72, '-len * 0.48 - 0.09'] },
    { geo: 'cyl16', tag: 'spotlight', mat: { color: 'CHROME' }, s: [0.06, 0.12, 0.06], at: ['-w * 0.42', 1.15, '-len * 0.16'], rot: ['PI / 2', 0, 0] },
    { geo: 'cyl16', tag: 'aerial', mat: { color: 'CHROME' }, s: [0.015, 0.32, 0.015], at: [0, 1.66, 'len * 0.16'] },
    { use: 'veh-siren', with: { w: 'w * 0.92', y: 1.61, z: 'len * 0.04' } },
  ],
};
