export default {
  id: 'veh-indicator', kind: 'part', v: 1,
  note: 'amber corner turn indicators and side fender repeater of one side (model frame: right = +x)',
  params: { sx: { type: 'int', enum: [-1, 1], default: 1 }, w: { default: 1.85 }, len: { default: 4.6 }, y: { default: 0.75 } },
  parts: [
    { for: 'z', in: ['-len * 0.48 - 0.03', 'len * 0.48 + 0.03'], do: [
      { geo: 'rbox', tag: 'indicator', mat: { color: 0xff9a10, lamp: true }, s: [0.18, 0.13, 0.1], at: ['sx * (w * 0.46 - 0.04)', 'y + 0.02', 'z'] },
      { glow: { color: 0xff9a10, size: 1.3, gain: 1 }, at: ['sx * (w * 0.46 - 0.04)', 'y + 0.02', 'z + sign(z) * 0.1'] },
    ] },
    { geo: 'box', tag: 'indicator', mat: { color: 0xff9a10, lamp: true }, s: [0.04, 0.07, 0.16], at: ['sx * (w * 0.475 + 0.01)', 'y + 0.06', '-len * 0.2'] },
  ],
};
