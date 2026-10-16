export default {
  id: 'veh-wheels', kind: 'part', v: 1,
  note: 'tyre + silver rim disc + coloured hub cap per wheel. The tyre sits 8 cm past the body: the hulls are plain boxes with no arches, so a flush tyre hides inside the paint',
  params: {
    w: { default: 1.85, min: 1.4, max: 2.8, note: 'body width, m' },
    zs: { type: 'list', default: [-1.5, 1.5], maxLen: 4, note: 'axle positions along the body, m (forward = -z)' },
    r: { default: 0.32, min: 0.25, max: 0.6, note: 'tyre radius, m' },
    hub: { type: 'color', default: 0x6a7078 },
  },
  vars: { tw: 'r * 0.75', xo: 'w / 2 + 0.08' },
  parts: [
    { for: 'z', in: 'zs', do: [
      { for: 'x', in: [-1, 1], do: [
        { geo: 'wheel20', tag: 'tyre', mat: { color: 0x151515 }, s: ['r', 'tw', 'r'], at: ['x * (xo - tw / 2 + 0)', 'r', 'z'], rot: [0, 0, 'PI / 2'] },
        { geo: 'wheel20', tag: 'rim', mat: { color: 0xc4c8ce }, s: ['r * 0.64', 'tw', 'r * 0.64'], at: ['x * (xo - tw / 2 + 0.035)', 'r', 'z'], rot: [0, 0, 'PI / 2'] },
        { geo: 'wheel20', tag: 'hub', mat: { color: 'hub' }, s: ['r * 0.26', 'tw', 'r * 0.26'], at: ['x * (xo - tw / 2 + 0.06)', 'r', 'z'], rot: [0, 0, 'PI / 2'] },
      ] },
    ] },
  ],
};
