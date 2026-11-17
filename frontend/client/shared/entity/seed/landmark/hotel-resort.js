export default {
  id: 'hotel-resort', kind: 'landmark', v: 1, anchor: 'base', label: 'hotel · resort',
  note: 'three-storey highway resort: facade wing with corner pavilions, gabled roof crown, classical columned porte-cochere, landscaped spruces & rooftop sign',
  parts: [
    { geo: 'box', tag: 'plinth', mat: 'dark', s: [9.4, 0.34, 26.4], at: [2.6, 0, 0] },
    { geo: 'box', tag: 'wall', mat: { facade: [14, 4] }, s: [8.8, 9, 25.8], at: [2.6, 0.3, 0] },
    { for: 'wz', in: [-12.6, 12.6], do: [
      { geo: 'rbox', tag: 'pilaster', mat: 'wall', s: [9.2, 9.2, 1.2], at: [2.6, 0.28, 'wz'] },
    ] },
    { geo: 'rbox', tag: 'roof', mat: 'roof', s: [9.8, 0.42, 26.8], at: [2.6, 9.24, 0] },
    { geo: 'gable', tag: 'crown', mat: 'roof', s: [9.6, 1.85, 9.6], at: [2.6, 9.55, 0], rot: [0, 'PI / 2', 0] },
    { geo: 'gable', tag: 'pediment', mat: 'trim', s: [8.6, 1.48, 9.72], at: [2.52, 9.57, 0], rot: [0, 'PI / 2', 0] },
    { geo: 'rbox', tag: 'hvac', mat: 'metal', s: [2.4, 0.85, 3.2], at: [3.2, 9.62, -8.5] },
    { geo: 'rbox', tag: 'portico', mat: 'trim', s: [3.2, 4.3, 8.2], at: [-2.3, 0, 0] },
    { geo: 'box', tag: 'window', mat: 'glass', s: [0.12, 2.6, 5.2], at: [-3.94, 0.32, 0] },
    { geo: 'box', tag: 'door', mat: 'door', s: [0.16, 2.35, 2], at: [-3.98, 0.3, 0] },
    { geo: 'rbox', tag: 'canopy', mat: 'accent', s: [5.2, 0.38, 9.2], at: [-4.5, 4.22, 0] },
    { geo: 'box', tag: 'band', mat: 'trim', s: [5.28, 0.12, 9.28], at: [-4.5, 4.56, 0] },
    { for: 'z', in: [-4, -1.3, 1.3, 4], do: [
      { geo: 'oct', tag: 'base', mat: 'dark', s: [0.62, 0.32, 0.62], at: [-6.5, 0, 'z'] },
      { geo: 'cyl16', tag: 'column', mat: 'trim', s: [0.24, 4.05, 0.24], at: [-6.5, 0.26, 'z'] },
    ] },
    { for: ['x', 'z', 'th'], in: [[-5, -10.5, 5], [-5, 10.5, 6], [-6.2, -7, 4]], do: [
      { geo: 'oct', tag: 'planter', mat: 'trim', s: [2.1, 0.28, 2.1], at: ['x', 0, 'z'] },
      { geo: 'oct', tag: 'soil', mat: 'trunk', s: [1.8, 0.08, 1.8], at: ['x', 0.24, 'z'] },
      { ref: 'spruce', with: { h: 'th' }, slots: { trunk: 'trunk', leaf: 'leaf' }, at: ['x', 0.24, 'z'] },
    ] },
    { for: 'sz', in: [-3, 3], do: [
      { geo: 'rbox', tag: 'post', mat: 'dark', s: [1.3, 1.45, 0.32], at: [2.6, 9.85, 'sz'] },
    ] },
    { geo: 'rbox', tag: 'mount', mat: 'dark', s: [1.4, 0.2, 6.8], at: [2.6, 11.06, 0] },
    { sign: { style: 'red', w: 8, h: 1.8 }, at: [2.6, 11.2, 0] },
  ],
};
