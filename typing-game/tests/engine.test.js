// typing-game/tests/engine.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { start, press, backspace, stats, isComplete, nextChar } from '../js/engine.js';

const T0 = 1785290000000;

/** Type a whole string cleanly, one key per 100ms. */
function typeAll(state, text, startAt = T0) {
  let s = state;
  [...text].forEach((ch, i) => {
    s = press(s, { key: ch, shiftSide: shiftFor(ch), at: startAt + (i + 1) * 100 });
  });
  return s;
}

function shiftFor(ch) {
  if (ch >= 'A' && ch <= 'Z') return 'ShiftLeft';
  return null;
}

test('start produces an empty state with no clock running', () => {
  const s = start('cat', { blockOnError: true });
  assert.equal(s.text, 'cat');
  assert.deepEqual(s.entries, []);
  assert.equal(s.wrong, null);
  assert.equal(s.keystrokes, 0);
  assert.equal(s.errors, 0);
  assert.equal(s.startedAt, null);
  assert.equal(s.finishedAt, null);
});

test('nextChar reports the character the kid must type next', () => {
  let s = start('cat', { blockOnError: true });
  assert.equal(nextChar(s), 'c');
  s = press(s, { key: 'c', at: T0 });
  assert.equal(nextChar(s), 'a');
});

test('the FIRST keystroke starts the clock, not start()', () => {
  let s = start('cat', { blockOnError: true });
  assert.equal(s.startedAt, null);
  s = press(s, { key: 'c', at: T0 + 5000 });
  assert.equal(s.startedAt, T0 + 5000);
  s = press(s, { key: 'a', at: T0 + 5100 });
  assert.equal(s.startedAt, T0 + 5000, 'later presses must not move the start');
});

test('a correct press appends an entry and advances', () => {
  let s = start('cat', { blockOnError: true });
  s = press(s, { key: 'c', at: T0 });
  assert.deepEqual(s.entries, [{ expected: 'c', actual: 'c', ok: true }]);
  assert.equal(s.keystrokes, 1);
  assert.equal(s.errors, 0);
  assert.equal(s.streak, 1);
});

// --- block mode -----------------------------------------------------------

test('block mode: a wrong press freezes the caret and sets the sticky char', () => {
  let s = start('cat', { blockOnError: true });
  s = press(s, { key: 'x', at: T0 });
  assert.equal(s.wrong, 'x');
  assert.deepEqual(s.entries, [], 'caret must not advance');
  assert.equal(nextChar(s), 'c', 'still waiting for c');
  assert.equal(s.errors, 1);
  assert.equal(s.keystrokes, 1);
  assert.equal(s.streak, 0);
});

test('block mode: a second wrong press REPLACES rather than stacks', () => {
  let s = start('cat', { blockOnError: true });
  s = press(s, { key: 'x', at: T0 });
  s = press(s, { key: 'y', at: T0 + 100 });
  assert.equal(s.wrong, 'y');
  assert.deepEqual(s.entries, []);
  assert.equal(s.errors, 2, 'both wrong presses count');
});

test('block mode: backspace clears the sticky wrong character', () => {
  let s = start('cat', { blockOnError: true });
  s = press(s, { key: 'x', at: T0 });
  s = backspace(s);
  assert.equal(s.wrong, null);
  assert.deepEqual(s.entries, []);
});

test('block mode: the correct key after a wrong one clears it and advances', () => {
  let s = start('cat', { blockOnError: true });
  s = press(s, { key: 'x', at: T0 });
  s = press(s, { key: 'c', at: T0 + 100 });
  assert.equal(s.wrong, null);
  assert.equal(s.entries.length, 1);
  assert.equal(nextChar(s), 'a');
});

// --- pass-through mode ----------------------------------------------------

test('pass-through: a wrong press advances the caret', () => {
  let s = start('cat', { blockOnError: false });
  s = press(s, { key: 'x', at: T0 });
  assert.equal(s.wrong, null, 'no sticky char in pass-through');
  assert.deepEqual(s.entries, [{ expected: 'c', actual: 'x', ok: false }]);
  assert.equal(nextChar(s), 'a', 'caret moved on');
  assert.equal(s.errors, 1);
});

test('pass-through: backspace steps back over the last entry', () => {
  let s = start('cat', { blockOnError: false });
  s = press(s, { key: 'x', at: T0 });
  s = backspace(s);
  assert.deepEqual(s.entries, []);
  assert.equal(nextChar(s), 'c');
});

