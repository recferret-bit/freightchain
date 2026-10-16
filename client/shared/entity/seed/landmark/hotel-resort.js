export default {
  id: 'hotel-resort', kind: 'landmark', v: 1, anchor: 'base', label: 'hotel · resort',
  note: 'wide three-storey resort: portico with columns, spruce, rooftop sign',
  parts: [
    { geo: 'box', tag: 'wall', mat: { facade: [14, 4] }, s: [9, 9, 26], at: [2.5, 0, 0] },
    { geo: 'box', tag: 'roof', mat: 'roof', s: [9.6, 0.4, 26.6], at: [2.5, 9, 0] },
    { geo: 'box', tag: 'portico', mat: 'trim', s: [3, 4.2, 8], at: [-2.4, 0, 0] },
    { geo: 'box', tag: 'window', mat: 'glass', s: [0.1, 2.6, 5], at: [-3.92, 0.3, 0] },
    { geo: 'box', tag: 'canopy', mat: 'accent', s: [5.5, 0.4, 9], at: [-4.4, 4.2, 0] },
    { for: 'z', in: [-4, -1.3, 1.3, 4], do: [
      { geo: 'cyl', tag: 'column', mat: 'trim', s: [0.3, 4.2, 0.3], at: [-6.4, 0, 'z'] },
    ] },
    { for: ['x', 'z', 'th'], in: [[-5, -10.5, 5], [-5, 10.5, 6], [-6.2, -7, 4]], do: [
      { ref: 'spruce', with: { h: 'th' }, slots: { trunk: 'trunk', leaf: 'leaf' }, at: ['x', 0, 'z'] },
    ] },
    { sign: { style: 'red', w: 8, h: 1.8 }, at: [2.5, 9.4, 0] },
  ],
};
