import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal mock of DOM for Node testing of el()
class MockNode {
  constructor(tag) {
    this.tagName = tag?.toUpperCase() ?? '';
    this.attributes = {};
    this.children = [];
    this.className = '';
  }
  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k]; }
  get dataset() {
    return new Proxy(this.attributes, {
      get: (target, prop) => target[`data-${prop.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}`],
    });
  }
  append(...kids) { this.children.push(...kids); }
  get textContent() {
    return this.children.map(c => (typeof c === 'string' ? c : c.textContent)).join('');
  }
  querySelector(sel) {
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      return this.children.find(c => c instanceof MockNode && c.className.split(' ').includes(cls)) ?? null;
    }
    return this.children.find(c => c instanceof MockNode && c.tagName.toLowerCase() === sel) ?? null;
  }
  querySelectorAll(sel) {
    const res = [];
    const walk = n => {
      if (n instanceof MockNode) {
        if (sel === '.tile' && n.className.split(' ').includes('tile')) res.push(n);
        for (const ch of n.children) walk(ch);
      }
    };
    walk(this);
    return res;
  }
}

globalThis.Node = MockNode;
globalThis.document = {
  createElement: tag => new MockNode(tag),
  createTextNode: txt => txt,
};

const { spent, careerTiles } = await import('../site/lobby-career.js');

test('spent formats duration in seconds, minutes, hours', () => {
  assert.equal(spent(0), '0 s');
  assert.equal(spent(42), '42 s');
  assert.equal(spent(90), '2 min');
  assert.equal(spent(3600), '1 h 00 min');
  assert.equal(spent(3725), '1 h 02 min');
});

test('careerTiles combines career and stats without duplicating paid rides', () => {
  const career = {
    rides: 5,
    ridesFree: 2,
    ridesPaid: 3,
    ridesCompleted: 4,
    seconds: 3660,
    metres: 50000,
    crashesVehicle: 1,
    crashesBuilding: 0,
    donations: 2,
    donationLamports: 100_000_000,
  };
  const stats = {
    rides: 5,
    completed: 4,
    metres: 50000,
    bestMetres: 25000,
    paidRides: 3,
    spentLamports: 500_000_000,
    ticketsBought: 6,
  };
  const fmt = {
    km: m => `${(m / 1000).toFixed(1)} km`,
    sol: l => `${(l / 1e9).toFixed(2)} SOL`,
  };

  const elements = careerTiles(career, stats, fmt);
  assert.equal(elements.length, 2);
  const [h2, container] = elements;
  assert.equal(h2.textContent, 'DRIVING RECORD');
  assert.equal(container.attributes.id, 'career');

  const tiles = container.querySelectorAll('.tile');
  const byKey = Object.fromEntries(tiles.map(t => [t.getAttribute('data-k'), t.querySelector('b')?.textContent]));

  // Verify all keys
  assert.equal(byKey.rides, '5');
  assert.equal(byKey['rides-free'], '2');
  assert.equal(byKey['rides-paid'], '3');
  assert.equal(byKey.completed, '4');
  assert.equal(byKey.time, '1 h 01 min');
  assert.equal(byKey.km, '50.0 km');
  assert.equal(byKey.best, '25.0 km');
  assert.equal(byKey['crashes-vehicle'], '1');
  assert.equal(byKey['crashes-building'], '0');
  assert.equal(byKey.donations, '2');
  assert.equal(byKey.donated, '0.10 SOL');
  assert.equal(byKey.spent, '0.50 SOL');
  assert.equal(byKey['tickets-bought'], '6');

  // Verify 'paid rides' appears only ONCE
  const paidRidesTiles = tiles.filter(t => t.textContent.includes('paid rides'));
  assert.equal(paidRidesTiles.length, 1);
});

test('careerTiles supports profile object or omitted stats', () => {
  const profile = {
    career: { rides: 1, ridesFree: 1, ridesPaid: 0, ridesCompleted: 0, seconds: 30, metres: 500, crashesVehicle: 0, crashesBuilding: 0, donations: 0, donationLamports: 0 },
    stats: { bestMetres: 500, spentLamports: 0 },
  };
  const fmt = { km: m => `${m}m`, sol: l => `${l} lamports` };

  const [h2, container] = careerTiles(profile, fmt);
  assert.equal(h2.textContent, 'DRIVING RECORD');
  const tiles = container.querySelectorAll('.tile');
  const keys = tiles.map(t => t.getAttribute('data-k'));
  assert.ok(keys.includes('rides'));
  assert.ok(keys.includes('best'));
  assert.ok(keys.includes('spent'));
  assert.ok(!keys.includes('tickets-bought')); // null ticketsBought is omitted
});