test('backspace at the very start is a no-op in both modes', () => {
  for (const blockOnError of [true, false]) {
    const s = start('cat', { blockOnError });
    assert.deepEqual(backspace(s), s);
  }
});

// --- shift ----------------------------------------------------------------

test('a capital typed with the correct opposite shift is clean', () => {
  let s = start('Cat', { blockOnError: true });
  s = press(s, { key: 'C', shiftSide: 'ShiftRight', at: T0 });
  assert.equal(s.errors, 0);
  assert.equal(s.entries[0].ok, true);
  assert.equal(s.wrongShiftSide, false);
});

test('WRONG-side shift is accepted and records NO error', () => {
  let s = start('Cat', { blockOnError: true });
  // C is left middle, so it wants ShiftRight. Use the wrong one.
  s = press(s, { key: 'C', shiftSide: 'ShiftLeft', at: T0 });
  assert.equal(s.errors, 0, 'must not be penalised');
  assert.equal(s.entries[0].ok, true, 'character counts as correct');
  assert.equal(s.wrongShiftSide, true, 'but the UI is told, so it can coach');
});

test('wrongShiftSide resets on the next correctly-shifted character', () => {
  let s = start('CAt', { blockOnError: true });
  s = press(s, { key: 'C', shiftSide: 'ShiftLeft', at: T0 });
  assert.equal(s.wrongShiftSide, true);
  s = press(s, { key: 'A', shiftSide: 'ShiftRight', at: T0 + 100 });
  assert.equal(s.wrongShiftSide, false);
});

// --- streaks and completion ----------------------------------------------

test('bestStreak survives a break in the streak', () => {
  let s = start('abcdef', { blockOnError: false });
  s = typeAll(s, 'abc');
  assert.equal(s.bestStreak, 3);
  s = press(s, { key: 'z', at: T0 + 400 });
  assert.equal(s.streak, 0);
  assert.equal(s.bestStreak, 3, 'best is remembered');
  s = press(s, { key: 'e', at: T0 + 500 });
  assert.equal(s.streak, 1);
  assert.equal(s.bestStreak, 3);
});

test('isComplete and finishedAt land on the last character', () => {
  let s = start('cat', { blockOnError: true });
  assert.equal(isComplete(s), false);
  s = typeAll(s, 'cat');
  assert.equal(isComplete(s), true);
  assert.equal(s.finishedAt, T0 + 300);
});

test('presses after completion are ignored', () => {
  let s = start('cat', { blockOnError: true });
  s = typeAll(s, 'cat');
  const after = press(s, { key: 'x', at: T0 + 9999 });
  assert.deepEqual(after, s);
});

// --- stats ----------------------------------------------------------------

test('accuracy is (keystrokes - errors) / keystrokes', () => {
  let s = start('cat', { blockOnError: false });
  s = press(s, { key: 'x', at: T0 });        // wrong
  s = press(s, { key: 'a', at: T0 + 100 });  // right
  s = press(s, { key: 't', at: T0 + 200 });  // right
  assert.equal(stats(s).accuracy, 2 / 3);
});

test('stats on a zero-keystroke state returns 100% and 0 wpm, never NaN', () => {
  const s = start('cat', { blockOnError: true });
  const r = stats(s);
  assert.equal(r.accuracy, 1);
  assert.equal(r.wpm, 0);
  assert.equal(r.bestStreak, 0);
});

test('stats with zero elapsed time returns 0 wpm rather than Infinity', () => {
  let s = start('cat', { blockOnError: true });
  s = press(s, { key: 'c', at: T0 });
  s = press(s, { key: 'a', at: T0 });
  s = press(s, { key: 't', at: T0 });
  assert.equal(stats(s).wpm, 0);
  assert.ok(Number.isFinite(stats(s).wpm));
});

test('wpm is (correctChars / 5) / minutes and ignores pre-first-keystroke time', () => {
  let s = start('abcdefghij', { blockOnError: true });
  // 10 correct chars. First press at T0 + 60000 (a long read), last 60s later.
  [...'abcdefghij'].forEach((ch, i) => {
    s = press(s, { key: ch, at: T0 + 60000 + i * 6000 });
  });
  // elapsed = 54000ms = 0.9 min; 10 chars / 5 = 2 words; 2 / 0.9 = 2.22
  assert.equal(Math.round(stats(s).wpm * 100) / 100, 2.22);
});
