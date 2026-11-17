export default {
  id: 'medic', kind: 'vehicle', v: 1, label: 'ambulance',
  note: 'Type-III modular ambulance: cab-over alcove, emergency beltline & sill stripes, flank crosses, scene lamps, rear door glass & roof siren',
  params: { len: { from: 'def', default: 6.2 }, w: { from: 'def', default: 2.2 }, h: { from: 'def', default: 3 }, pick: { from: 'code', type: 'int', default: 0, min: 0, max: 99, note: 'variant (sedan paint)' }, hi: { from: 'code', type: 'bool', default: true, note: 'high beams (every third vehicle)' } },
  consts: { WHITE: 0xf0f0ea, RED: 0xe02020, AMBER: 0xff9a10, GLASS: 0x293d52, CHROME: 0xdce2e8 },
  vars: {
    cabL: 'min(2.35, len * 0.3)', zf: '-len * 0.48', boxLen: 'len * 0.96 - cabL - 0.08', boxZ: 'zf + cabL + 0.08 + boxLen / 2',
    cargoH: 'h - 0.98', cargoY: '0.84 + cargoH / 2', crossY: 'cargoY + 0.24',
  },
  parts: [
    { use: 'veh-box-body', with: { len: 'len', w: 'w', h: 'h', color: 'WHITE', cargo: 'WHITE', hi: 'hi' } },
    { geo: 'rbox', tag: 'alcove', mat: { color: 'WHITE' }, s: ['w * 0.92', 0.46, 0.62], at: [0, 'h - 0.38', 'boxZ - boxLen / 2 - 0.24'] },
    { geo: 'box', tag: 'stripe', mat: { color: 'RED' }, s: ['w * 0.976', 0.24, 'boxLen - 0.08'], at: [0, 1.36, 'boxZ'] },
    { geo: 'box', tag: 'stripe', mat: { color: 'AMBER' }, s: ['w * 0.98', 0.07, 'boxLen - 0.08'], at: [0, 1.18, 'boxZ'] },
    { geo: 'rbox', tag: 'vent', mat: { color: 'CHROME' }, s: [0.58, 0.1, 0.58], at: [0, '0.84 + cargoH + 0.03', 'boxZ + 0.35'] },
    { geo: 'box', tag: 'decal', mat: { color: 'RED' }, s: [0.14, 0.48, 0.05], at: [0, 'cargoY - 0.28', 'boxZ + boxLen / 2 + 0.015'] },
    { geo: 'box', tag: 'decal', mat: { color: 'RED' }, s: [0.48, 0.14, 0.05], at: [0, 'cargoY - 0.28', 'boxZ + boxLen / 2 + 0.018'] },
    { for: 'x', in: [-1, 1], do: [
      { geo: 'box', tag: 'decal', mat: { color: 'RED' }, s: [0.05, 0.68, 0.18], at: ['x * (w * 0.482)', 'crossY', 'boxZ + 0.1'] },
      { geo: 'box', tag: 'decal', mat: { color: 'RED' }, s: [0.05, 0.18, 0.68], at: ['x * (w * 0.484)', 'crossY', 'boxZ + 0.1'] },
      { geo: 'box', tag: 'lamp', mat: { color: 0xfff2c0, lamp: true }, s: [0.05, 0.12, 0.28], at: ['x * (w * 0.482)', '0.84 + cargoH - 0.22', 'boxZ - 0.65'] },
      { geo: 'box', tag: 'glass', mat: { color: 'GLASS' }, s: [0.46, 0.52, 0.05], at: ['x * 0.54', 'cargoY + 0.22', 'boxZ + boxLen / 2 + 0.015'] },
    ] },
    { use: 'veh-siren', with: { w: 'w * 0.88', y: '0.84 + cargoH + 0.08', z: 'boxZ - boxLen / 2 + 0.28' } },
  ],
};
