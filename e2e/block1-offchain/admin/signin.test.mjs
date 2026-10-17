import assert from 'node:assert/strict';
import { before, after, describe, test } from 'node:test';
import { openAdmin } from '../../harness/sessions/admin.mjs';

describe('block 1 admin sign-in', { concurrency: 1 }, () => {
  let page;
  before(async () => { page = await openAdmin({ signedIn: false }); });
  after(() => page?.close());

  test('B1-ADMIN-01 a 404 overview shows the sign-in gate', () => {
    assert.ok(page.document.getElementById('admin-signin'));
    assert.ok(page.document.getElementById('admin-dev'));
    assert.equal(page.document.querySelector('.tabs').hidden, true);
  });

  test('B1-ADMIN-02 REFRESH and SIGN OUT exist on the shell', () => {
    assert.equal(page.document.getElementById('refresh').textContent, 'REFRESH');
    assert.ok(page.document.getElementById('signout'));
  });
});
