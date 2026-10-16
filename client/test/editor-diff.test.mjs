import test from 'node:test';
import assert from 'node:assert/strict';
import { diffLines } from '../js/editor/diff.js';

test('source diffs keep additions and removals in order', () => {
  assert.deepEqual(diffLines('a\nb\nc', 'a\nx\nc'), [{ op: ' ', line: 'a' }, { op: '-', line: 'b' }, { op: '+', line: 'x' }, { op: ' ', line: 'c' }]);
});

test('newline-heavy sources use bounded memory and keep the changed middle', () => {
  const prefix = '\n'.repeat(30000), suffix = '\n'.repeat(1000);
  assert.deepEqual(diffLines(prefix + 'before' + suffix, prefix + 'after' + suffix), [{ op: '-', line: 'before' }, { op: '+', line: 'after' }]);
});
