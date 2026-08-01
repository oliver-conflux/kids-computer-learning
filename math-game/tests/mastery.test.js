import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveMastery } from '../js/mastery.js';
import { CONFIG } from '../js/config.js';
import { allFacts, factId } from '../js/facts.js';

// --- helpers ---------------------------------------------------------------

/** Build an attempt event. Fields match the AttemptEvent contract. */
function attempt(a, b, ms, stage, wrong = []) {
  return {
    type: 'attempt',
    t: '2026-08-01T15:04:05.123Z',
    build: 'm1',
    session: 's_9f2c',
    op: '*',
    a,
    b,
    ms,
    stage,
    typed: [],
    wrong,
  };
}

/** Same attempt, stamped with an explicit ISO timestamp. */
function at(t, event) {
  return { ...event, t };
}

/** A run of identical attempts, oldest first. */
function repeat(count, make) {
  return Array.from({ length: count }, (_unused, index) => make(index));
}

const SIX_SEVEN = '*:6x7';
const SEVEN_SIX = '*:7x6';

function statsFor(events, id, config = CONFIG) {
  return deriveMastery(events, config).byId.get(id);
}

// --- coverage: every fact is present --------------------------------------

test('byId holds all 121 facts even with no events at all', () => {
  const model = deriveMastery([], CONFIG);
  assert.equal(model.byId.size, 121);
  for (const fact of allFacts()) {
    assert.ok(model.byId.has(factId(fact)), `missing ${factId(fact)}`);
  }
});

test('a fact with zero attempts is present, cold, and has a null median', () => {
  const model = deriveMastery([attempt(6, 7, 900, 'clean')], CONFIG);
  const untouched = model.byId.get('*:3x4');
  assert.deepEqual(untouched, {
    id: '*:3x4',
    fact: { op: '*', a: 3, b: 4 },
    bucket: 'cold',
    attempts: [],
    cleanCount: 0,
    medianCleanMs: null,
  });
});

test('every fact still present after a busy log, and none invented', () => {
  const events = [
    attempt(6, 7, 900, 'clean'),
    attempt(7, 6, 5000, 'reveal', [36]),
    attempt(10, 10, 700, 'clean'),
    { type: 'session', t: 'x', build: 'm1', session: 's_9f2c', items: 3, cleanRate: 0.6, medianMs: 900 },
  ];
  const model = deriveMastery(events, CONFIG);
  assert.equal(model.byId.size, 121);
  const known = new Set(allFacts().map(factId));
  for (const id of model.byId.keys()) {
    assert.ok(known.has(id), `unexpected id ${id}`);
  }
});

// --- clean is the only evidence of retrieval -------------------------------

test('a fact answered only after hints stays cold no matter how fast', () => {
  const events = [
    attempt(6, 7, 40, 'strategy'),
    attempt(6, 7, 12, 'blocks'),
    attempt(6, 7, 1, 'reveal'),
    attempt(6, 7, 5, 'strategy'),
    attempt(6, 7, 3, 'reveal'),
  ];
  const stats = statsFor(events, SIX_SEVEN);
  assert.equal(stats.bucket, 'cold');
  assert.equal(stats.cleanCount, 0);
  assert.equal(stats.medianCleanMs, null);
  assert.equal(stats.attempts.length, 5, 'the attempts themselves are still retained');
});

test('a hundred hinted correct answers is still cold', () => {
  const events = repeat(100, () => attempt(8, 9, 50, 'reveal'));
  assert.equal(statsFor(events, '*:8x9').bucket, 'cold');
});

// --- bucket boundaries -----------------------------------------------------

test('one clean answer is warm, never cold, however slow', () => {
  const stats = statsFor([attempt(6, 7, 9000, 'clean')], SIX_SEVEN);
  assert.equal(stats.bucket, 'warm');
  assert.equal(stats.cleanCount, 1);
  assert.equal(stats.medianCleanMs, 9000);
});

test('one blazing clean answer is warm, not hot — hot needs three', () => {
  assert.equal(statsFor([attempt(6, 7, 200, 'clean')], SIX_SEVEN).bucket, 'warm');
});

test('two fast clean answers are warm; the third tips it hot', () => {
  const two = [attempt(6, 7, 300, 'clean'), attempt(6, 7, 400, 'clean')];
  assert.equal(statsFor(two, SIX_SEVEN).bucket, 'warm');

  const three = [...two, attempt(6, 7, 500, 'clean')];
  const stats = statsFor(three, SIX_SEVEN);
  assert.equal(stats.bucket, 'hot');
  assert.equal(stats.cleanCount, 3);
});

