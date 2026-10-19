export default {
  id: 'veh-indicator', kind: 'part', v: 1,
  note: 'amber turn indicators of one side, front and rear (model frame: right = +x)',
  params: { sx: { type: 'int', enum: [-1, 1], default: 1 }, w: { default: 1.85 }, len: { default: 4.6 }, y: { default: 0.75 } },
  parts: [
    { for: 'z', in: ['-len / 2 - 0.03', 'len / 2 + 0.03'], do: [
      { geo: 'box', tag: 'indicator', mat: { color: 0xff9a10, lamp: true }, s: [0.22, 0.14, 0.08], at: ['sx * (w / 2 - 0.12)', 'y + 0.02', 'z'] },
      { glow: { color: 0xff9a10, size: 1.3, gain: 1 }, at: ['sx * (w / 2 - 0.12)', 'y + 0.02', 'z + sign(z) * 0.1'] },
    ] },
  ],
};
