export default {
  id: 'lm-pump', kind: 'part', v: 1, anchor: 'base',
  note: 'fuel pump: body + display head. Uses the landmark slots',
  params: { x: { default: 0 }, z: { default: 0 }, h: { default: 1.5, min: 1, max: 2.2 } },
  slots: { accent: {}, dark: {} },
  parts: [
    { geo: 'box', tag: 'pump', mat: 'accent', s: [0.7, 'h', 0.5], at: ['x', 0.2, 'z'] },
    { geo: 'box', tag: 'display', mat: 'dark', s: [0.72, 0.45, 0.52], at: ['x', '0.2 + h * 0.6', 'z'] },
  ],
};
