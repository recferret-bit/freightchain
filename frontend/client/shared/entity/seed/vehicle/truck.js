export default {
  id: 'truck', kind: 'vehicle', v: 1, label: 'truck',
  note: 'medium-duty commercial box truck: cab roof wind deflector, ribbed dry-van box, saddle diesel tank & side underrun rails',
  params: { len: { from: 'def', default: 7.5 }, w: { from: 'def', default: 2.4 }, h: { from: 'def', default: 3.4 }, pick: { from: 'code', type: 'int', default: 0, min: 0, max: 99, note: 'variant (sedan paint)' }, hi: { from: 'code', type: 'bool', default: true, note: 'high beams (every third vehicle)' } },
  consts: { CAB: 0x4a5a6a, CARGO: 0xd8d4c8, STRIPE: 0x1d3a5c, CHROME: 0xc4c8ce, DARK: 0x22262c },
  vars: { cabL: 'min(2.35, len * 0.3)', zf: '-len * 0.48', boxLen: 'len * 0.96 - cabL - 0.08', boxZ: 'zf + cabL + 0.08 + boxLen / 2' },
  parts: [
    { use: 'veh-box-body', with: { len: 'len', w: 'w', h: 'h', color: 'CAB', cargo: 'CARGO', hi: 'hi' } },
    { geo: 'wedge', tag: 'fairing', mat: { color: 'CAB' }, s: ['w * 0.88', 0.72, 'cabL * 0.56'], at: [0, 2.75, 'zf + cabL * 0.7'] },
    { geo: 'box', tag: 'stripe', mat: { color: 'STRIPE' }, s: ['w * 0.975', 0.24, 'boxLen - 0.08'], at: [0, 1.5, 'boxZ'] },
    { geo: 'rbox', tag: 'reefer', mat: { color: 'CHROME' }, s: ['w * 0.62', 0.62, 0.24], at: [0, 'h - 0.5', 'boxZ - boxLen / 2 - 0.08'] },
    { for: 'x', in: [-1, 1], do: [
      { geo: 'cyl16', tag: 'tank', mat: { color: 'CHROME' }, s: [0.24, 0.95, 0.24], at: ['x * (w * 0.36)', 0.64, 'zf + cabL + 0.68'], rot: ['PI / 2', 0, 0] },
      { geo: 'box', tag: 'guard', mat: { color: 'DARK' }, s: [0.05, 0.16, 'boxLen * 0.42'], at: ['x * (w * 0.46)', 0.68, 'boxZ - 0.15'] },
    ] },
    { for: 'i', range: [0, 4], let: { rz: 'boxZ - boxLen * 0.36 + i * (boxLen * 0.24)' }, do: [
      { geo: 'box', tag: 'rib', mat: { color: 'CHROME' }, s: ['w * 0.972', 'h - 1.24', 0.05], at: [0, '0.94 + (h - 1.24) / 2', 'rz'] },
    ] },
  ],
};
