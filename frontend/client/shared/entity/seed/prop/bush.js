export default {
  id: 'bush', kind: 'prop', v: 1, label: 'bush',
  note: 'multi-lobe roadside scrub bush: central mound flanked by clustered organic foliage lobes',
  params: { s: { default: 1, min: 0.5, max: 1.5, note: 'size, m' } },
  slots: { m: { note: 'foliage' } },
  debris: 'm',
  parts: [
    { geo: 'cone', tag: 'canopy', mat: 'm', s: ['s', 's * 0.9', 's'], at: [0, 's * 0.45', 0] },
    { geo: 'rock', tag: 'canopy', mat: 'm', s: ['s * 0.62', 's * 0.48', 's * 0.62'], at: ['s * 0.38', 's * 0.46', 's * 0.18'] },
    { geo: 'rock', tag: 'canopy', mat: 'm', s: ['s * 0.58', 's * 0.44', 's * 0.56'], at: ['-s * 0.36', 's * 0.42', '-s * 0.14'] },
    { geo: 'rock', tag: 'canopy', mat: 'm', s: ['s * 0.52', 's * 0.42', 's * 0.54'], at: [0.06, 's * 0.62', '-s * 0.28'] },
  ],
};