test('exactly three clean answers with a median just under hotMs is hot', () => {
  const events = [
    attempt(6, 7, 1400, 'clean'),
    attempt(6, 7, 1499, 'clean'),
    attempt(6, 7, 1600, 'clean'),
  ];
  const stats = statsFor(events, SIX_SEVEN);
  assert.equal(stats.medianCleanMs, CONFIG.hotMs - 1);
  assert.equal(stats.bucket, 'hot');
});

test('a median of exactly hotMs is warm — the hot threshold is strict', () => {
  const events = [
    attempt(6, 7, 1400, 'clean'),
    attempt(6, 7, 1500, 'clean'),
    attempt(6, 7, 1600, 'clean'),
  ];
  const stats = statsFor(events, SIX_SEVEN);
  assert.equal(stats.medianCleanMs, CONFIG.hotMs);
  assert.equal(stats.bucket, 'warm');
});

test('many clean answers with a slow median stay warm', () => {
  const events = repeat(5, () => attempt(6, 7, 4000, 'clean'));
  const stats = statsFor(events, SIX_SEVEN);
  assert.equal(stats.cleanCount, 5);
  assert.equal(stats.bucket, 'warm');
});

test('hinted attempts do not drag the median of the clean ones', () => {
  const events = [
    attempt(6, 7, 400, 'clean'),
    attempt(6, 7, 9000, 'reveal'),
    attempt(6, 7, 500, 'clean'),
    attempt(6, 7, 9000, 'blocks'),
    attempt(6, 7, 600, 'clean'),
  ];
  const stats = statsFor(events, SIX_SEVEN);
  assert.equal(stats.cleanCount, 3);
  assert.equal(stats.medianCleanMs, 500);
  assert.equal(stats.bucket, 'hot');
});

test('the three buckets are exactly cold, warm and hot across a mixed log', () => {
  const events = [
    ...repeat(3, () => attempt(2, 3, 300, 'clean')), // hot
    attempt(4, 5, 4000, 'clean'), // warm
    attempt(6, 7, 300, 'reveal'), // cold
  ];
  const model = deriveMastery(events, CONFIG);
  assert.equal(model.byId.get('*:2x3').bucket, 'hot');
  assert.equal(model.byId.get('*:4x5').bucket, 'warm');
  assert.equal(model.byId.get(SIX_SEVEN).bucket, 'cold');
  assert.equal(model.byId.get('*:9x9').bucket, 'cold');
});

// --- median ----------------------------------------------------------------

test('median of an odd number of clean attempts is the middle value', () => {
  const events = [
    attempt(6, 7, 3000, 'clean'),
    attempt(6, 7, 1000, 'clean'),
    attempt(6, 7, 2000, 'clean'),
  ];
  assert.equal(statsFor(events, SIX_SEVEN).medianCleanMs, 2000);
});

test('median of an even number of clean attempts averages the middle two', () => {
  const events = [
    attempt(6, 7, 3000, 'clean'),
    attempt(6, 7, 1000, 'clean'),
    attempt(6, 7, 1600, 'clean'),
    attempt(6, 7, 1400, 'clean'),
  ];
  const stats = statsFor(events, SIX_SEVEN);
  assert.equal(stats.cleanCount, 4);
  assert.equal(stats.medianCleanMs, 1500);
  assert.equal(stats.bucket, 'warm', 'an even median landing exactly on hotMs is warm');
});

test('median does not depend on the order the attempts arrived in', () => {
  const ascending = [
    attempt(6, 7, 800, 'clean'),
    attempt(6, 7, 900, 'clean'),
    attempt(6, 7, 4000, 'clean'),
  ];
  const descending = [...ascending].reverse();
  assert.equal(statsFor(ascending, SIX_SEVEN).medianCleanMs, 900);
  assert.equal(statsFor(descending, SIX_SEVEN).medianCleanMs, 900);
});

test('a single clean attempt is its own median', () => {
  assert.equal(statsFor([attempt(6, 7, 1234, 'clean')], SIX_SEVEN).medianCleanMs, 1234);
});

// --- retention -------------------------------------------------------------

test('retention keeps the most recent config.retain attempts, not the first', () => {
  const events = repeat(8, (index) => attempt(6, 7, (index + 1) * 100, 'clean'));
  const stats = statsFor(events, SIX_SEVEN);
  assert.equal(stats.attempts.length, CONFIG.retain);
  assert.deepEqual(
    stats.attempts.map((a) => a.ms),
    [400, 500, 600, 700, 800],
    'the tail of the log, in order, most recent last',
  );
});

