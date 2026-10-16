export default {
  id: 'gantry', kind: 'gantry', v: 1, label: 'finish gantry',
  note: "two steel posts + a banner with the route's terminal name; origin = centre of the road at ground level",
  parts: [
    { geo: 'box', tag: 'pole', mat: { global: 'steel' }, s: [0.5, 7, 0.5], at: [-7.2, 3.5, 0] },
    { geo: 'box', tag: 'pole', mat: { global: 'steel' }, s: [0.5, 7, 0.5], at: [7.2, 3.5, 0] },
    { banner: { w: 14.4, h: 2.7 }, at: [0, 6.2, 0] },
  ],
};
