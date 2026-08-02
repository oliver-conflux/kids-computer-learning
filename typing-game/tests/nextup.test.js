// typing-game/tests/nextup.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { candidates, pickNext } from '../js/nextup.js';
import { lessonsForTrack } from '../js/curriculum.js';

const LETTERS = lessonsForTrack('letters').map((l) => l.id);

/** A round event with the accuracy that earns `stars` (see progress.starsFor). */
function round(lesson, stars) {
  const accuracy = stars === 3 ? 0.98 : stars === 2 ? 0.92 : 0.5;
  return { type: 'round', lesson, accuracy, wpm: 10, guidance: 3 };
}

test('a fresh log offers the first three rungs, in ladder order', () => {
  assert.deepEqual(candidates([], 'letters'),
    ['home-left', 'home-right', 'home-base']);
});

test('the lesson just played is never offered again immediately', () => {
  const events = [round('home-left', 2)];
  const pool = candidates(events, 'letters');
  assert.ok(!pool.includes('home-left'), 'the round that just ended must not repeat');
  assert.equal(pool.length, 3, 'the pool tops up rather than shrinking');
});

// The point of dropping the last-played lesson rather than demoting it: a kid
// stuck on something gets it back on the very next turn.
test('a stuck lesson returns as soon as it is not the last played', () => {
  const events = [round('home-left', 2), round('home-right', 3)];
  assert.equal(candidates(events, 'letters')[0], 'home-left');
});

test('two stuck lessons alternate rather than one starving the other', () => {
  let events = [round('home-left', 1), round('home-right', 1)];
  const seen = [];
  for (let i = 0; i < 4; i += 1) {
    const id = candidates(events, 'letters')[0];
    seen.push(id);
    events = [...events, round(id, 1)];
  }
  assert.deepEqual(seen, ['home-left', 'home-right', 'home-left', 'home-right']);
});

test('the weakest lesson leads the pool', () => {
  const events = [round('home-base', 1), round('home-left', 2), round('home-right', 3)];
  assert.deepEqual(candidates(events, 'letters').slice(0, 2), ['home-base', 'home-left']);
});

test('lessons tied on stars keep ladder order', () => {
  const events = [round('home-words', 2), round('home-right', 2), round('home-base', 3)];
  assert.deepEqual(candidates(events, 'letters').slice(0, 2), ['home-right', 'home-words']);
});

// The whole reason unplayed lessons are tier 2: one lesson owed must not become
// the only thing a kid ever sees.
test('one stuck lesson still advances — two new ones come with it', () => {
  const events = [round('home-left', 2), round('home-right', 3)];
  assert.deepEqual(candidates(events, 'letters'),
    ['home-left', 'home-base', 'home-words']);
});

test('three stuck lessons crowd out the new ones', () => {
  const events = [
    round('home-left', 1), round('home-right', 1),
    round('home-base', 2), round('home-words', 3),
  ];
  const pool = candidates(events, 'letters');
  assert.deepEqual(pool, ['home-left', 'home-right', 'home-base']);
  assert.ok(!pool.includes('home-stretch'), 'no new rung while three are owed');
});

test('a finished track still offers something — the button never dies', () => {
  const events = LETTERS.map((id) => round(id, 3));
  const pool = candidates(events, 'letters');
  assert.equal(pool.length, 3);
  assert.deepEqual(pool, ['home-left', 'home-right', 'home-base']);
});

test('the tracks are independent: letter rounds do not move the number pool', () => {
  const events = LETTERS.map((id) => round(id, 3));
  assert.deepEqual(candidates(events, 'numbers'), ['num-38', 'num-47', 'num-56']);
});

test('a number round is what excludes a number lesson, not a letter round', () => {
  const events = [round('num-38', 2), round('home-left', 1)];
  assert.equal(candidates(events, 'numbers')[0], 'num-38',
    'home-left was played last, but it is not in this track');
});

test('malformed events are skipped, never thrown on', () => {
  const events = [null, 'nonsense', [], { type: 'round' }, { type: 'item', lesson: 'home-left' },
    { type: 'round', lesson: 'home-left', accuracy: 'high' }, round('home-left', 2)];
  assert.deepEqual(candidates(events, 'letters'),
    ['home-right', 'home-base', 'home-words']);
});

test('an unknown track offers nothing rather than throwing', () => {
  assert.deepEqual(candidates([], 'nope'), []);
  assert.equal(pickNext([], 'nope', () => 0), null);
});

test('pickNext draws from the pool and only from the pool', () => {
  const events = [round('home-left', 2)];
  const pool = candidates(events, 'letters');
  for (const r of [0, 0.34, 0.5, 0.99]) {
    assert.ok(pool.includes(pickNext(events, 'letters', () => r)));
  }
});

test('pickNext reaches every lesson in the pool', () => {
  const picks = new Set([0, 0.4, 0.8].map((r) => pickNext([], 'letters', () => r)));
  assert.deepEqual([...picks].sort(), ['home-base', 'home-left', 'home-right']);
});

// rng returning exactly 1 is out of contract but cheap to survive, and an
// off-the-end index would hand the caller undefined and blank the screen.
test('pickNext stays in range for an rng that returns 1', () => {
  assert.ok(candidates([], 'letters').includes(pickNext([], 'letters', () => 1)));
});

test('pickNext is deterministic for a given rng sequence', () => {
  const make = () => { let n = 0; return () => ((n += 0.37) % 1); };
  const events = [round('home-left', 2), round('home-base', 1)];
  assert.equal(pickNext(events, 'letters', make()), pickNext(events, 'letters', make()));
});
