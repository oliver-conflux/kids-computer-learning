// typing-game/tests/progress.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { starsFor, displayAccuracy, forLesson, allProgress } from '../js/progress.js';

const round = (over) => ({
  type: 'round', t: '2026-08-01T15:00:00.000Z', build: 't1', session: 's_1',
  lesson: 'top-ei', items: 10, accuracy: 0.96, wpm: 12, bestStreak: 20,
  guidance: 3, ...over,
});

test('star thresholds sit exactly where the spec puts them', () => {
  assert.equal(starsFor(0.899), 1);
  assert.equal(starsFor(0.90), 2, '90% earns the second star');
  assert.equal(starsFor(0.949), 2);
  assert.equal(starsFor(0.95), 3, '95% earns the third');
  assert.equal(starsFor(1), 3);
  assert.equal(starsFor(0), 1, 'finishing at all earns one star');
});

// The displayed percentage and the stars must never contradict each other. A
// real round scored 70/74 = 0.9459: two stars, but rounding showed "95%", which
// is the exact number the third star requires. Flooring keeps them aligned.
test('the shown percentage never claims a threshold the stars withheld', () => {
  for (let n = 0; n <= 1000; n += 1) {
    const accuracy = n / 1000;
    const shown = displayAccuracy(accuracy);
    const stars = starsFor(accuracy);
    assert.equal(shown >= 95, stars === 3, `at ${accuracy}: showed ${shown}%, gave ${stars} stars`);
    assert.equal(shown >= 90, stars >= 2, `at ${accuracy}: showed ${shown}%, gave ${stars} stars`);
  }
});

test('displayAccuracy floors rather than rounds', () => {
  assert.equal(displayAccuracy(0.9459), 94, 'the case that started this');
  assert.equal(displayAccuracy(0.9499), 94);
  assert.equal(displayAccuracy(0.95), 95);
  assert.equal(displayAccuracy(1), 100);
  assert.equal(displayAccuracy(0), 0);
});

test('an empty event list is zero progress, not a crash', () => {
  const p = forLesson([], 'top-ei');
  assert.deepEqual(p, {
    stars: 0, bestAccuracy: 0, bestWpm: 0, attempts: 0, handsOff: false,
  });
});

test('one clean round yields three stars', () => {
  const p = forLesson([round()], 'top-ei');
  assert.equal(p.stars, 3);
  assert.equal(p.bestAccuracy, 96);
  assert.equal(p.bestWpm, 12);
  assert.equal(p.attempts, 1);
});

test('bests are the maximum across attempts, and attempts counts them all', () => {
  const events = [
    round({ accuracy: 0.80, wpm: 8 }),
    round({ accuracy: 0.96, wpm: 11 }),
    round({ accuracy: 0.91, wpm: 15 }),
  ];
  const p = forLesson(events, 'top-ei');
  assert.equal(p.attempts, 3);
  assert.equal(p.bestAccuracy, 96);
  assert.equal(p.bestWpm, 15, 'best wpm can come from a different round than best accuracy');
  assert.equal(p.stars, 3, 'stars reflect the best round, not the last');
});

test('the hands-off badge needs 3 stars AND guidance <= 1', () => {
  assert.equal(forLesson([round({ accuracy: 0.96, guidance: 3 })], 'top-ei').handsOff, false);
  assert.equal(forLesson([round({ accuracy: 0.96, guidance: 2 })], 'top-ei').handsOff, false);
  assert.equal(forLesson([round({ accuracy: 0.96, guidance: 1 })], 'top-ei').handsOff, true);
  assert.equal(forLesson([round({ accuracy: 0.96, guidance: 0 })], 'top-ei').handsOff, true);
  assert.equal(forLesson([round({ accuracy: 0.80, guidance: 0 })], 'top-ei').handsOff, false,
    '3 stars is required, not just low guidance');
});

test('the badge is sticky: earned once, it stays earned', () => {
  const events = [round({ accuracy: 0.96, guidance: 0 }), round({ accuracy: 0.5, guidance: 3 })];
  assert.equal(forLesson(events, 'top-ei').handsOff, true);
});

test('events for other lessons are ignored', () => {
  const events = [round({ lesson: 'top-ru', accuracy: 1, wpm: 99 }), round()];
  const p = forLesson(events, 'top-ei');
  assert.equal(p.attempts, 1);
  assert.equal(p.bestWpm, 12);
});

test('item events do not count as attempts', () => {
  const events = [{ type: 'item', lesson: 'top-ei', keystrokes: 5, errors: 0 }, round()];
  assert.equal(forLesson(events, 'top-ei').attempts, 1);
});

test('malformed events are skipped rather than fatal', () => {
  const events = [
    null,
    'not an object',
    { type: 'round' },                                   // no lesson
    { type: 'round', lesson: 'top-ei' },                 // no accuracy
    { type: 'round', lesson: 'top-ei', accuracy: 'high' }, // wrong type
    round(),
  ];
  const p = forLesson(events, 'top-ei');
  assert.equal(p.attempts, 1);
  assert.equal(p.bestAccuracy, 96);
});

test('a missing wpm defaults to 0 rather than producing NaN', () => {
  const events = [{ type: 'round', lesson: 'top-ei', accuracy: 0.96, guidance: 3 }];
  const p = forLesson(events, 'top-ei');
  assert.equal(p.bestWpm, 0);
  assert.ok(Number.isFinite(p.bestWpm));
});

test('allProgress keys every lesson that has events', () => {
  const events = [round(), round({ lesson: 'num-38', accuracy: 1, wpm: 20 })];
  const all = allProgress(events);
  assert.deepEqual(Object.keys(all).sort(), ['num-38', 'top-ei']);
  assert.equal(all['num-38'].stars, 3);
  assert.equal(all['top-ei'].bestAccuracy, 96);
});
