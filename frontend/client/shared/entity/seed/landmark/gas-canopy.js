export default {
  id: 'gas-canopy', kind: 'landmark', v: 1, anchor: 'base', label: 'gas · canopy',
  note: 'modern station: shop at the back, a wide canopy over two pump islands, price pylon',
  parts: [
    { geo: 'box', tag: 'wall', mat: 'wall', s: [6, 3.2, 10], at: [5, 0, 0] },
    { geo: 'box', tag: 'window', mat: 'glass', s: [0.1, 1.6, 7.5], at: [1.98, 0.8, 0] },
    { geo: 'box', tag: 'roof', mat: 'roof', s: [6.4, 0.3, 10.4], at: [5, 3.2, 0] },
    { geo: 'box', tag: 'canopy', mat: 'trim', s: [9, 0.3, 14], at: [-2, 5.1, 0] },
    { geo: 'box', tag: 'band', mat: 'accent', s: [9.1, 0.4, 14.1], at: [-2, 4.7, 0] },
    { for: 'z', in: [-5.5, 5.5], do: [
      { for: 'x', in: [-5, 1], do: [
        { geo: 'box', tag: 'post', mat: 'trim', s: [0.5, 5.1, 0.5], at: ['x', 0, 'z'] },
      ] },
    ] },
    { for: 'z', in: [-3, 3], do: [
      { geo: 'box', tag: 'island', mat: 'lot', s: [1.2, 0.25, 3.4], at: [-2, 0, 'z'] },
      { use: 'lm-pump', with: { x: -2, z: 'z - 0.9' } },
      { use: 'lm-pump', with: { x: -2, z: 'z + 0.9' } },
    ] },
    { geo: 'box', tag: 'pole', mat: 'metal', s: [0.35, 7, 0.35], at: [-7.4, 0, -9.6] },
    { sign: { style: 'red', w: 3.2, h: 2.6 }, at: [-7.4, 7, -9.6] },
  ],
};
