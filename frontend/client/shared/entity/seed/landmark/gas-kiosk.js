export default {
  id: 'gas-kiosk', kind: 'landmark', v: 1, anchor: 'base', label: 'gas · kiosk',
  note: 'old-school kiosk with a hip roof, two globe-top pumps and a round sign on a pole. The stem stops at y - r so it meets the rim and does not cross the face',
  vars: { r: 1.5, y: 6.4 },
  parts: [
    { geo: 'box', tag: 'wall', mat: 'wall', s: [4, 3, 5], at: [3.5, 0, 0] },
    { geo: 'pyr', tag: 'roof', mat: 'roof', s: [5.2, 1.6, 6.2], at: [3.5, 3, 0] },
    { geo: 'box', tag: 'window', mat: 'glass', s: [0.1, 1.2, 3], at: [1.48, 1, -0.7], note: 'front wall is z -2.5…2.5, door is z 1.1…2.1: centre -0.7 leaves 0.3 m each side' },
    { geo: 'box', tag: 'door', mat: 'door', s: [0.1, 2, 1], at: [1.48, 0, 1.6] },
    { geo: 'box', tag: 'canopy', mat: 'trim', s: [5, 0.25, 7], at: [-0.8, 3.6, 0] },
    { for: 'z', in: [-3.2, 3.2], do: [
      { geo: 'box', tag: 'post', mat: 'trim', s: [0.3, 3.6, 0.3], at: [-3, 0, 'z'] },
    ] },
    { for: 'z', in: [-1.6, 1.6], do: [
      { geo: 'box', tag: 'pump', mat: 'accent', s: [0.6, 1.4, 0.6], at: [-0.8, 0, 'z'] },
      { geo: 'cyl', tag: 'globe', mat: 'white', s: [0.38, 0.5, 0.38], at: [-0.8, 1.4, 'z'] },
    ] },
    { geo: 'box', tag: 'pole', mat: 'metal', s: [0.25, 'y - r', 0.25], at: [-4.8, 0, 5] },
    { disk: { style: 'red', r: 'r', text: 'GAS' }, at: [-4.8, 'y', 5] },
  ],
};
