// Coverage for the three UNWINDOWED facts core/mastery.js reports about an item:
// `firstAttempt`, `cleanSessions` and `cleanTotal`.
//
// The windowed statistics — `bucket`, `cleanCount`, `medianCleanMs` — are pinned
// by math-game/tests/mastery.test.js, which exercises the same module through
// math's binding shim. That file is the regression net for everything this one
// does not touch, and it must stay green.
//
// Why these three are unwindowed, since it is the whole reason they exist: the
// first sighting of an item is a fact about ALL of history. `config.retain` is 5,
// so a windowed first-attempt would age out after five drills and the marking
// rule built on it (spelling-game/js/placement.js) would silently start treating
// a long-known word as never seen.

import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveMastery } from '../mastery.js';

const CONFIG = { retain: 5, hotMs: 4000, maxPlausibleMs: 60_000 };

/**
 * A minimal item space over a fixture word list. deriveMastery reads
 * `allItems()` directly, so a fixture space is the only way to keep these tests
 * off the real 995-word spine.
 */
function spaceOf(...words) {
  const items = words.map((word) => ({ word }));
  return {
    allItems: () => items,
    itemId: (item) => `w:${item.word}`,
    idFromEvent: (event) =>
      event !== null && typeof event === 'object' && typeof event.word === 'string' && event.word !== ''
        ? `w:${event.word}`
        : null,
    relatedIds: () => [],
    targetOf: (item) => item.word,
    isTypableChar: (char) => /^[a-z]$/.test(char),
    coerceWrong: (typed) => typed,
    isValidWrong: (value) => typeof value === 'string' && value !== '',
    answerValue: (item) => item.word,
    eventFields: (item) => ({ word: item.word }),
  };
}

/** An attempt event. `t` is the only field these tests ever need to vary freely. */
function attempt(word, t, overrides = {}) {
  return {
    type: 'attempt',
    t,
    word,
    ms: 1000,
    stage: 'clean',
    wrong: [],
    mode: 'drill',
    session: 's1',
    ...overrides,
  };
}

const statsFor = (events, space, word) =>
  deriveMastery(events, CONFIG, space).byId.get(`w:${word}`);

test('firstAttempt is the earliest attempt by timestamp, not by file order', () => {
  const space = spaceOf('cat');
  // Deliberately out of order: the log is append-only and an outbox replay can
  // land Tuesday's events after Wednesday's.
  const events = [
    attempt('cat', '2026-08-02T12:00:00.000Z', { ms: 2000 }),
    attempt('cat', '2026-08-01T09:00:00.000Z', { ms: 1111 }),
    attempt('cat', '2026-08-03T15:00:00.000Z', { ms: 3000 }),
  ];

  const stats = statsFor(events, space, 'cat');
  assert.equal(stats.firstAttempt.t, '2026-08-01T09:00:00.000Z');
  assert.equal(stats.firstAttempt.ms, 1111);
});

test('firstAttempt carries stage and session, which the marking rule reads', () => {
  const space = spaceOf('cat');
  const events = [attempt('cat', '2026-08-01T09:00:00.000Z', { stage: 'r2', session: 's_abc' })];

  const stats = statsFor(events, space, 'cat');
  assert.equal(stats.firstAttempt.stage, 'r2');
  assert.equal(stats.firstAttempt.session, 's_abc');
});

test('an untouched item has firstAttempt null and both maps stay total', () => {
  const space = spaceOf('cat', 'dog');
  const model = deriveMastery([attempt('cat', '2026-08-01T09:00:00.000Z')], CONFIG, space);

  assert.equal(model.byId.get('w:dog').firstAttempt, null);
  assert.equal(model.byId.get('w:dog').cleanSessions, 0);
  assert.equal(model.byId.get('w:dog').cleanTotal, 0);
  assert.equal(model.byId.size, 2);
  assert.equal(model.confusions.size, 2);
});

test('an attempt older than the retain window still supplies firstAttempt', () => {
  const space = spaceOf('cat');
  // retain is 5. Seven attempts, so the first two fall out of the window.
  const events = [];
  for (let i = 0; i < 7; i += 1) {
    events.push(attempt('cat', `2026-08-0${i + 1}T09:00:00.000Z`, { ms: 1000 + i }));
  }

  const stats = statsFor(events, space, 'cat');
  assert.equal(stats.attempts.length, 5, 'windowed attempts still respect retain');
  assert.equal(stats.firstAttempt.ms, 1000, 'but the first sighting survives the window');
  assert.equal(stats.cleanTotal, 7, 'and cleanTotal counts every clean attempt, unwindowed');
});

test('learn-mode attempts are never firstAttempt and never counted', () => {
  const space = spaceOf('cat');
  const events = [
    attempt('cat', '2026-08-01T09:00:00.000Z', { mode: 'learn', ms: 9999 }),
    attempt('cat', '2026-08-02T09:00:00.000Z', { mode: 'drill', ms: 1234 }),
  ];

  const stats = statsFor(events, space, 'cat');
  assert.equal(stats.firstAttempt.ms, 1234, 'the learn attempt is not a first sighting');
  assert.equal(stats.cleanTotal, 1);
  assert.equal(stats.cleanSessions, 1);
});

