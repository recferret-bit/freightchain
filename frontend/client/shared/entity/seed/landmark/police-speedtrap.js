export default {
  id: 'police-speedtrap', kind: 'landmark', v: 1, anchor: 'base', label: 'police · speedtrap',
  note: 'roadside radar speed trap: twin-column trussed billboard with catwalk, patrol cruiser tucked behind, 3-leg Doppler radar tripod & grounded cones',
  parts: [
    { for: 'pz', in: [-2.1, 2.1], do: [
      { geo: 'oct', tag: 'base', mat: 'dark', s: [0.62, 0.32, 0.62], at: [-0.5, 0, 'pz'] },
      { geo: 'rbox', tag: 'pole', mat: 'metal', s: [0.24, 2.8, 0.24], at: [-0.5, 0.24, 'pz'] },
    ] },
    { geo: 'rbox', tag: 'tie', mat: 'metal', s: [0.2, 0.16, 4.5], at: [-0.5, 1.55, 0] },
    { geo: 'box', tag: 'catwalk', mat: 'dark', s: [0.65, 0.1, 5.1], at: [-0.95, 2.52, 0] },
    { sign: { style: 'blue', w: 5, h: 1.8 }, at: [-0.5, 2.6, 0] },
    { ref: 'cruiser', at: [2.2, 0, 0], rot: [0, '-PI / 2', 0] },
    { geo: 'oct', tag: 'base', mat: 'dark', s: [0.65, 0.1, 0.65], at: [-2.8, 0, 3.5] },
    { for: ['lx', 'lz', 'rx', 'rz'], in: [[-0.14, 0, 0, -0.22], [0.1, 0.12, -0.19, 0.16], [0.1, -0.12, 0.19, 0.16]], do: [
      { geo: 'cyl16', tag: 'leg', mat: 'metal', s: [0.04, 1.28, 0.04], at: ['-2.8 + lx', 0.06, '3.5 + lz'], rot: ['rx', 0, 'rz'] },
    ] },
    { geo: 'rbox', tag: 'radar', mat: 'dark', s: [0.54, 0.28, 0.34], at: [-2.8, 1.28, 3.5] },
    { geo: 'cyl16', tag: 'horn', mat: 'metal', s: [0.11, 0.16, 0.11], at: [-3.1, 1.38, 3.5], rot: [0, 0, 'PI / 2'] },
    { use: 'lm-cones', with: { x: -3.2, z0: -3.6, n: 3, dz: 1.5 } },
  ],
};
