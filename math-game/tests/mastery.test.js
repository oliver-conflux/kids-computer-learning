import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveMastery, previousSessionMedian } from '../js/mastery.js';
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

/**
 * A learn-mode attempt. Learn ladders are ['strategy','reveal'], so the stage
 * defaults to 'strategy' — a learn attempt can never carry stage 'clean'.
 */
function learnAttempt(a, b, ms, wrong = [], stage = 'strategy') {
  return { ...attempt(a, b, ms, stage, wrong), mode: 'learn' };
}

/** A drill-mode attempt with the mode field written explicitly. */
function drillAttempt(a, b, ms, stage, wrong = []) {
  return { ...attempt(a, b, ms, stage, wrong), mode: 'drill' };
}

/**
 * An ordered-mode attempt. Ordered ladders are ['strategy','reveal'], the same
 * as learn, so 'strategy' is the unaided stage and the default here.
 */
function orderedAttempt(a, b, ms, wrong = [], stage = 'strategy', session = 's_9f2c') {
  return { ...attempt(a, b, ms, stage, wrong), mode: 'ordered', session };
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
    taught: false,
    // How many learn sessions have taught this item. `taught` is the boolean
    // form and stays; the count is what lets a learn picker rotate between
    // equally-cold groups instead of returning the same one forever.
    taughtCount: 0,
    // The two instruction rungs. This deepEqual is also the shape test for
    // them: a new field on FactStats has to be added here deliberately.
    ordered: { attempts: 0, unaided: 0, cleared: false },
    learn: { attempts: 0, unaided: 0, cleared: false },
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

// --- corrupt-field guards (Review-W1 S1 and S2) -----------------------------

test('an attempt with a non-finite ms is dropped, not admitted with NaN', () => {
  // Admitting it produced cleanCount > 0 alongside medianCleanMs: NaN, which
  // contradicts "null only when cleanCount is 0" and would propagate a poisoned
  // median into the scheduler's weights and the results grid.
  const at = (t, ms) => ({
    type: 'attempt', t, build: 'm1', session: 's',
    op: '*', a: 6, b: 7, ms, stage: 'clean', typed: [], wrong: [],
  });
  const stats = deriveMastery([
    at('2026-07-28T10:00:00.000Z', 'fast'),
    at('2026-07-28T10:01:00.000Z', NaN),
    at('2026-07-28T10:02:00.000Z', undefined),
    at('2026-07-28T10:03:00.000Z', 900),
  ], CONFIG).byId.get('*:6x7');

  assert.equal(stats.cleanCount, 1);
  assert.equal(stats.medianCleanMs, 900);
  assert.ok(Number.isFinite(stats.medianCleanMs));
});

test('medianCleanMs is finite whenever cleanCount is positive, for every fact', () => {
  const events = allFacts().map((fact, i) => ({
    type: 'attempt', t: `2026-07-28T10:00:${String(i % 60).padStart(2, '0')}.000Z`,
    build: 'm1', session: 's', op: fact.op, a: fact.a, b: fact.b,
    ms: i % 3 === 0 ? 'corrupt' : 900, stage: 'clean', typed: [], wrong: [],
  }));
  for (const [, stats] of deriveMastery(events, CONFIG).byId) {
    if (stats.cleanCount > 0) {
      assert.ok(Number.isFinite(stats.medianCleanMs), `${stats.id} median not finite`);
    } else {
      assert.equal(stats.medianCleanMs, null);
    }
  }
});

test('confusions holds only finite numbers', () => {
  const confusions = deriveMastery([{
    type: 'attempt', t: '2026-07-28T10:00:00.000Z', build: 'm1', session: 's',
    op: '*', a: 6, b: 7, ms: 900, stage: 'clean', typed: [],
    wrong: [null, 'x', undefined, NaN, {}, 48],
  }], CONFIG).confusions.get('*:6x7');

  assert.deepEqual([...confusions], [48]);
  assert.ok([...confusions].every(Number.isFinite));
});

test('an implausibly long clean attempt is not counted as retrieval', () => {
  // A kid who switches tabs gets a long ms with stage 'clean': the rAF loop
  // driving the hint ladder pauses in a hidden tab while wall time keeps
  // running. That is not evidence of fluency, and one of them in a window of
  // five drags the median far enough to flip the bucket.
  const at = (t, ms, wrong = []) => ({
    type: 'attempt', t, build: 'm1', session: 's',
    op: '*', a: 6, b: 7, ms, stage: 'clean', typed: [], wrong,
  });
  const stats = deriveMastery([
    at('2026-07-28T10:00:00.000Z', 800),
    at('2026-07-28T10:01:00.000Z', 900),
    at('2026-07-28T10:02:00.000Z', 850),
    at('2026-07-28T10:03:00.000Z', 90_000, [48]),
  ], CONFIG).byId.get('*:6x7');

  assert.equal(stats.cleanCount, 3, 'the 90s attempt is not retrieval evidence');
  assert.equal(stats.medianCleanMs, 850);
  assert.equal(stats.bucket, 'hot', 'three fast answers still make it hot');
  assert.equal(stats.attempts.length, 4, 'but the attempt still happened');
});

test('a wrong answer still counts as confusion however long the kid took', () => {
  const confusions = deriveMastery([{
    type: 'attempt', t: '2026-07-28T10:00:00.000Z', build: 'm1', session: 's',
    op: '*', a: 6, b: 7, ms: 120_000, stage: 'clean', typed: [], wrong: [48],
  }], CONFIG).confusions.get('*:6x7');
  assert.deepEqual([...confusions], [48], 'interference evidence is not time-limited');
});

// --- v2: learn attempts are not mastery evidence (spec §5) ------------------

test('a learn attempt does not change bucket, cleanCount or medianCleanMs', () => {
  const drillOnly = [
    attempt(6, 7, 400, 'clean'),
    attempt(6, 7, 500, 'clean'),
    attempt(6, 7, 600, 'clean'),
  ];
  // The same drill history with slow learn work interleaved through it. A
  // 20-second answer with the strategy on screen is a successful derivation,
  // not slow recall; folding it in would drag the median off hot.
  const mixed = [
    learnAttempt(6, 7, 20_000),
    ...drillOnly,
    learnAttempt(6, 7, 18_000),
    learnAttempt(6, 7, 25_000),
  ];

  const before = statsFor(drillOnly, SIX_SEVEN);
  const after = statsFor(mixed, SIX_SEVEN);

  assert.equal(after.bucket, before.bucket);
  assert.equal(after.bucket, 'hot');
  assert.equal(after.cleanCount, before.cleanCount);
  assert.equal(after.medianCleanMs, before.medianCleanMs);
  assert.equal(after.medianCleanMs, 500);
  assert.deepEqual(after.attempts, before.attempts, 'learn attempts never enter attempts');
});

test('a learn attempt cannot make a cold fact warm, however fast the answer', () => {
  const stats = statsFor([learnAttempt(6, 7, 120)], SIX_SEVEN);
  assert.equal(stats.bucket, 'cold');
  assert.equal(stats.cleanCount, 0);
  assert.equal(stats.medianCleanMs, null);
  assert.equal(stats.attempts.length, 0);
});

test('a learn attempt is excluded even if the line claims stage clean', () => {
  // Belt and braces. The learn ladder is ['strategy','reveal'] so this shape
  // should never be written, but a hand-edited or future-tooled log must not be
  // able to smuggle learn work into the retrieval evidence.
  const stats = statsFor(
    repeat(3, () => learnAttempt(6, 7, 300, [], 'clean')),
    SIX_SEVEN,
  );
  assert.equal(stats.cleanCount, 0);
  assert.equal(stats.bucket, 'cold');
  assert.equal(stats.attempts.length, 0);
});

test('learn attempts do not consume the retain window', () => {
  // Twenty learn reps between drill sessions must not age out the drill
  // history that actually decides the bucket.
  const events = [
    ...repeat(3, (index) =>
      at(`2026-07-28T09:0${index}:00.000Z`, attempt(6, 7, 400, 'clean')),
    ),
    ...repeat(20, (index) =>
      at(`2026-07-29T09:${String(index).padStart(2, '0')}:00.000Z`, learnAttempt(6, 7, 15_000)),
    ),
  ];
  const stats = statsFor(events, SIX_SEVEN);
  assert.equal(stats.attempts.length, 3, 'only the drill attempts are retained');
  assert.equal(stats.cleanCount, 3);
  assert.equal(stats.bucket, 'hot');
});

test('a fact with only learn attempts is cold AND taught', () => {
  const stats = statsFor(repeat(4, () => learnAttempt(6, 7, 9000)), SIX_SEVEN);
  assert.equal(stats.bucket, 'cold');
  assert.equal(stats.cleanCount, 0);
  assert.equal(stats.medianCleanMs, null);
  assert.deepEqual(stats.attempts, []);
  assert.equal(stats.taught, true, 'this is the pair the grid renders as "shown how"');
});

// --- v2: confusions are the deliberate exception ---------------------------

test("a learn attempt's wrong answers DO appear in confusions", () => {
  const model = deriveMastery([learnAttempt(6, 7, 14_000, [48, 36])], CONFIG);
  assert.deepEqual(model.confusions.get(SIX_SEVEN), new Set([48, 36]));
});

test('learn and drill confusions pool together for the same fact', () => {
  const events = [
    learnAttempt(6, 7, 14_000, [48]),
    attempt(6, 7, 5000, 'reveal', [49]),
    learnAttempt(6, 7, 12_000, [56]),
  ];
  const model = deriveMastery(events, CONFIG);
  assert.deepEqual(model.confusions.get(SIX_SEVEN), new Set([48, 49, 56]));
});

test('a learn-only fact contributes confusions while staying cold', () => {
  const model = deriveMastery([learnAttempt(6, 7, 30_000, [42])], CONFIG);
  assert.equal(model.byId.get(SIX_SEVEN).bucket, 'cold');
  assert.equal(model.byId.get(SIX_SEVEN).attempts.length, 0);
  assert.deepEqual(
    model.confusions.get(SIX_SEVEN),
    new Set([42]),
    'interference is interference whichever mode surfaced it',
  );
});

test('learn confusions are keyed per fact and do not cross orientations', () => {
  const model = deriveMastery(
    [learnAttempt(6, 7, 9000, [48]), learnAttempt(7, 6, 9000, [36])],
    CONFIG,
  );
  assert.deepEqual(model.confusions.get(SIX_SEVEN), new Set([48]));
  assert.deepEqual(model.confusions.get(SEVEN_SIX), new Set([36]));
});

test('learn confusions hold only finite numbers, like drill ones', () => {
  const model = deriveMastery([learnAttempt(6, 7, 9000, [null, 'x', NaN, 48])], CONFIG);
  assert.deepEqual([...model.confusions.get(SIX_SEVEN)], [48]);
});

// --- v2: the taught flag ---------------------------------------------------

test('taught is true after a single learn attempt', () => {
  assert.equal(statsFor([learnAttempt(6, 7, 9000)], SIX_SEVEN).taught, true);
});

test('taught is false for a fact with only drill attempts', () => {
  const events = [
    ...repeat(3, () => attempt(6, 7, 400, 'clean')),
    attempt(6, 7, 8000, 'reveal', [48]),
  ];
  assert.equal(statsFor(events, SIX_SEVEN).taught, false);
});

test('taught is false for a fact with no attempts at all', () => {
  const model = deriveMastery([learnAttempt(6, 7, 9000)], CONFIG);
  assert.equal(model.byId.get('*:3x4').taught, false);
  assert.equal(model.byId.get(SEVEN_SIX).taught, false, '6x7 taught does not teach 7x6');
});

test('taught is computed from the full log, not the retain window', () => {
  // Taught three weeks ago, drilled hard ever since. The learn attempt is long
  // out of the retain window, but the kid has still been shown the route.
  const events = [
    at('2026-07-10T09:00:00.000Z', learnAttempt(6, 7, 22_000)),
    ...repeat(CONFIG.retain + 5, (index) =>
      at(`2026-08-01T09:${String(index).padStart(2, '0')}:00.000Z`, attempt(6, 7, 400, 'clean')),
    ),
  ];
  const stats = statsFor(events, SIX_SEVEN);
  assert.equal(stats.attempts.length, CONFIG.retain);
  assert.equal(stats.bucket, 'hot');
  assert.equal(stats.taught, true, 'a route taught three weeks ago is still a route');
});

test('taught survives regardless of where the learn attempt sits in time order', () => {
  const late = [
    at('2026-08-01T09:00:00.000Z', attempt(6, 7, 400, 'clean')),
    at('2026-08-01T09:05:00.000Z', learnAttempt(6, 7, 15_000)),
  ];
  const early = [
    at('2026-08-01T09:05:00.000Z', attempt(6, 7, 400, 'clean')),
    at('2026-08-01T09:00:00.000Z', learnAttempt(6, 7, 15_000)),
  ];
  assert.equal(statsFor(late, SIX_SEVEN).taught, true);
  assert.equal(statsFor(early, SIX_SEVEN).taught, true);
});

test('every fact carries a boolean taught, never undefined', () => {
  const model = deriveMastery([learnAttempt(6, 7, 9000), attempt(2, 3, 400, 'clean')], CONFIG);
  for (const [id, stats] of model.byId) {
    assert.equal(typeof stats.taught, 'boolean', `${id} taught is not a boolean`);
  }
});

test('taught is not a fourth bucket — bucket stays cold, warm or hot', () => {
  const events = [
    learnAttempt(6, 7, 20_000),
    ...repeat(3, () => attempt(6, 7, 400, 'clean')),
    learnAttempt(4, 5, 20_000),
    attempt(4, 5, 4000, 'clean'),
    learnAttempt(2, 3, 20_000),
  ];
  const model = deriveMastery(events, CONFIG);
  assert.equal(model.byId.get(SIX_SEVEN).bucket, 'hot');
  assert.equal(model.byId.get('*:4x5').bucket, 'warm');
  assert.equal(model.byId.get('*:2x3').bucket, 'cold');
  for (const stats of model.byId.values()) {
    assert.ok(['cold', 'warm', 'hot'].includes(stats.bucket), `${stats.id} has a stray bucket`);
  }
  // Exactly the "shown how" pairing T7 renders: cold and taught.
  assert.equal(model.byId.get('*:2x3').taught, true);
  assert.equal(model.byId.get('*:9x9').taught, false);
});

// --- v2: absent mode means drill (all v1 history) --------------------------

test('an attempt event with NO mode field is treated as drill', () => {
  const events = repeat(3, () => attempt(6, 7, 400, 'clean'));
  assert.equal(
    events.every((event) => !('mode' in event)),
    true,
    'the v1 line shape',
  );
  const stats = statsFor(events, SIX_SEVEN);
  assert.equal(stats.cleanCount, 3);
  assert.equal(stats.bucket, 'hot', 'v1 history still earns its bucket');
  assert.equal(stats.taught, false);
});

test('an explicit mode drill is identical to an absent mode', () => {
  const implicit = repeat(3, () => attempt(6, 7, 400, 'clean'));
  const explicit = repeat(3, () => drillAttempt(6, 7, 400, 'clean'));
  const fromImplicit = statsFor(implicit, SIX_SEVEN);
  const fromExplicit = statsFor(explicit, SIX_SEVEN);
  assert.deepEqual(fromExplicit, fromImplicit);
  assert.equal(fromExplicit.bucket, 'hot');
});

test('an unrecognised mode value falls back to drill rather than being dropped', () => {
  // Only the exact literal 'learn' excludes. A corrupt or future mode string
  // must not silently delete evidence the kid earned.
  const events = repeat(3, () => ({ ...attempt(6, 7, 400, 'clean'), mode: 'Learn' }));
  const stats = statsFor(events, SIX_SEVEN);
  assert.equal(stats.cleanCount, 3);
  assert.equal(stats.bucket, 'hot');
  assert.equal(stats.taught, false);
});

test('a whole v1-shaped log derives with taught false everywhere', () => {
  const events = [
    attempt(6, 7, 400, 'clean'),
    attempt(7, 6, 5000, 'reveal', [36]),
    attempt(2, 3, 900, 'strategy'),
  ];
  const model = deriveMastery(events, CONFIG);
  for (const stats of model.byId.values()) {
    assert.equal(stats.taught, false, `${stats.id} claims to have been taught`);
  }
});

// --- v2: v1 invariants still hold under a mixed log ------------------------

test('byId and confusions stay total at 121 under a learn-heavy log', () => {
  const events = [
    ...repeat(30, () => learnAttempt(6, 7, 18_000, [48])),
    learnAttempt(0, 0, 9000),
    attempt(10, 10, 400, 'clean'),
  ];
  const model = deriveMastery(events, CONFIG);
  assert.equal(model.byId.size, 121);
  assert.equal(model.confusions.size, 121);
  assert.deepEqual([...model.confusions.keys()], [...model.byId.keys()]);
  const known = new Set(allFacts().map(factId));
  for (const id of model.byId.keys()) {
    assert.ok(known.has(id), `unexpected id ${id}`);
  }
});

test('a learn attempt naming an out-of-range fact never adds a 122nd key', () => {
  const model = deriveMastery([learnAttempt(99, 50, 9000, [4950])], CONFIG);
  assert.equal(model.byId.size, 121);
  assert.equal(model.confusions.size, 121);
  assert.equal(model.byId.has('*:99x50'), false);
  for (const stats of model.byId.values()) {
    assert.equal(stats.taught, false);
  }
});

test('learn attempts are sorted with the rest before folding', () => {
  // Out-of-order replay must not change which drill attempts survive retention.
  const inOrder = [
    at('2026-07-28T09:00:00.000Z', learnAttempt(6, 7, 20_000, [48])),
    at('2026-07-29T09:00:00.000Z', attempt(6, 7, 400, 'clean')),
    at('2026-07-30T09:00:00.000Z', learnAttempt(6, 7, 21_000)),
    at('2026-07-31T09:00:00.000Z', attempt(6, 7, 500, 'clean')),
    at('2026-08-01T09:00:00.000Z', attempt(6, 7, 600, 'clean')),
  ];
  const shuffled = [inOrder[4], inOrder[1], inOrder[3], inOrder[0], inOrder[2]];
  assert.deepEqual(deriveMastery(shuffled, CONFIG), deriveMastery(inOrder, CONFIG));

  const stats = statsFor(shuffled, SIX_SEVEN);
  assert.deepEqual(
    stats.attempts.map((a) => a.ms),
    [400, 500, 600],
  );
  assert.equal(stats.bucket, 'hot');
  assert.equal(stats.taught, true);
});

test('6x7 and 7x6 stay independent across modes', () => {
  const events = [
    ...repeat(3, () => attempt(6, 7, 400, 'clean')),
    ...repeat(2, () => learnAttempt(7, 6, 19_000, [36])),
  ];
  const model = deriveMastery(events, CONFIG);

  const forward = model.byId.get(SIX_SEVEN);
  const backward = model.byId.get(SEVEN_SIX);

  assert.equal(forward.bucket, 'hot');
  assert.equal(forward.taught, false);
  assert.deepEqual(model.confusions.get(SIX_SEVEN), new Set());

  assert.equal(backward.bucket, 'cold');
  assert.equal(backward.taught, true);
  assert.equal(backward.attempts.length, 0);
  assert.deepEqual(model.confusions.get(SEVEN_SIX), new Set([36]));
});

test('a learn attempt with a non-finite ms is dropped like any corrupt line', () => {
  const broken = learnAttempt(6, 7, 400);
  broken.ms = 'slow';
  const stats = statsFor([broken], SIX_SEVEN);
  assert.equal(stats.taught, false, 'a corrupt line is corrupt in either mode');
  assert.equal(stats.cleanCount, 0);
});

// --- v2: determinism -------------------------------------------------------

test('deriving twice from a mixed-mode log gives a deep-equal result', () => {
  const events = [
    learnAttempt(6, 7, 22_000, [48]),
    ...repeat(7, (index) => attempt(6, 7, 300 + index, 'clean')),
    drillAttempt(7, 6, 5200, 'reveal', [36]),
    learnAttempt(2, 3, 17_000),
    attempt(2, 3, 900, 'clean'),
    { type: 'session', t: 'x', build: 'm1', session: 's_9f2c', items: 9, cleanRate: 0.5, medianMs: 900 },
  ];
  assert.deepEqual(deriveMastery(events, CONFIG), deriveMastery(events, CONFIG));
});

test('deriveMastery does not mutate a mixed-mode event list', () => {
  const events = [learnAttempt(6, 7, 22_000, [48]), attempt(7, 6, 900, 'clean')];
  const before = structuredClone(events);
  deriveMastery(events, CONFIG);
  assert.deepEqual(events, before);
});

test('the retain window keeps exactly config.retain, not one more', () => {
  // V2-Review-W1 SMALL 5 — surviving mutation. `all.length > config.retain`
  // mutated to `> config.retain + 1` passed the whole suite: with exactly
  // retain+1 attempts the window silently widened to 6. Needs a case where the
  // extra attempt is load-bearing, i.e. where keeping it changes the bucket.
  const at = (i, ms) => ({
    type: 'attempt', t: `2026-07-28T10:${String(i).padStart(2, '0')}:00.000Z`,
    build: 'm2', session: 's', op: '*', a: 6, b: 7, ms, stage: 'clean', typed: [], wrong: [],
  });
  // Six attempts: one ancient slow one, then five fast. Retaining 5 gives hot;
  // retaining 6 drags the median and gives warm.
  const stats = deriveMastery(
    [at(0, 50_000), at(1, 800), at(2, 850), at(3, 900), at(4, 820), at(5, 870)],
    CONFIG,
  ).byId.get('*:6x7');

  assert.equal(stats.attempts.length, 5, 'the window is exactly retain');
  assert.equal(stats.cleanCount, 5);
  assert.equal(stats.bucket, 'hot', 'the 50s attempt must have fallen out');
  assert.ok(stats.attempts.every((a) => a.ms < 1000), 'no ancient attempt retained');
});

test('maxPlausibleMs is inclusive at the boundary', () => {
  // V2-Review-W1 SMALL 7 — `<=` mutated to `<` passed the whole suite.
  const at = (i, ms) => ({
    type: 'attempt', t: `2026-07-28T10:${String(i).padStart(2, '0')}:00.000Z`,
    build: 'm2', session: 's', op: '*', a: 6, b: 7, ms, stage: 'clean', typed: [], wrong: [],
  });
  const exactly = deriveMastery([at(0, CONFIG.maxPlausibleMs)], CONFIG).byId.get('*:6x7');
  assert.equal(exactly.cleanCount, 1, 'exactly maxPlausibleMs counts');
  assert.equal(exactly.medianCleanMs, CONFIG.maxPlausibleMs);

  const overBy1 = deriveMastery([at(0, CONFIG.maxPlausibleMs + 1)], CONFIG).byId.get('*:6x7');
  assert.equal(overBy1.cleanCount, 0, 'one millisecond over does not');
  assert.equal(overBy1.medianCleanMs, null);
});

// --- v3: ordered mode is instruction, not mastery evidence (spec §3) --------

test('ordered attempts never reach the buckets, however clean and fast', () => {
  // Stage 'clean' on purpose. The ordered ladder is ['strategy','reveal'] so
  // this shape should never be written — five drill attempts of exactly this
  // shape make the fact hot, which is what makes this an exclusion test rather
  // than an accident of slow instruction latencies.
  const events = repeat(5, () => orderedAttempt(6, 7, 400, [], 'clean'));
  const stats = statsFor(events, SIX_SEVEN);
  assert.equal(stats.bucket, 'cold');
  assert.equal(stats.cleanCount, 0);
  assert.equal(stats.medianCleanMs, null);
  assert.deepEqual(stats.attempts, []);
});

test('ordered attempts DO set taught — walking a table in order is instruction', () => {
  const stats = statsFor(repeat(5, () => orderedAttempt(6, 7, 400, [], 'clean')), SIX_SEVEN);
  assert.equal(stats.taught, true);
  assert.equal(stats.taughtCount, 1, 'one session, one lesson');
});

test('ordered attempts interleaved through drill change nothing the drill earned', () => {
  // The test that catches a partial fix: excluded from the buckets AND out of
  // the retain window, not merely discounted.
  const drillOnly = [
    at('2026-08-01T09:00:00.000Z', attempt(6, 7, 400, 'clean')),
    at('2026-08-01T09:02:00.000Z', attempt(6, 7, 500, 'clean')),
    at('2026-08-01T09:04:00.000Z', attempt(6, 7, 600, 'clean')),
  ];
  const mixed = [
    at('2026-08-01T08:59:00.000Z', orderedAttempt(6, 7, 20_000)),
    ...drillOnly,
    at('2026-08-01T09:03:00.000Z', orderedAttempt(6, 7, 18_000)),
    at('2026-08-01T09:05:00.000Z', orderedAttempt(6, 7, 25_000)),
  ];

  const before = statsFor(drillOnly, SIX_SEVEN);
  const after = statsFor(mixed, SIX_SEVEN);

  assert.equal(after.bucket, before.bucket);
  assert.equal(after.bucket, 'hot');
  assert.equal(after.cleanCount, before.cleanCount);
  assert.equal(after.medianCleanMs, before.medianCleanMs);
  assert.deepEqual(after.attempts, before.attempts);
});

// --- v3: the two instruction rungs (spec §3, §4) ---------------------------

const NEVER = { attempts: 0, unaided: 0, cleared: false };

/** Minutes apart on one morning, so "the last two" is unambiguous. */
function minute(index) {
  return `2026-08-01T09:${String(index).padStart(2, '0')}:00.000Z`;
}

test('unaided means the strategy stage AND nothing wrong typed first', () => {
  const learnRung = (event) => statsFor([event], SIX_SEVEN).learn;

  assert.deepEqual(learnRung(learnAttempt(6, 7, 9000)), {
    attempts: 1,
    unaided: 1,
    cleared: false,
  });
  assert.deepEqual(
    learnRung(learnAttempt(6, 7, 9000, [], 'reveal')),
    { attempts: 1, unaided: 0, cleared: false },
    'she pressed the button — tried, but not unaided',
  );
  assert.deepEqual(
    learnRung(learnAttempt(6, 7, 9000, [42])),
    { attempts: 1, unaided: 0, cleared: false },
    'right in the end, but not on the first typed value',
  );
});

test('one unaided attempt clears nothing; two consecutive clear the rung', () => {
  assert.deepEqual(statsFor([learnAttempt(6, 7, 9000)], SIX_SEVEN).learn, {
    attempts: 1,
    unaided: 1,
    cleared: false,
  });

  const twice = repeat(2, (index) => at(minute(index), learnAttempt(6, 7, 9000)));
  assert.deepEqual(statsFor(twice, SIX_SEVEN).learn, {
    attempts: 2,
    unaided: 2,
    cleared: true,
  });

  assert.equal(
    statsFor(twice, SIX_SEVEN, { ...CONFIG, unaidedRuns: 3 }).learn.cleared,
    false,
    'the threshold is config.unaidedRuns, not a hard-coded 2',
  );
});

test('only the last two count: unaided-then-aided does not clear', () => {
  const slipped = [
    at(minute(0), learnAttempt(6, 7, 9000)),
    at(minute(1), learnAttempt(6, 7, 9000, [42])),
  ];
  const rung = statsFor(slipped, SIX_SEVEN).learn;
  assert.equal(rung.unaided, 1);
  assert.equal(rung.cleared, false, 'one unaided in the log is not two unaided at the end of it');
});

test('only the last two count: aided-then-two-unaided does clear', () => {
  const recovered = [
    at(minute(0), learnAttempt(6, 7, 9000, [42])),
    at(minute(1), learnAttempt(6, 7, 9000)),
    at(minute(2), learnAttempt(6, 7, 9000)),
  ];
  assert.deepEqual(statsFor(recovered, SIX_SEVEN).learn, {
    attempts: 3,
    unaided: 2,
    cleared: true,
  });
});

test('learn counts attempts and ordered counts runs — the same twice is not the same twice', () => {
  // A learn session cycles its few facts config.learnPasses times, so one
  // session can produce two attempts on one fact, and both are evidence.
  const twiceInOneLesson = [
    at(minute(0), learnAttempt(6, 7, 9000)),
    at(minute(1), learnAttempt(6, 7, 9000)),
  ];
  assert.deepEqual(
    statsFor(twiceInOneLesson, SIX_SEVEN).learn,
    { attempts: 2, unaided: 2, cleared: true },
    'two attempts, one session, and the learn rung clears',
  );

  // An ordered run serves each fact once. Two attempts sharing a session id are
  // therefore one occasion seen twice — she did not come back to it a week
  // later, which is the whole point of asking for two.
  const twiceInOneRun = [
    at(minute(0), orderedAttempt(6, 7, 9000, [], 'strategy', 'run_a')),
    at(minute(1), orderedAttempt(6, 7, 9000, [], 'strategy', 'run_a')),
  ];
  assert.deepEqual(
    statsFor(twiceInOneRun, SIX_SEVEN).ordered,
    { attempts: 1, unaided: 1, cleared: false },
    'one run, however many times that run served the fact',
  );

  // The same two attempts, on two visits. This is what clearing looks like.
  const twoRuns = [
    at(minute(0), orderedAttempt(6, 7, 9000, [], 'strategy', 'run_a')),
    at(minute(1), orderedAttempt(6, 7, 9000, [], 'strategy', 'run_b')),
  ];
  assert.deepEqual(statsFor(twoRuns, SIX_SEVEN).ordered, {
    attempts: 2,
    unaided: 2,
    cleared: true,
  });
});

test('the rungs do not read each other, and drill is neither of them', () => {
  const events = [
    ...repeat(3, (index) => at(minute(index), attempt(6, 7, 400, 'clean'))),
    at(minute(3), orderedAttempt(6, 7, 9000)),
  ];
  const stats = statsFor(events, SIX_SEVEN);
  assert.equal(stats.bucket, 'hot', 'drill has its own rung and this is it');
  assert.deepEqual(stats.learn, NEVER, 'neither drill nor ordered is learn evidence');
  assert.deepEqual(stats.ordered, { attempts: 1, unaided: 1, cleared: false });
});

test('a fact never attempted carries both rungs at zero, and every fact carries both', () => {
  const model = deriveMastery([learnAttempt(6, 7, 9000), orderedAttempt(2, 3, 9000)], CONFIG);
  assert.deepEqual(model.byId.get('*:3x4').learn, NEVER);
  assert.deepEqual(model.byId.get('*:3x4').ordered, NEVER);
  for (const [id, stats] of model.byId) {
    assert.equal(typeof stats.learn?.cleared, 'boolean', `${id} has no learn rung`);
    assert.equal(typeof stats.ordered?.cleared, 'boolean', `${id} has no ordered rung`);
  }
});

// --- v3: which sessions are comparable (spec §5) ---------------------------
//
// `previousSessionMedian` decides what "quicker than last time" is measured
// against, and every way of getting it wrong is silent: a plausible number, no
// exception, nothing red. It lives here rather than in main.js because main.js
// reaches for the DOM at import time and so cannot be tested at all.

/** A SessionEvent as main.js writes one. `mode` omitted means v1 history. */
function sessionEvent(t, medianMs, mode) {
  const event = { type: 'session', t, build: 'm2', session: 's_9f2c', items: 20, medianMs };
  if (mode !== undefined) {
    event.mode = mode;
  }
  return event;
}

test('an ordered session is not something a drill session can be compared against', () => {
  // THE ONE THAT USED TO PASS SILENTLY. The function was a reject-list on
  // 'learn', so a fourth mode walked straight through it and a 9-second answer
  // worked out with the strategy on screen became the bar a 2-second drill
  // answer was measured against.
  const events = [
    sessionEvent(minute(0), 2000, 'drill'),
    sessionEvent(minute(1), 9000, 'ordered'),
  ];
  assert.equal(previousSessionMedian(events), 2000);
});

test('a learn session is ignored too, and an instruction-only log has nothing to compare', () => {
  assert.equal(
    previousSessionMedian([
      sessionEvent(minute(0), 8000, 'learn'),
      sessionEvent(minute(1), 9000, 'ordered'),
    ]),
    null,
  );
});

test('a session event with NO mode is a drill session', () => {
  // Every session line written before the field existed was a drill. Same rule
  // as attempt events, so all v1 history keeps working with no migration.
  assert.equal(previousSessionMedian([sessionEvent(minute(0), 2400)]), 2400);
});

test('the most recent drill session wins, whatever order the events arrive in', () => {
  // File order is not chronological — the log client replays a queued outbox at
  // startup — so "the last one" has to mean the last one in TIME.
  const events = [
    sessionEvent(minute(5), 2100, 'drill'),
    sessionEvent(minute(9), 1800, 'drill'),
    sessionEvent(minute(7), 2600, 'drill'),
  ];
  assert.equal(previousSessionMedian(events), 1800);
});

test('attempts, corrupt lines and a non-numeric median are all skipped', () => {
  const events = [
    null,
    'not an event',
    attempt(6, 7, 400, 'clean'),
    sessionEvent(minute(1), null, 'drill'),
    sessionEvent(minute(2), 2200, 'drill'),
  ];
  assert.equal(previousSessionMedian(events), 2200);
  assert.equal(previousSessionMedian([]), null);
});