test('an absent mode reads as drill, so pre-mode history still counts', () => {
  const space = spaceOf('cat');
  const events = [{ type: 'attempt', t: '2026-08-01T09:00:00.000Z', word: 'cat', ms: 800, stage: 'clean' }];

  const stats = statsFor(events, space, 'cat');
  assert.equal(stats.firstAttempt.ms, 800);
  assert.equal(stats.cleanTotal, 1);
});

test('cleanSessions counts distinct sessions, not attempts', () => {
  const space = spaceOf('cat');
  const sameSitting = [
    attempt('cat', '2026-08-01T09:00:00.000Z', { session: 's_a' }),
    attempt('cat', '2026-08-01T09:01:00.000Z', { session: 's_a' }),
    attempt('cat', '2026-08-01T09:02:00.000Z', { session: 's_a' }),
  ];
  assert.equal(statsFor(sameSitting, space, 'cat').cleanTotal, 3);
  assert.equal(statsFor(sameSitting, space, 'cat').cleanSessions, 1);

  const spread = [
    attempt('cat', '2026-08-01T09:00:00.000Z', { session: 's_a' }),
    attempt('cat', '2026-08-02T09:00:00.000Z', { session: 's_b' }),
    attempt('cat', '2026-08-03T09:00:00.000Z', { session: 's_c' }),
  ];
  assert.equal(statsFor(spread, space, 'cat').cleanSessions, 3);
});

test('only CLEAN attempts contribute to cleanSessions', () => {
  const space = spaceOf('cat');
  const events = [
    attempt('cat', '2026-08-01T09:00:00.000Z', { session: 's_a', stage: 'r3' }),
    attempt('cat', '2026-08-02T09:00:00.000Z', { session: 's_b', stage: 'clean' }),
  ];

  const stats = statsFor(events, space, 'cat');
  assert.equal(stats.cleanSessions, 1);
  assert.equal(stats.cleanTotal, 1);
});

test('an attempt with no session id is its own session', () => {
  const space = spaceOf('cat');
  // Matches the `#loose` handling taughtSessionsById already uses: lumping these
  // under one key would make a whole old log look like a single sitting.
  const events = [
    attempt('cat', '2026-08-01T09:00:00.000Z', { session: undefined }),
    attempt('cat', '2026-08-02T09:00:00.000Z', { session: '' }),
  ];

  assert.equal(statsFor(events, space, 'cat').cleanSessions, 2);
});

test('an implausibly long clean attempt counts for neither total nor sessions', () => {
  const space = spaceOf('cat');
  // She left the room. Not retrieval, so not evidence — the same rule the
  // windowed median already applies.
  const events = [
    attempt('cat', '2026-08-01T09:00:00.000Z', { ms: 90_000, session: 's_a' }),
    attempt('cat', '2026-08-02T09:00:00.000Z', { ms: 1200, session: 's_b' }),
  ];

  const stats = statsFor(events, space, 'cat');
  assert.equal(stats.cleanTotal, 1);
  assert.equal(stats.cleanSessions, 1);
});

test('an implausibly long attempt can still be the first sighting', () => {
  const space = spaceOf('cat');
  // It happened. It is not latency evidence, but it is not "never seen" either,
  // and treating it as never-seen would let one distraction re-open a marked word.
  const events = [attempt('cat', '2026-08-01T09:00:00.000Z', { ms: 90_000 })];

  assert.notEqual(statsFor(events, space, 'cat').firstAttempt, null);
  assert.equal(statsFor(events, space, 'cat').cleanTotal, 0);
});

test('corrupt lines poison none of the three fields', () => {
  const space = spaceOf('cat');
  const events = [
    null,
    'not an object',
    { type: 'session' },
    { type: 'attempt', word: 'cat' }, // no ms
    { type: 'attempt', word: 'cat', ms: Number.NaN, t: '2026-08-01T09:00:00.000Z' },
    { type: 'attempt', word: 'ghost', ms: 100, t: '2026-08-01T09:00:00.000Z', stage: 'clean' },
    attempt('cat', '2026-08-02T09:00:00.000Z', { ms: 700 }),
  ];

  const model = deriveMastery(events, CONFIG, space);
  const stats = model.byId.get('w:cat');
  assert.equal(stats.firstAttempt.ms, 700);
  assert.equal(stats.cleanTotal, 1);
  assert.equal(stats.cleanSessions, 1);
  assert.equal(model.byId.size, 1, 'the ghost word never becomes a key');
});

test('the windowed statistics are untouched by the new fields', () => {
  const space = spaceOf('cat');
  const events = [
    attempt('cat', '2026-08-01T09:00:00.000Z', { ms: 1000 }),
    attempt('cat', '2026-08-02T09:00:00.000Z', { ms: 2000 }),
    attempt('cat', '2026-08-03T09:00:00.000Z', { ms: 3000 }),
  ];

  const stats = statsFor(events, space, 'cat');
  assert.equal(stats.bucket, 'hot');
  assert.equal(stats.cleanCount, 3);
  assert.equal(stats.medianCleanMs, 2000);
});