test('a fact with fewer attempts than retain keeps all of them', () => {
  const events = repeat(2, (index) => attempt(6, 7, index + 1, 'clean'));
  assert.equal(statsFor(events, SIX_SEVEN).attempts.length, 2);
});

test('old clean answers fall out of the window and the fact goes cold again', () => {
  const events = [
    ...repeat(3, () => attempt(6, 7, 300, 'clean')),
    ...repeat(CONFIG.retain, () => attempt(6, 7, 6000, 'reveal')),
  ];
  const stats = statsFor(events, SIX_SEVEN);
  assert.equal(stats.cleanCount, 0);
  assert.equal(stats.bucket, 'cold');
});

test('retain is read from the config passed in, not hard-coded', () => {
  const events = repeat(8, (index) => attempt(6, 7, (index + 1) * 100, 'clean'));
  const stats = statsFor(events, SIX_SEVEN, { ...CONFIG, retain: 3 });
  assert.deepEqual(
    stats.attempts.map((a) => a.ms),
    [600, 700, 800],
  );
});

test('hotMs is read from the config passed in, not hard-coded', () => {
  const events = repeat(3, () => attempt(6, 7, 2000, 'clean'));
  assert.equal(statsFor(events, SIX_SEVEN, { ...CONFIG, hotMs: 1500 }).bucket, 'warm');
  assert.equal(statsFor(events, SIX_SEVEN, { ...CONFIG, hotMs: 2500 }).bucket, 'hot');
});

// --- confusions ------------------------------------------------------------

test('confusions collect every wrong answer given for a fact', () => {
  const events = [
    attempt(6, 7, 4820, 'strategy', [48]),
    attempt(6, 7, 3000, 'blocks', [36, 49]),
    attempt(6, 7, 900, 'clean'),
  ];
  const model = deriveMastery(events, CONFIG);
  assert.deepEqual(model.confusions.get(SIX_SEVEN), new Set([48, 36, 49]));
});

test('confusions survive beyond the retain window', () => {
  const events = [
    attempt(6, 7, 4820, 'strategy', [48]),
    ...repeat(CONFIG.retain + 3, () => attempt(6, 7, 400, 'clean')),
  ];
  const model = deriveMastery(events, CONFIG);
  const stats = model.byId.get(SIX_SEVEN);

  assert.equal(stats.attempts.length, CONFIG.retain);
  assert.ok(
    stats.attempts.every((a) => a.wrong.length === 0),
    'the attempt carrying the wrong answer has aged out of the window',
  );
  assert.deepEqual(
    model.confusions.get(SIX_SEVEN),
    new Set([48]),
    'but the confusion itself does not age out',
  );
  assert.equal(stats.bucket, 'hot');
});

test('confusions is total — all 121 facts, empty Set rather than undefined', () => {
  const model = deriveMastery([attempt(6, 7, 900, 'clean')], CONFIG);
  assert.equal(model.confusions.size, 121);
  for (const fact of allFacts()) {
    const id = factId(fact);
    assert.ok(model.confusions.has(id), `missing ${id}`);
    const wrong = model.confusions.get(id);
    assert.ok(wrong instanceof Set, `${id} is not a Set`);
    assert.equal(wrong.size, 0);
  }
});

test('confusions is total even with no events at all', () => {
  const model = deriveMastery([], CONFIG);
  assert.equal(model.confusions.size, 121);
  assert.deepEqual(model.confusions.get('*:3x4'), new Set());
});

test('byId and confusions carry the same key set', () => {
  const events = [attempt(6, 7, 4820, 'strategy', [48]), attempt(2, 3, 900, 'clean')];
  const model = deriveMastery(events, CONFIG);
  assert.deepEqual([...model.confusions.keys()], [...model.byId.keys()]);
});

test('a fact with no wrong answers maps to an empty Set, not undefined', () => {
  const model = deriveMastery([attempt(6, 7, 4820, 'strategy', [48])], CONFIG);
  assert.deepEqual(model.confusions.get(SIX_SEVEN), new Set([48]));
  assert.notEqual(model.confusions.get(SEVEN_SIX), undefined);
  assert.deepEqual(model.confusions.get(SEVEN_SIX), new Set());
  assert.equal(model.confusions.get('*:3x4').has(12), false, 'safe to index without guarding');
});

