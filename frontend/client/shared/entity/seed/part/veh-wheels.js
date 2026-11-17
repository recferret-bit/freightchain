export default {
  id: 'veh-wheels', kind: 'part', v: 1,
  note: 'tyre + silver rim dish + hub cap per wheel, joined by a solid dark axle shaft across the undercarriage',
  params: {
    w: { default: 1.85, min: 1.4, max: 2.8, note: 'body width, m' },
    zs: { type: 'list', default: [-1.5, 1.5], maxLen: 4, note: 'axle positions along the body, m (forward = -z)' },
    r: { default: 0.32, min: 0.25, max: 0.6, note: 'tyre radius, m' },
    hub: { type: 'color', default: 0x6a7078 },
  },
  vars: { tw: 'r * 0.76', xo: 'w / 2 + 0.06' },
  parts: [
    { for: 'z', in: 'zs', do: [
      { geo: 'cyl16', tag: 'axle', mat: { color: 0x22262c }, s: ['r * 0.18', 'w * 0.9', 'r * 0.18'], at: [0, 'r', 'z'], rot: [0, 0, 'PI / 2'] },
      { for: 'x', in: [-1, 1], do: [
        { geo: 'wheel20', tag: 'tyre', mat: { color: 0x151515 }, s: ['r', 'tw', 'r'], at: ['x * (xo - tw / 2)', 'r', 'z'], rot: [0, 0, 'PI / 2'] },
        { geo: 'wheel20', tag: 'rim', mat: { color: 0xc4c8ce }, s: ['r * 0.64', 'tw * 0.86', 'r * 0.64'], at: ['x * (xo - tw * 0.43 + 0.015)', 'r', 'z'], rot: [0, 0, 'PI / 2'] },
        { geo: 'wheel20', tag: 'hub', mat: { color: 'hub' }, s: ['r * 0.26', 'tw * 0.5', 'r * 0.26'], at: ['x * (xo - tw * 0.25 + 0.03)', 'r', 'z'], rot: [0, 0, 'PI / 2'] },
      ] },
    ] },
  ],
};
