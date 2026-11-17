export default {
  id: 'tuft', kind: 'prop', v: 1, label: 'grass tuft',
  note: 'spinifex / paja brava tussock: dense basal root crown & six radiating outward-leaning grass blades',
  params: { s: { default: 1.2, min: 0.8, max: 1.7, note: 'size, m' } },
  slots: { m: { note: 'dry grass' } },
  debris: 'm',
  parts: [
    { geo: 'rock', tag: 'base', mat: 'm', s: ['s * 0.42', 's * 0.24', 's * 0.42'], at: [0, 's * 0.22', 0] },
    { for: ['x', 'z', 'rx', 'rz'], in: [[0, 0, 0.05, 0], [0.28, 0.08, 0.1, -0.34], [-0.26, 0.1, 0.12, 0.32], [0.12, -0.26, -0.32, -0.1], [-0.14, -0.22, -0.28, 0.16], [0.02, 0.28, 0.34, 0.04]], do: [
      { geo: 'cone', tag: 'blade', mat: 'm', s: ['s * 0.24', 's * 1.12', 's * 0.24'], at: ['x * s', 's * 0.56', 'z * s'], rot: ['rx', 0, 'rz'] },
    ] },
  ],
};
