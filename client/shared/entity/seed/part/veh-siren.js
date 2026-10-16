export default {
  id: 'veh-siren', kind: 'part', v: 1,
  note: 'light bar: red left, blue right, flashed alternately by the traffic AI (the ride recording stores that a vehicle has one)',
  params: { w: { default: 1.9, min: 1.4, max: 2.8 }, y: { default: 1.75, min: 1, max: 4.5, note: 'centre of the 0.16 m bar' }, z: { default: 0, min: -9, max: 9 } },
  consts: { RED: 0xe02020, BLUE: 0x2a5cff },
  parts: [
    { group: { role: 'flash.0' }, do: [
      { geo: 'box', tag: 'beacon', mat: { color: 'RED', lamp: true }, s: ['w * 0.35', 0.16, 0.3], at: ['-w * 0.2', 'y', 'z'] },
      { glow: { color: 'RED', size: 3.2, gain: 1 }, at: ['-w * 0.2', 'y + 0.1', 'z'] },
    ] },
    { group: { role: 'flash.1', visible: false }, do: [
      { geo: 'box', tag: 'beacon', mat: { color: 'BLUE', lamp: true }, s: ['w * 0.35', 0.16, 0.3], at: ['w * 0.2', 'y', 'z'] },
      { glow: { color: 'BLUE', size: 3.2, gain: 1 }, at: ['w * 0.2', 'y + 0.1', 'z'] },
    ] },
  ],
};
