export default {
  id: 'spruce', kind: 'prop', v: 1, label: 'spruce',
  note: 'stacked cones; optional snow caps on each tier',
  params: { h: { default: 8, min: 4, max: 12, note: 'tree height, m' } },
  slots: { trunk: { note: 'bark' }, leaf: { note: 'needles' }, snow: { note: 'snow caps', optional: true } },
  debris: 'leaf',
  parts: [
    { geo: 'cyl', tag: 'trunk', mat: 'trunk', s: [0.25, 'h * 0.25', 0.25], at: [0, 'h * 0.125', 0] },
    { for: 'i', range: [0, 4], let: { y: 'h * (0.2 + i * 0.2)', w: 'h * (0.28 - i * 0.05)' }, do: [
      { geo: 'cone', tag: 'canopy', mat: 'leaf', s: ['w', 'h * 0.34', 'w'], at: [0, 'y + h * 0.12', 0] },
      { ifSlot: 'snow', geo: 'cone', tag: 'snow', mat: 'snow', s: ['w * 0.8', 'h * 0.2', 'w * 0.8'], at: [0, 'y + h * 0.2', 0] },
    ] },
  ],
};
