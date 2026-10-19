export default {
  id: 'gas-truckstop', kind: 'landmark', v: 1, anchor: 'base', label: 'gas · truckstop',
  note: 'long truck-stop canopy, four diesel pumps, a big shop and a tall pylon',
  parts: [
    { geo: 'box', tag: 'wall', mat: 'wall', s: [8, 4, 22], at: [5, 0, 0] },
    { geo: 'box', tag: 'window', mat: 'glass', s: [0.1, 2, 17], at: [1.02, 0.9, 0] },
    { geo: 'box', tag: 'roof', mat: 'roof', s: [8.4, 0.3, 22.4], at: [5, 4, 0] },
    { geo: 'box', tag: 'band', mat: 'accent', s: [0.1, 0.6, 22], at: [0.98, 3.2, 0] },
    { geo: 'box', tag: 'canopy', mat: 'trim', s: [10, 0.3, 24], at: [-3.5, 5.9, 0] },
    { geo: 'box', tag: 'band', mat: 'accent2', s: [10.1, 0.5, 24.1], at: [-3.5, 5.5, 0] },
    { for: 'z', in: [-10, 0, 10], do: [
      { for: 'x', in: [-7.8, -0.7], do: [
        { geo: 'box', tag: 'post', mat: 'trim', s: [0.5, 5.9, 0.5], at: ['x', 0, 'z'] },
      ] },
    ] },
    { geo: 'box', tag: 'island', mat: 'lot', s: [1.4, 0.25, 18], at: [-4.5, 0, 0] },
    { for: 'z', in: [-6, -2, 2, 6], do: [
      { use: 'lm-pump', with: { x: -4.5, z: 'z', h: 1.7 } },
    ] },
    { geo: 'box', tag: 'pole', mat: 'metal', s: [0.45, 11, 0.45], at: [-8.6, 0, -13] },
    { sign: { style: 'blue', w: 4, h: 3 }, at: [-8.6, 11, -13] },
  ],
};
