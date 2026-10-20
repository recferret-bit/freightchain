import test from 'node:test';
import assert from 'node:assert/strict';

// Mock minimal DOM for Node environment
class MockNode {
  constructor(tag) {
    this.tagName = tag?.toUpperCase() ?? '';
    this.attributes = {};
    this.children = [];
    this.className = '';
    this.disabled = false;
    this.checked = false;
    this.listeners = {};
  }
  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k]; }
  get id() { return this.attributes.id ?? ''; }
  addEventListener(event, fn) {
    (this.listeners[event] ||= []).push(fn);
  }
  dispatchEvent(event) {
    for (const fn of this.listeners[event.type] || []) fn(event);
  }
  append(...kids) { this.children.push(...kids); }
  get textContent() {
    return this.children.map(c => (typeof c === 'string' ? c : c.textContent)).join('');
  }
  set textContent(v) {
    this.children = [v];
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  querySelectorAll(sel) {
    const res = [];
    const walk = n => {
      if (n instanceof MockNode) {
        if (sel.startsWith('#') && n.attributes.id === sel.slice(1)) res.push(n);
        else if (sel.startsWith('.') && n.className.split(' ').includes(sel.slice(1))) res.push(n);
        else if (n.tagName.toLowerCase() === sel.toLowerCase()) res.push(n);
        for (const ch of n.children) walk(ch);
      }
    };
    walk(this);
    return res;
  }
}

globalThis.Node = MockNode;
globalThis.location = { hash: '', pathname: '/lobby.html', hostname: 'localhost', protocol: 'http:' };
globalThis.document = {
  createElement: tag => new MockNode(tag),
  createTextNode: txt => txt,
};

const { offerAccepted, blockPaid, agreementsCard } = await import('../site/lobby-agreements.js');

test('offerAccepted requires both age18 and loss to be truthy', () => {
  assert.equal(offerAccepted(null), false);
  assert.equal(offerAccepted({}), false);
  assert.equal(offerAccepted({ agreements: { age18: true, loss: false } }), false);
  assert.equal(offerAccepted({ agreements: { age18: false, loss: true } }), false);
  assert.equal(offerAccepted({ agreements: { age18: true, loss: true } }), true);
});

test('blockPaid redirects to #profile if agreements not accepted, passes when accepted', () => {
  globalThis.location.hash = '';
  assert.equal(blockPaid({ agreements: { age18: false, loss: false } }), true);
  assert.equal(globalThis.location.hash, '#profile');

  globalThis.location.hash = '';
  assert.equal(blockPaid({ agreements: { age18: true, loss: true } }), false);
  assert.equal(globalThis.location.hash, '');
});

test('agreementsCard returns null if already accepted (disappears)', () => {
  const me = { agreements: { age18: 100, loss: 200 } };
  assert.equal(agreementsCard(me), null);
});

test('agreementsCard paints card when not accepted, preserves other checkbox enabled on toggle (no flashing), and locks on both accepted', async () => {
  const me = { agreements: { age18: null, loss: null } };
  let putPayload = null;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('agreements')) {
      putPayload = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({ age18: putPayload.age18 ? 1000 : null, loss: putPayload.loss ? 2000 : null }),
      };
    }
    return {
      ok: true,
      json: async () => ({}),
    };
  };

  const card = agreementsCard(me);
  assert.ok(card);
  assert.equal(card.id, 'offer');

  const age = card.querySelector('#agree-age');
  const loss = card.querySelector('#agree-loss');
  const note = card.querySelector('#offer-note');

  assert.ok(age);
  assert.ok(loss);
  assert.equal(age.checked, false);
  assert.equal(loss.checked, false);
  assert.equal(age.disabled, false);
  assert.equal(loss.disabled, false);
  assert.ok(note.className.includes('bad'));

  // Toggle age18
  age.checked = true;
  age.dispatchEvent({ type: 'change' });
  // The other checkbox (loss) must NOT be disabled during saving (no flashing!)
  assert.equal(loss.disabled, false);
  assert.equal(age.disabled, false);

  // Wait a tick for fetch promise
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(putPayload, { age18: true, loss: false });
  assert.equal(loss.disabled, false);
  assert.equal(age.disabled, false);
  assert.ok(note.className.includes('bad'));

  // Toggle loss
  loss.checked = true;
  loss.dispatchEvent({ type: 'change' });
  assert.equal(age.disabled, false);

  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(putPayload, { age18: true, loss: true });
  // Once both accepted, both are locked (disabled)
  assert.equal(age.disabled, true);
  assert.equal(loss.disabled, true);
  assert.ok(note.className.includes('dim'));

  // Next time profile is loaded with this user, agreementsCard returns null
  assert.equal(agreementsCard(me), null);
});