test('confusions are keyed per fact and never pooled', () => {
  const events = [attempt(6, 7, 3000, 'reveal', [48]), attempt(7, 6, 3000, 'reveal', [36])];
  const model = deriveMastery(events, CONFIG);
  assert.deepEqual(model.confusions.get(SIX_SEVEN), new Set([48]));
  assert.deepEqual(model.confusions.get(SEVEN_SIX), new Set([36]));
});

test('a repeated wrong answer is recorded once', () => {
  const events = repeat(4, () => attempt(6, 7, 3000, 'reveal', [48]));
  const model = deriveMastery(events, CONFIG);
  assert.equal(model.confusions.get(SIX_SEVEN).size, 1);
});

// --- orientation independence ---------------------------------------------

test('6x7 and 7x6 produce independent stats from the same event list', () => {
  const events = [
    ...repeat(3, () => attempt(6, 7, 400, 'clean')),
    attempt(7, 6, 5200, 'reveal', [36]),
    attempt(7, 6, 4800, 'strategy'),
  ];
  const model = deriveMastery(events, CONFIG);

  const forward = model.byId.get(SIX_SEVEN);
  const backward = model.byId.get(SEVEN_SIX);

  assert.equal(forward.bucket, 'hot');
  assert.equal(forward.cleanCount, 3);
  assert.equal(forward.attempts.length, 3);

  assert.equal(backward.bucket, 'cold');
  assert.equal(backward.cleanCount, 0);
  assert.equal(backward.medianCleanMs, null);
  assert.equal(backward.attempts.length, 2);

  assert.deepEqual(forward.fact, { op: '*', a: 6, b: 7 });
  assert.deepEqual(backward.fact, { op: '*', a: 7, b: 6 });
});

test('squares are unaffected by orientation handling', () => {
  const events = repeat(3, () => attempt(7, 7, 400, 'clean'));
  const model = deriveMastery(events, CONFIG);
  assert.equal(model.byId.get('*:7x7').cleanCount, 3);
  assert.equal(model.byId.get('*:7x7').bucket, 'hot');
});

// --- event filtering -------------------------------------------------------

test('session events are ignored', () => {
  const events = [
    { type: 'session', t: 'x', build: 'm1', session: 's_9f2c', items: 20, cleanRate: 0.65, medianMs: 2740 },
    attempt(6, 7, 900, 'clean'),
    { type: 'session', t: 'y', build: 'm1', session: 's_9f2d', items: 20, cleanRate: 0.7, medianMs: 2100 },
  ];
  const stats = statsFor(events, SIX_SEVEN);
  assert.equal(stats.attempts.length, 1);
  assert.equal(stats.cleanCount, 1);
});

test('attempts hold exactly ms, stage and wrong — no log metadata leaks through', () => {
  const stats = statsFor([attempt(6, 7, 900, 'clean', [48])], SIX_SEVEN);
  assert.deepEqual(stats.attempts, [{ ms: 900, stage: 'clean', wrong: [48] }]);
  assert.deepEqual(Object.keys(stats.attempts[0]).sort(), ['ms', 'stage', 'wrong']);
});

test('an attempt event with no wrong field yields an empty wrong array', () => {
  const event = attempt(6, 7, 900, 'clean');
  delete event.wrong;
  assert.deepEqual(statsFor([event], SIX_SEVEN).attempts[0].wrong, []);
});

test('attempts naming operands outside the fact space are ignored', () => {
  const model = deriveMastery([attempt(11, 3, 900, 'clean'), attempt(6, 7, 900, 'clean')], CONFIG);
  assert.equal(model.byId.size, 121);
  assert.equal(model.byId.has('*:11x3'), false);
  assert.equal(model.byId.get(SIX_SEVEN).cleanCount, 1);
});

test('an out-of-range event never adds a 122nd key, and valid events still count', () => {
  // parseFactId validates format, not operand range, so a corrupt or
  // hand-edited log line can name a fact that does not exist. It must not
  // reach byId: T6 samples by iterating the model and T9 renders an 11x11
  // grid from it, and both would misbehave on a stray key.
  const events = [
    attempt(99, 50, 900, 'clean', [4950]),
    ...repeat(3, () => attempt(6, 7, 400, 'clean')),
    attempt(7, 6, 5200, 'reveal', [36]),
  ];
  const model = deriveMastery(events, CONFIG);

  assert.equal(model.byId.size, 121);
  assert.equal(model.byId.has('*:99x50'), false);
  const known = new Set(allFacts().map(factId));
  for (const id of model.byId.keys()) {
    assert.ok(known.has(id), `unexpected id ${id}`);
  }

  assert.equal(model.byId.get(SIX_SEVEN).cleanCount, 3);
  assert.equal(model.byId.get(SIX_SEVEN).bucket, 'hot');
  assert.equal(model.byId.get(SEVEN_SIX).attempts.length, 1);
  assert.deepEqual(model.confusions.get(SEVEN_SIX), new Set([36]));
});

