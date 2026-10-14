export default {
  id: 'cruiser', kind: 'part', v: 1, anchor: 'base',
  note: 'police-style cruiser parked at a landmark (white body, blue flank, light bar). Uses the landmark slots',
  params: { lights: { type: 'bool', default: true, note: 'light bar on the roof' } },
  slots: { white: {}, glass: {}, blue: {}, red: {}, dark: {}, metal: {} },
  vars: { r: 0.38, tw: 0.24 },
  parts: [
    { geo: 'box', tag: 'body', mat: 'white', s: [1.9, 0.8, 4.4], at: [0, 0.35, 0] },
    { geo: 'box', tag: 'glass', mat: 'glass', s: [1.6, 0.6, 2.2], at: [0, 1.15, -0.1] },
    { geo: 'box', tag: 'stripe', mat: 'blue', s: [1.95, 0.3, 3.2], at: [0, 0.55, 0] },
    { when: 'lights', geo: 'box', tag: 'beacon', mat: 'red', s: [0.35, 0.18, 0.5], at: [-0.45, 1.75, -0.1] },
    { when: 'lights', geo: 'box', tag: 'beacon', mat: 'blue', s: [0.35, 0.18, 0.5], at: [0.45, 1.75, -0.1] },
    { for: 'sx', in: [-0.95, 0.95], let: { side: 'sign(sx)' }, note: 'tyre, rim disk and hub; the outer cap of the +x wheel is the -y end of the laid-down cylinder', do: [
      { for: 'sz', in: [-1.4, 1.4], do: [
        { geo: 'wheel48', anchor: 'center', tag: 'tyre', mat: 'dark', s: ['r', 'tw', 'r'], at: ['sx + side * 0', 'r', 'sz'], rot: [0, 0, 'PI / 2'] },
        { geo: 'wheel48', anchor: 'center', tag: 'rim', mat: 'metal', s: ['r * 0.64', 0.06, 'r * 0.64'], at: ['sx + side * (tw / 2 + 0.01)', 'r', 'sz'], rot: [0, 0, 'PI / 2'], note: '2 cm into the sidewall; a shared face flickers' },
        { geo: 'wheel48', anchor: 'center', tag: 'hub', mat: 'white', s: ['r * 0.26', 0.04, 'r * 0.26'], at: ['sx + side * (tw / 2 + 0.05)', 'r', 'sz'], rot: [0, 0, 'PI / 2'] },
      ] },
    ] },
  ],
};
