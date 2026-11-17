export default {
  id: 'veh-siren', kind: 'part', v: 1,
  note: 'roof-mounted emergency lightbar: twin mounting pylons, chrome speaker bridge, and alternating red/blue strobe pods',
  params: { w: { default: 1.9, min: 1.4, max: 2.8 }, y: { default: 1.75, min: 1, max: 4.5, note: 'centre of the lightbar' }, z: { default: 0, min: -9, max: 9 } },
  consts: { RED: 0xe02020, BLUE: 0x2a5cff, DARK: 0x22262c, CHROME: 0xdce2e8 },
  parts: [
    { for: 'x', in: [-1, 1], do: [
      { geo: 'box', tag: 'mount', mat: { color: 'DARK' }, s: [0.12, 0.14, 0.22], at: ['x * w * 0.22', 'y - 0.08', 'z'] },
    ] },
    { geo: 'rbox', tag: 'mount', mat: { color: 'CHROME' }, s: ['w * 0.62', 0.11, 0.24], at: [0, 'y', 'z'] },
    { group: { role: 'flash.0' }, do: [
      { geo: 'rbox', tag: 'beacon', mat: { color: 'RED', lamp: true }, s: ['w * 0.27', 0.15, 0.29], at: ['-w * 0.21', 'y + 0.01', 'z'] },
      { glow: { color: 'RED', size: 3.2, gain: 1 }, at: ['-w * 0.21', 'y + 0.1', 'z'] },
    ] },
    { group: { role: 'flash.1', visible: false }, do: [
      { geo: 'rbox', tag: 'beacon', mat: { color: 'BLUE', lamp: true }, s: ['w * 0.27', 0.15, 0.29], at: ['w * 0.21', 'y + 0.01', 'z'] },
      { glow: { color: 'BLUE', size: 3.2, gain: 1 }, at: ['w * 0.21', 'y + 0.1', 'z'] },
    ] },
  ],
};
