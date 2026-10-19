export default {
  id: 'medic', kind: 'vehicle', v: 1, label: 'ambulance',
  params: { len: { from: 'def', default: 6.2 }, w: { from: 'def', default: 2.2 }, h: { from: 'def', default: 3 }, pick: { from: 'code', type: 'int', default: 0, min: 0, max: 99, note: 'variant (sedan paint)' }, hi: { from: 'code', type: 'bool', default: true, note: 'high beams (every third vehicle)' } },
  consts: { WHITE: 0xf0f0ea, RED: 0xe02020 },
  vars: { cargoH: 'h - 1.7', cargoY: '1.45 + cargoH / 2', crossH: 'min(0.72, cargoH - 0.28)', stripeY: 'cargoY - crossH / 2 - 0.16 - 0.125' },
  parts: [
    { use: 'veh-box-body', with: { len: 'len', w: 'w', h: 'h', color: 'WHITE', cargo: 'WHITE', hi: 'hi' } },
    { geo: 'box', tag: 'stripe', mat: { color: 'RED' }, s: ['w * 1.01', 0.25, 'len * 0.5'], at: [0, 'stripeY', 'len * 0.12'], note: '0.25 tall; top stays 16 cm under the cross. A centre of 1.6 put the top (1.725) on the cross bottom (1.74)' },
    { for: 's', in: [-1, 1], note: 'a red cross on each flank; the cargo roof is at h - .25, not at h', do: [
      { geo: 'box', tag: 'decal', mat: { color: 'RED' }, s: [0.15, 'crossH', 0.08], at: ['s * (w / 2 + 0.01)', 'cargoY', 'len * 0.12'] },
      { geo: 'box', tag: 'decal', mat: { color: 'RED' }, s: [0.15, 0.08, 'min(0.9, cargoH - 0.2)'], at: ['s * (w / 2 + 0.01)', 'cargoY', 'len * 0.12'] },
    ] },
    { use: 'veh-siren', with: { w: 'w', y: 'h - 0.15', z: '-len * 0.22' }, note: 'the light bar sits on the roof (bottom of the 0.16 bar = roof + 2 cm)' },
  ],
};
