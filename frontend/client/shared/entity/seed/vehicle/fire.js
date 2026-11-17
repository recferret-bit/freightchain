export default {
  id: 'fire', kind: 'vehicle', v: 1, label: 'fire truck',
  note: 'heavy pumper/ladder apparatus: white cab roof, chrome bumper tray, midship pump panel, suction hoses, twin-rail runged ladder & siren',
  params: { len: { from: 'def', default: 9 }, w: { from: 'def', default: 2.5 }, h: { from: 'def', default: 3.3 }, pick: { from: 'code', type: 'int', default: 0, min: 0, max: 99, note: 'variant (sedan paint)' }, hi: { from: 'code', type: 'bool', default: true, note: 'high beams (every third vehicle)' } },
  consts: { RED: 0xe02020, WHITE: 0xf0f0ea, GOLD: 0xe8c020, SHUTTER: 0xd0d4da, CHROME: 0xc8c8c0, HOSE: 0x2b3038, DARK: 0x1e2228 },
  vars: {
    cabL: 'min(2.35, len * 0.3)', zf: '-len * 0.48', boxLen: 'len * 0.96 - cabL - 0.08', boxZ: 'zf + cabL + 0.08 + boxLen / 2',
    cargoTop: '0.84 + (h - 0.98)', ladLen: 'boxLen * 0.86',
  },
  parts: [
    { use: 'veh-box-body', with: { len: 'len', w: 'w', h: 'h', color: 'RED', cargo: 'RED', hi: 'hi' } },
    { geo: 'rbox', tag: 'roof', mat: { color: 'WHITE' }, s: ['w * 0.9', 0.12, 'cabL * 0.62'], at: [0, 2.44, 'zf + cabL * 0.68'] },
    { geo: 'box', tag: 'stripe', mat: { color: 'GOLD' }, s: ['w * 0.974', 0.14, 'boxLen - 0.08'], at: [0, 1.08, 'boxZ'] },
    { geo: 'box', tag: 'stripe', mat: { color: 'WHITE' }, s: ['w * 0.978', 0.05, 'boxLen - 0.08'], at: [0, 0.98, 'boxZ'] },
    { geo: 'rbox', tag: 'panel', mat: { color: 'DARK' }, s: ['w * 0.992', 1.18, 0.92], at: [0, 1.66, 'zf + cabL + 0.64'] },
    { for: 'sz', in: [-0.85, 0.45, 1.75], do: [
      { geo: 'rbox', tag: 'shutter', mat: { color: 'SHUTTER' }, s: ['w * 0.982', 1.08, 1.08], at: [0, 1.74, 'boxZ + sz'] },
      { geo: 'box', tag: 'trim', mat: { color: 'DARK' }, s: ['w * 0.988', 0.06, 0.98], at: [0, 1.24, 'boxZ + sz'] },
    ] },
    { for: 'x', in: [-1, 1], do: [
      { geo: 'cyl16', tag: 'gauge', mat: { color: 'WHITE' }, s: [0.06, 0.1, 0.06], at: ['x * (w * 0.49)', 1.92, 'zf + cabL + 0.46'], rot: [0, 0, 'PI / 2'] },
      { geo: 'cyl16', tag: 'gauge', mat: { color: 'WHITE' }, s: [0.06, 0.1, 0.06], at: ['x * (w * 0.49)', 1.92, 'zf + cabL + 0.74'], rot: [0, 0, 'PI / 2'] },
      { geo: 'cyl16', tag: 'valve', mat: { color: 'CHROME' }, s: [0.09, 0.12, 0.09], at: ['x * (w * 0.49)', 1.48, 'zf + cabL + 0.46'], rot: [0, 0, 'PI / 2'] },
      { geo: 'cyl16', tag: 'valve', mat: { color: 'CHROME' }, s: [0.09, 0.12, 0.09], at: ['x * (w * 0.49)', 1.48, 'zf + cabL + 0.74'], rot: [0, 0, 'PI / 2'] },
      { geo: 'cyl16', tag: 'hose', mat: { color: 'HOSE' }, s: [0.09, 'boxLen * 0.62', 0.09], at: ['x * (w * 0.495)', 2.58, 'boxZ + 0.45'], rot: ['PI / 2', 0, 0] },
      { geo: 'rbox', tag: 'ladder', mat: { color: 'CHROME' }, s: [0.08, 0.16, 'ladLen'], at: ['x * 0.34', 'cargoTop + 0.1', 'boxZ + 0.1'] },
      { geo: 'box', tag: 'mount', mat: { color: 'DARK' }, s: [0.1, 0.12, 0.16], at: ['x * 0.34', 'cargoTop + 0.01', 'boxZ - ladLen * 0.32'] },
      { geo: 'box', tag: 'mount', mat: { color: 'DARK' }, s: [0.1, 0.12, 0.16], at: ['x * 0.34', 'cargoTop + 0.01', 'boxZ + ladLen * 0.34'] },
    ] },
    { for: 'i', range: [0, 8], let: { rz: 'boxZ + 0.1 - ladLen * 0.42 + i * (ladLen * 0.12)' }, do: [
      { geo: 'cyl16', tag: 'ladder', mat: { color: 'CHROME' }, s: [0.03, 0.66, 0.03], at: [0, 'cargoTop + 0.1', 'rz'], rot: [0, 0, 'PI / 2'] },
    ] },
    { geo: 'cyl16', tag: 'monitor', mat: { color: 'CHROME' }, s: [0.14, 0.22, 0.14], at: [0, 'cargoTop + 0.08', 'boxZ - boxLen * 0.38'] },
    { use: 'veh-siren', with: { w: 'w * 0.86', y: 2.56, z: 'zf + cabL * 0.58' } },
  ],
};
