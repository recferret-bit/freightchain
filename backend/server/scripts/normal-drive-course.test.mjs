import test from 'node:test';
import assert from 'node:assert/strict';
import { normalFreeCourse, assertNormalFreeCourse } from './normal-drive-course.mjs';

test('normal free selection defaults to MEDIUM and refuses unsupported or empty values', () => {
  assert.equal(normalFreeCourse().name, 'MEDIUM');
  for (const value of ['', 'hard', '4', 'constructor', '__proto__']) assert.throws(() => normalFreeCourse(value), /NORMAL_DRIVE_LEVEL/);
});

test('every selected normal course rejects accelerated, shortened, or mismatched server responses', () => {
  for (const name of ['EASY', 'MEDIUM', 'HARD']) {
    const course = normalFreeCourse(name);
    const ride = { tier: 'free', level: course.level, trip: course.trip, minSeconds: course.minSeconds, timeScale: 1, completeDist: 28 * course.k * course.minSeconds };
    assert.doesNotThrow(() => assertNormalFreeCourse(ride, course));
    for (const change of [{ tier: '1h' }, { level: 4 }, { trip: 'free-3b' }, { minSeconds: 6 }, { timeScale: 2 }, { completeDist: 1 }]) assert.throws(() => assertNormalFreeCourse({ ...ride, ...change }, course), /expected normal/);
  }
});
