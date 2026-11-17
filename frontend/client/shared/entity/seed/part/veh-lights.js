export default {
  id: 'veh-lights', kind: 'part', v: 1,
  note: 'bezel-framed head lamps (-z) and split tail/reverse lamps (+z), night glows, road beams, turn indicators and brake group',
  params: {
    w: { default: 1.85, min: 1.4, max: 2.8 }, len: { default: 4.6, min: 3, max: 18 },
    y: { default: 0.75, min: 0.3, max: 2, note: 'lamp height, m' }, brakeY: { default: 0.85, min: 0.3, max: 2.5 },
    hi: { type: 'bool', default: false, note: 'high beams: a longer, brighter pool' },
  },
  consts: { HEAD: 0xfff2c0, TAIL: 0x9e1612, BRAKE: 0xff3020, REV: 0xf0f4ff, DARK: 0x181b20 },
  parts: [
    { for: 'x', in: [-1, 1], do: [
      { geo: 'rbox', tag: 'bezel', mat: { color: 'DARK' }, s: [0.36, 0.21, 0.08], at: ['x * (w * 0.34)', 'y', '-len * 0.48 - 0.015'] },
      { geo: 'box', tag: 'headlamp', mat: { color: 'HEAD', lamp: true }, s: [0.28, 0.15, 0.08], at: ['x * (w * 0.34)', 'y', '-len * 0.48 - 0.03'] },
      { geo: 'rbox', tag: 'bezel', mat: { color: 'DARK' }, s: [0.38, 0.21, 0.08], at: ['x * (w * 0.34)', 'y', 'len * 0.48 + 0.015'] },
      { geo: 'box', tag: 'taillamp', mat: { color: 'TAIL', lamp: true }, s: [0.24, 0.15, 0.08], at: ['x * (w * 0.36)', 'y', 'len * 0.48 + 0.03'] },
      { geo: 'box', tag: 'taillamp', mat: { color: 'REV', lamp: true }, s: [0.1, 0.09, 0.08], at: ['x * (w * 0.26)', 'y - 0.02', 'len * 0.48 + 0.03'] },
      { glow: { color: 'HEAD', size: 2.6, gain: 1 }, at: ['x * (w * 0.34)', 'y', '-len / 2 - 0.08'] },
      { glow: { color: 'BRAKE', size: 1.1, gain: 0.7 }, at: ['x * (w * 0.34)', 'y', 'len / 2 + 0.08'] },
    ] },
    { beam: { color: 'HEAD', gain: 'hi ? 0.75 : 0.5', w: 'hi ? 12 : 8', l: 'hi ? 50 : 28', z0: 'len / 2 + 1' } },
    { beam: { color: 'BRAKE', gain: 0.3, w: 5, l: 7, z0: 'len / 2 + 0.8', back: true } },
    { group: { role: 'ind.l', visible: false }, do: [{ use: 'veh-indicator', with: { sx: -1, w: 'w', len: 'len', y: 'y' } }] },
    { group: { role: 'ind.r', visible: false }, do: [{ use: 'veh-indicator', with: { sx: 1, w: 'w', len: 'len', y: 'y' } }] },
    { group: { role: 'brake', visible: false }, do: [
      { beam: { color: 'BRAKE', gain: 0.55, w: 7, l: 12, z0: 'len / 2 + 0.8', back: true } },
      { geo: 'box', tag: 'brakelamp', mat: { color: 'BRAKE', lamp: true }, s: ['w * 0.28', 0.06, 0.08], at: [0, 'brakeY + 0.09', 'len * 0.48 + 0.015'] },
      { for: 'x', in: [-1, 1], do: [
        { geo: 'box', tag: 'brakelamp', mat: { color: 'BRAKE', lamp: true }, s: [0.34, 0.19, 0.09], at: ['x * (w * 0.34)', 'brakeY', 'len * 0.48 + 0.04'] },
        { glow: { color: 'BRAKE', size: 2.2, gain: 1 }, at: ['x * (w * 0.34)', 'brakeY', 'len / 2 + 0.14'] },
      ] },
    ] },
  ],
};
