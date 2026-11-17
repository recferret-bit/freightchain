export default {
  id: 'lm-pump', kind: 'part', v: 1, anchor: 'base',
  note: 'highway fuel dispenser mounted on an island: base plinth, cabinet, side columns, canopy valence, digital meter screen & hose loop',
  params: { x: { default: 0 }, z: { default: 0 }, h: { default: 1.5, min: 1, max: 2.2 } },
  slots: { accent: {}, dark: {}, metal: { optional: true, default: 'dark' }, white: { optional: true, default: 'accent' } },
  parts: [
    { geo: 'rbox', tag: 'base', mat: 'dark', s: [0.76, 0.12, 0.62], at: ['x', 0.2, 'z'] },
    { geo: 'rbox', tag: 'pump', mat: 'white', s: [0.68, 'h * 0.56', 0.52], at: ['x', 0.3, 'z'] },
    { for: 'dz', in: [-0.23, 0.23], do: [
      { geo: 'box', tag: 'post', mat: 'metal', s: [0.14, 'h * 0.92', 0.08], at: ['x', 0.3, 'z + dz'] },
    ] },
    { geo: 'rbox', tag: 'valence', mat: 'accent', s: [0.76, 0.24, 0.64], at: ['x', '0.24 + h * 0.88', 'z'] },
    { geo: 'rbox', tag: 'display', mat: 'dark', s: [0.72, 0.36, 0.38], at: ['x', '0.28 + h * 0.54', 'z'] },
    { geo: 'box', tag: 'screen', mat: 'white', s: [0.75, 0.16, 0.28], at: ['x', '0.38 + h * 0.56', 'z'] },
    { geo: 'box', tag: 'nozzle', mat: 'dark', s: [0.16, 0.24, 0.12], at: ['x', '0.32 + h * 0.36', 'z + 0.3'] },
    { geo: 'cyl16', tag: 'hose', mat: 'dark', s: [0.035, 'h * 0.52', 0.035], at: ['x', 0.32, 'z + 0.33'] },
  ],
};
