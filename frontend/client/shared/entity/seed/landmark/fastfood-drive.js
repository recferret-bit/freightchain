export default {
  id: 'fastfood-drive', kind: 'landmark', v: 1, anchor: 'base', label: 'restaurant · drive',
  note: 'fast-food box with a coloured band, drive-through canopy and a big pylon. The 9 m window is centred between the door and the right corner (z 6), so both piers match',
  vars: { doorZ: -5, doorW: 1.2, glassW: 9, wallR: 6, gap: '(wallR - (doorZ + doorW / 2) - glassW) / 2' },
  parts: [
    { geo: 'box', tag: 'wall', mat: 'wall', s: [9, 3.4, 12], at: [1.5, 0, 0] },
    { geo: 'box', tag: 'band', mat: 'accent', s: [9.4, 1, 12.4], at: [1.5, 3.4, 0] },
    { geo: 'box', tag: 'window', mat: 'glass', s: [0.1, 1.6, 'glassW'], at: [-3.02, 0.9, 'doorZ + doorW / 2 + gap + glassW / 2'] },
    { geo: 'box', tag: 'door', mat: 'door', s: [0.1, 2.1, 'doorW'], at: [-3.02, 0, 'doorZ'] },
    { geo: 'box', tag: 'canopy', mat: 'roof', s: [2.8, 0.25, 9], at: [-4.4, 3.2, 0] },
    { for: 'z', in: [-4, 4], do: [
      { geo: 'box', tag: 'post', mat: 'trim', s: [0.2, 3.2, 0.2], at: [-5.6, 0, 'z'] },
    ] },
    { geo: 'box', tag: 'pole', mat: 'metal', s: [0.35, 9, 0.35], at: [-5.2, 0, 6.4] },
    { sign: { style: 'red', w: 3.4, h: 3 }, at: [-5.2, 9, 6.4] },
  ],
};
