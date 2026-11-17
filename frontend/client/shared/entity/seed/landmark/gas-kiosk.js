export default {
  id: 'gas-kiosk', kind: 'landmark', v: 1, anchor: 'base', label: 'gas · kiosk',
  note: 'vintage Route-66 gas kiosk: brick-wainscot booth with hip roof, stepped canopy columns, curbed island with visible-cylinder globe pumps & round GAS lollipop sign',
  vars: { r: 1.5, y: 6.4 },
  parts: [
    { geo: 'box', tag: 'plinth', mat: 'dark', s: [4.2, 0.65, 5.2], at: [3.5, 0, 0] },
    { geo: 'rbox', tag: 'wall', mat: 'wall', s: [4, 2.5, 5], at: [3.5, 0.58, 0] },
    { geo: 'pyr', tag: 'roof', mat: 'roof', s: [5.3, 1.6, 6.3], at: [3.5, 3.02, 0] },
    { geo: 'box', tag: 'window', mat: 'glass', s: [0.12, 1.22, 2.8], at: [1.46, 1.05, -0.75] },
    { geo: 'box', tag: 'sill', mat: 'trim', s: [0.18, 0.09, 2.95], at: [1.42, 0.96, -0.75] },
    { geo: 'box', tag: 'door', mat: 'door', s: [0.14, 2.05, 1.02], at: [1.38, 0.2, 1.55] },
    { geo: 'rbox', tag: 'canopy', mat: 'trim', s: [5.1, 0.26, 7.2], at: [-0.7, 3.6, 0] },
    { geo: 'box', tag: 'band', mat: 'accent', s: [5.18, 0.14, 7.28], at: [-0.7, 3.82, 0] },
    { for: 'z', in: [-3.1, 3.1], do: [
      { geo: 'oct', tag: 'base', mat: 'dark', s: [0.56, 0.42, 0.56], at: [-2.85, 0, 'z'] },
      { geo: 'rbox', tag: 'post', mat: 'trim', s: [0.28, 3.3, 0.28], at: [-2.85, 0.34, 'z'] },
    ] },
    { geo: 'rbox', tag: 'island', mat: 'lot', s: [1.3, 0.22, 4.8], at: [-0.8, 0, 0] },
    { for: 'z', in: [-1.55, 1.55], do: [
      { geo: 'rbox', tag: 'pump', mat: 'accent', s: [0.56, 1.18, 0.56], at: [-0.8, 0.2, 'z'] },
      { geo: 'cyl16', tag: 'sight', mat: 'glass', s: [0.2, 0.42, 0.2], at: [-0.8, 1.34, 'z'] },
      { geo: 'cyl16', tag: 'globe', mat: 'white', s: [0.34, 0.42, 0.34], at: [-0.8, 1.72, 'z'] },
      { geo: 'cyl16', tag: 'hose', mat: 'dark', s: [0.035, 0.72, 0.035], at: [-0.8, 0.45, 'z + 0.31'] },
    ] },
    { geo: 'oct', tag: 'base', mat: 'dark', s: [0.68, 0.36, 0.68], at: [-4.6, 0, 4.9] },
    { geo: 'cyl16', tag: 'pole', mat: 'metal', s: [0.14, 'y - r - 0.16', 0.14], at: [-4.6, 0.2, 4.9] },
    { disk: { style: 'red', r: 'r', text: 'GAS' }, at: [-4.6, 'y', 4.9] },
  ],
};
