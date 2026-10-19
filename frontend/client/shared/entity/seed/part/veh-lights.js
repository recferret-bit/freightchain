export default {
  id: 'veh-lights', kind: 'part', v: 1,
  note: 'head lamps (front, -z) and tail lamps, their night glow, light pools on the road, turn indicators and the brake group (toggled by the AI)',
  params: {
    w: { default: 1.85, min: 1.4, max: 2.8 }, len: { default: 4.6, min: 3, max: 18 },
    y: { default: 0.75, min: 0.3, max: 2, note: 'lamp height, m' }, brakeY: { default: 0.85, min: 0.3, max: 2.5 },
    hi: { type: 'bool', default: false, note: 'high beams: a longer, brighter pool' },
  },
  consts: { HEAD: 0xfff2c0, TAIL: 0x8a1410, BRAKE: 0xff3020 },
  parts: [
    { for: 'x', in: [-1, 1], do: [
      { geo: 'box', tag: 'headlamp', mat: { color: 'HEAD', lamp: true }, s: [0.3, 0.18, 0.08], at: ['x * (w / 2 - 0.3)', 'y', '-len / 2 - 0.02'] },
      { geo: 'box', tag: 'taillamp', mat: { color: 'TAIL', lamp: true }, s: [0.3, 0.18, 0.08], at: ['x * (w / 2 - 0.3)', 'y', 'len / 2 + 0.02'] },
      { glow: { color: 'HEAD', size: 2.6, gain: 1 }, at: ['x * (w / 2 - 0.3)', 'y', '-len / 2 - 0.1'] },
      { glow: { color: 'BRAKE', size: 1.1, gain: 0.7 }, at: ['x * (w / 2 - 0.3)', 'y', 'len / 2 + 0.1'] },
    ] },
    { beam: { color: 'HEAD', gain: 'hi ? 0.75 : 0.5', w: 'hi ? 12 : 8', l: 'hi ? 50 : 28', z0: 'len / 2 + 1' } },
    { beam: { color: 'BRAKE', gain: 0.3, w: 5, l: 7, z0: 'len / 2 + 0.8', back: true } },
    { group: { role: 'ind.l', visible: false }, do: [{ use: 'veh-indicator', with: { sx: -1, w: 'w', len: 'len', y: 'y' } }] },
    { group: { role: 'ind.r', visible: false }, do: [{ use: 'veh-indicator', with: { sx: 1, w: 'w', len: 'len', y: 'y' } }] },
    { group: { role: 'brake', visible: false }, do: [
      { beam: { color: 'BRAKE', gain: 0.55, w: 7, l: 12, z0: 'len / 2 + 0.8', back: true } },
      { for: 'x', in: [-1, 1], do: [
        { geo: 'box', tag: 'brakelamp', mat: { color: 'BRAKE', lamp: true }, s: [0.36, 0.22, 0.1], at: ['x * (w / 2 - 0.3)', 'brakeY', 'len / 2 + 0.04'] },
        { glow: { color: 'BRAKE', size: 2.2, gain: 1 }, at: ['x * (w / 2 - 0.3)', 'brakeY', 'len / 2 + 0.15'] },
      ] },
    ] },
  ],
};