test('an out-of-range event does not leak into confusions either', () => {
  const model = deriveMastery([attempt(99, 50, 900, 'reveal', [4950])], CONFIG);
  assert.equal(model.confusions.size, 121);
  assert.equal(model.confusions.has('*:99x50'), false);
  for (const wrong of model.confusions.values()) {
    assert.equal(wrong.size, 0);
  }
});

test('a negative or non-integer operand is skipped, not folded in', () => {
  const events = [attempt(-1, 5, 900, 'clean'), attempt(2.5, 4, 900, 'clean'), attempt(6, 7, 900, 'clean')];
  const model = deriveMastery(events, CONFIG);
  assert.equal(model.byId.size, 121);
  assert.equal(model.byId.get(SIX_SEVEN).cleanCount, 1);
});

test('malformed log lines are skipped silently and never break the derivation', () => {
  const events = [
    null,
    undefined,
    'not an object',
    42,
    {},
    { type: 'attempt' }, // no operands at all
    { type: 'attempt', op: '*', a: 6 }, // half a fact
    { type: 'unknown', op: '*', a: 6, b: 7, ms: 900, stage: 'clean' },
    attempt(6, 7, 900, 'clean'),
  ];
  const model = deriveMastery(events, CONFIG);
  assert.equal(model.byId.size, 121);
  assert.equal(model.byId.get(SIX_SEVEN).cleanCount, 1);
  assert.equal(model.byId.get(SIX_SEVEN).attempts.length, 1);
});

// --- chronological ordering ------------------------------------------------

test('events supplied out of order produce the same model as events in order', () => {
  const inOrder = [
    at('2026-07-28T09:00:00.000Z', attempt(6, 7, 5000, 'reveal', [48])),
    at('2026-07-29T09:00:00.000Z', attempt(6, 7, 4000, 'strategy')),
    at('2026-07-30T09:00:00.000Z', attempt(6, 7, 400, 'clean')),
    at('2026-07-31T09:00:00.000Z', attempt(6, 7, 500, 'clean')),
    at('2026-08-01T09:00:00.000Z', attempt(6, 7, 600, 'clean')),
    at('2026-08-01T09:01:00.000Z', attempt(7, 6, 900, 'clean')),
  ];
  const shuffled = [inOrder[3], inOrder[0], inOrder[5], inOrder[2], inOrder[4], inOrder[1]];

  assert.deepEqual(deriveMastery(shuffled, CONFIG), deriveMastery(inOrder, CONFIG));
  assert.equal(deriveMastery(shuffled, CONFIG).byId.get(SIX_SEVEN).bucket, 'hot');
});

test('the retain window keeps the latest by timestamp, not the last by position', () => {
  // The outbox replay case: Tuesday's attempts were queued while the server was
  // down and got appended to the file AFTER Wednesday's. File order is wrong;
  // time order is not.
  const wednesday = repeat(5, (index) =>
    at(`2026-07-29T09:0${index}:00.000Z`, attempt(6, 7, 300 + index, 'clean')),
  );
  const tuesday = repeat(5, (index) =>
    at(`2026-07-28T09:0${index}:00.000Z`, attempt(6, 7, 8000 + index, 'reveal')),
  );

  const asWritten = [...wednesday, ...tuesday]; // replayed late, so later in the file
  const stats = statsFor(asWritten, SIX_SEVEN);

  assert.deepEqual(
    stats.attempts.map((a) => a.ms),
    [300, 301, 302, 303, 304],
    'Wednesday is the recent form, whatever order the lines landed in',
  );
  assert.equal(stats.cleanCount, 5);
  assert.equal(stats.bucket, 'hot');
});

test('a late-replayed old session cannot drag a hot fact back to cold', () => {
  const recent = repeat(3, (index) =>
    at(`2026-08-01T09:0${index}:00.000Z`, attempt(6, 7, 400, 'clean')),
  );
  const stale = repeat(5, (index) =>
    at(`2026-07-01T09:0${index}:00.000Z`, attempt(6, 7, 9000, 'reveal')),
  );
  assert.equal(statsFor([...recent, ...stale], SIX_SEVEN).bucket, 'hot');
});

