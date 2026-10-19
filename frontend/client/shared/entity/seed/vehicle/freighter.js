export default {
  id: 'freighter', kind: 'vehicle', v: 1, label: 'freighter',
  note: "semi: cab + 13 m trailer in the game's livery colours",
  params: { len: { from: 'def', default: 17 }, w: { from: 'def', default: 2.5 }, h: { from: 'def', default: 4 }, pick: { from: 'code', type: 'int', default: 0, min: 0, max: 99, note: 'variant (sedan paint)' }, hi: { from: 'code', type: 'bool', default: true, note: 'high beams (every third vehicle)' } },
  consts: { GLASS: 0x1d2a36 },
  vars: { cabL: 2.8, deck: 1.05, boxH: 'h - 1.6', boxY: 'deck + boxH / 2', boxLen: 'len - cabL - 0.8', zc: 'cabL / 2 + 0.4' },
  parts: [
    { geo: 'box', tag: 'cabin', mat: { color: 0x20406a }, s: ['w', 1.5, 'cabL'], at: [0, 1.75, '-len / 2 + cabL / 2'] },
    { geo: 'box', tag: 'glass', mat: { color: 'GLASS' }, s: ['w * 0.9', 0.7, 0.06], at: [0, 2.2, '-len / 2 - 0.02'] },
    { geo: 'box', tag: 'chassis', mat: { color: 0x151515 }, s: ['w * 0.9', 0.5, 'len - 1'], at: [0, 0.8, 0.5], note: 'deck top is the chassis (centre .8, height .5)' },
    { geo: 'box', tag: 'cargo', mat: { color: 0xe3e1d9 }, s: ['w', 'boxH', 'boxLen'], at: [0, 'boxY', 'zc'] },
    { geo: 'box', tag: 'stripe', mat: { color: 0x1d3a5c }, s: ['w * 1.01', 0.35, 'boxLen + 0.04'], at: [0, 'deck + 0.3', 'zc'], note: '2 cm proud of each box end; a shared end plane flickers on the rear' },
    { use: 'veh-wheels', with: { w: 'w', zs: ['-len / 2 + 1.6', 'len / 2 - 1.2', 'len / 2 - 2.5'], r: 0.42, hub: 0x20406a } },
    { use: 'veh-lights', with: { w: 'w', len: 'len', y: 1.1, brakeY: 1.3, hi: 'hi' } },
  ],
};
