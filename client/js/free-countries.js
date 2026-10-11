/* The three free-ride buttons. Hardcoded on purpose: each level is one country, and the server stamps that same theme id
   (ride-trip.ts FREE_LEVELS.route, held together by server/test/unit/domain/ride-trip.spec.ts). A ready free ride re-chosen
   at another level moves to that level's country. Paid rides still take their route from the seed. */
export const FREE_COUNTRIES = {
  1: {
    route: 'stuart', country: 'Australia', title: 'Stuart Highway', place: 'Adelaide ⇄ Darwin', stripe: '#b4532a',
    desc: 'Road-train country. Four lanes, long winding bends and one crossroads. Red earth under a fierce sun — stay awake and fight the side-wind.',
  },
  2: {
    route: 'route66', country: 'USA', title: 'Route 66', place: 'Santa Monica ⇄ Chicago', stripe: '#c9a56e',
    desc: 'The Mother Road. Desert towns, four crossroads and a fork on a long, twisting haul. Saguaros, telephone poles, long bends.',
  },
  3: {
    route: 'brenner', country: 'Austria · Italy', title: 'Brenner Pass', place: 'Munich ⇄ Verona', stripe: '#5d9a42',
    desc: 'Europe\'s busiest Alpine freight crossing. Tight serpentines, six crossroads, two forks and a highway run, snow on the peaks.',
  },
};