test('attempts remain most-recent-last after sorting', () => {
  const events = [
    at('2026-08-01T09:00:00.000Z', attempt(6, 7, 100, 'clean')),
    at('2026-07-30T09:00:00.000Z', attempt(6, 7, 200, 'clean')),
    at('2026-07-31T09:00:00.000Z', attempt(6, 7, 300, 'clean')),
  ];
  const stats = statsFor(events, SIX_SEVEN);
  assert.deepEqual(
    stats.attempts.map((a) => a.ms),
    [200, 300, 100],
  );
  assert.equal(stats.attempts.at(-1).ms, 100, 'the newest timestamp is last');
});

test('events sharing a timestamp keep file order — the sort is stable', () => {
  const sameInstant = '2026-08-01T09:00:00.000Z';
  const events = repeat(7, (index) => at(sameInstant, attempt(6, 7, (index + 1) * 100, 'clean')));
  assert.deepEqual(
    statsFor(events, SIX_SEVEN).attempts.map((a) => a.ms),
    [300, 400, 500, 600, 700],
    'seven events at one instant, retain 5 — the tail of file order survives',
  );
});

test('confusions are unaffected by ordering', () => {
  const events = [
    at('2026-08-01T09:00:00.000Z', attempt(6, 7, 400, 'clean')),
    at('2026-07-01T09:00:00.000Z', attempt(6, 7, 5000, 'reveal', [48])),
  ];
  assert.deepEqual(deriveMastery(events, CONFIG).confusions.get(SIX_SEVEN), new Set([48]));
});

test('a missing or malformed timestamp does not throw and does not corrupt the rest', () => {
  const noTimestamp = attempt(6, 7, 9000, 'reveal');
  delete noTimestamp.t;

  const events = [
    at('2026-08-01T09:00:00.000Z', attempt(6, 7, 400, 'clean')),
    noTimestamp,
    at('not-a-date', attempt(6, 7, 9000, 'reveal')),
    at(42, attempt(6, 7, 9000, 'reveal')),
    at(null, attempt(6, 7, 9000, 'reveal')),
    at('2026-08-01T09:01:00.000Z', attempt(6, 7, 500, 'clean')),
    at('2026-08-01T09:02:00.000Z', attempt(6, 7, 600, 'clean')),
  ];

  const stats = statsFor(events, SIX_SEVEN);
  assert.equal(stats.attempts.length, CONFIG.retain);
  assert.deepEqual(
    stats.attempts.map((a) => a.ms),
    [9000, 9000, 400, 500, 600],
    'undatable events sort to the front, where they cannot displace real recent work',
  );
  assert.equal(stats.cleanCount, 3);
  assert.equal(stats.bucket, 'hot', 'the datable recent attempts still decide the bucket');
});

test('an all-undatable log still derives, in file order', () => {
  const events = repeat(3, (index) => {
    const event = attempt(6, 7, (index + 1) * 100, 'clean');
    delete event.t;
    return event;
  });
  const stats = statsFor(events, SIX_SEVEN);
  assert.deepEqual(
    stats.attempts.map((a) => a.ms),
    [100, 200, 300],
  );
  assert.equal(stats.bucket, 'hot');
});

// --- purity and determinism -----------------------------------------------

test('deriving twice from the same events gives a deep-equal result', () => {
  const events = [
    attempt(6, 7, 4820, 'strategy', [48]),
    ...repeat(7, (index) => attempt(6, 7, 300 + index, 'clean')),
    attempt(7, 6, 5200, 'reveal', [36]),
    attempt(2, 3, 900, 'clean'),
    { type: 'session', t: 'x', build: 'm1', session: 's_9f2c', items: 9, cleanRate: 0.5, medianMs: 900 },
  ];
  assert.deepEqual(deriveMastery(events, CONFIG), deriveMastery(events, CONFIG));
});

test('deriveMastery does not mutate the events it is given', () => {
  const events = [attempt(6, 7, 4820, 'strategy', [48]), attempt(7, 6, 900, 'clean')];
  const before = structuredClone(events);
  deriveMastery(events, CONFIG);
  assert.deepEqual(events, before);
});

test('mutating the model does not reach back into the events', () => {
  const events = [attempt(6, 7, 4820, 'strategy', [48])];
  const model = deriveMastery(events, CONFIG);
  model.byId.get(SIX_SEVEN).attempts[0].wrong.push(999);
  assert.deepEqual(events[0].wrong, [48]);
});
