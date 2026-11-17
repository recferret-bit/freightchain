export default {
  id: 'spruce', kind: 'prop', v: 1, label: 'spruce',
  note: 'layered alpine/taiga conifer: flared root base, trunk, 5 alternating rotated bough tiers & optional snow caps',
  params: { h: { default: 8, min: 4, max: 12, note: 'tree height, m' } },
  slots: { trunk: { note: 'bark' }, leaf: { note: 'needles' }, snow: { note: 'snow caps', optional: true } },
  debris: 'leaf',
  parts: [
    { geo: 'cone', tag: 'root', mat: 'trunk', s: [0.42, 'h * 0.1', 0.42], at: [0, 'h * 0.05', 0] },
    { geo: 'cyl', tag: 'trunk', mat: 'trunk', s: [0.24, 'h * 0.32', 0.24], at: [0, 'h * 0.16', 0] },
    { for: 'i', range: [0, 5], let: { y: 'h * (0.18 + i * 0.155)', w: 'h * (0.3 - i * 0.046)' }, do: [
      { geo: 'cone', tag: 'canopy', mat: 'leaf', s: ['w', 'h * 0.28', 'w'], at: [0, 'y + h * 0.12', 0], rot: [0, 'i * 0.52', 0] },
      { ifSlot: 'snow', geo: 'cone', tag: 'snow', mat: 'snow', s: ['w * 0.64', 'h * 0.175', 'w * 0.64'], at: [0, 'y + h * 0.178', 0], rot: [0, 'i * 0.52', 0] },
    ] },
  ],
};
