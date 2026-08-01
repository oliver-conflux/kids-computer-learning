import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pickNext } from '../js/scheduler.js';
import { deriveMastery } from '../js/mastery.js';
import { CONFIG } from '../js/config.js';
import { allFacts, factId } from '../js/facts.js';

// --- helpers ---------------------------------------------------------------

/**
 * mulberry32 — a small, seeded, deterministic generator in [0,1).
 * Every test drives the scheduler through one of these, so a failure is always
 * reproducible from its seed. The scheduler itself owns no randomness.
 */
function seededRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

/** Three fast clean answers => hot. */
function hotEvents(a, b) {
  return [attempt(a, b, 600, 'clean'), attempt(a, b, 700, 'clean'), attempt(a, b, 650, 'clean')];
}

/** One slow clean answer => warm. */
function warmEvents(a, b) {
  return [attempt(a, b, 3000, 'clean')];
}

/** An attempt that never reached a clean answer => cold, but with a record. */
function coldEvents(a, b, wrong = []) {
  return [attempt(a, b, 5000, 'reveal', wrong)];
}

function draw(model, history, config, rng, count) {
  const ids = [];
  for (let index = 0; index < count; index += 1) {
    ids.push(factId(pickNext(model, history, config, rng)));
  }
  return ids;
}

function tally(ids) {
  const counts = new Map();
  for (const id of ids) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

// A config whose governor can never fire (a rate is never below 0). Used to
// isolate the other two constraints from the governor's hot-only restriction.
const NO_GOVERNOR = { ...CONFIG, governorFloor: 0 };

const SIX_SEVEN = '*:6x7'; // answer 42
const SEVEN_SIX = '*:7x6';
const SIX_EIGHT = '*:6x8'; // answer 48
const EIGHT_SIX = '*:8x6';

// --- shape -----------------------------------------------------------------

test('returns a Fact from the 121-fact space', () => {
  const model = deriveMastery([], CONFIG);
  const rng = seededRng(1);
  const known = new Set(allFacts().map(factId));

  for (let index = 0; index < 500; index += 1) {
    const fact = pickNext(model, [], CONFIG, rng);
    assert.equal(typeof fact, 'object');
    assert.equal(fact.op, '*');
    assert.ok(Number.isInteger(fact.a) && fact.a >= 0 && fact.a <= 10);
    assert.ok(Number.isInteger(fact.b) && fact.b >= 0 && fact.b <= 10);
    assert.ok(known.has(factId(fact)));
  }
});

test('the same seed produces the same sequence (replay determinism)', () => {
  const model = deriveMastery([...hotEvents(3, 3), ...warmEvents(4, 4)], CONFIG);
  const first = draw(model, [], CONFIG, seededRng(20260801), 50);
  const second = draw(model, [], CONFIG, seededRng(20260801), 50);
  const other = draw(model, [], CONFIG, seededRng(7), 50);

  assert.deepEqual(first, second);
  assert.notDeepEqual(first, other);
});

test('exactly one rng value is consumed per pick', () => {
  const model = deriveMastery([], CONFIG);
  let calls = 0;
  const inner = seededRng(11);
  const counting = () => {
    calls += 1;
    return inner();
  };
  draw(model, [], CONFIG, counting, 100);
  assert.equal(calls, 100);
});

// --- weighting -------------------------------------------------------------

test('cold facts are sampled more often than warm, and warm more than hot', () => {
  const facts = allFacts();
  const events = [];
  for (let index = 0; index < 40; index += 1) {
    events.push(...hotEvents(facts[index].a, facts[index].b));
  }
  for (let index = 40; index < 80; index += 1) {
    events.push(...warmEvents(facts[index].a, facts[index].b));
  }
  const model = deriveMastery(events, CONFIG);

  const buckets = { cold: 0, warm: 0, hot: 0 };
  for (const stats of model.byId.values()) {
    buckets[stats.bucket] += 1;
  }
  assert.deepEqual(buckets, { hot: 40, warm: 40, cold: 41 });

  const totals = { cold: 0, warm: 0, hot: 0 };
  const ids = draw(model, [], CONFIG, seededRng(4242), 30000);
  for (const id of ids) {
    totals[model.byId.get(id).bucket] += 1;
  }

  const perFact = {
    cold: totals.cold / buckets.cold,
    warm: totals.warm / buckets.warm,
    hot: totals.hot / buckets.hot,
  };

  assert.ok(perFact.cold > perFact.warm, `cold ${perFact.cold} !> warm ${perFact.warm}`);
  assert.ok(perFact.warm > perFact.hot, `warm ${perFact.warm} !> hot ${perFact.hot}`);

  // Weights are 6 / 3 / 1, so the ratios should land near 6 and 3. Bounds are
  // loose enough to be stable, tight enough to catch an inverted or flat table.
  const coldOverHot = perFact.cold / perFact.hot;
  const warmOverHot = perFact.warm / perFact.hot;
  assert.ok(coldOverHot > 4 && coldOverHot < 9, `cold/hot ratio ${coldOverHot}`);
  assert.ok(warmOverHot > 2 && warmOverHot < 4.5, `warm/hot ratio ${warmOverHot}`);
});

test('hot facts still resurface — weight 1 is not weight 0', () => {
  const events = [...hotEvents(3, 3), ...hotEvents(4, 4)];
  const model = deriveMastery(events, CONFIG);
  const counts = tally(draw(model, [], CONFIG, seededRng(99), 6000));

  assert.ok((counts.get('*:3x3') ?? 0) > 0);
  assert.ok((counts.get('*:4x4') ?? 0) > 0);
});

// --- constraint 1: no repeat, including the transpose ----------------------

test('a fact served in the last 4 items is never returned', () => {
  const model = deriveMastery([], CONFIG);
  const history = ['*:2x9', '*:5x5', '*:6x7', '*:9x4'];
  const blocked = new Set(history);

  for (const id of draw(model, history, NO_GOVERNOR, seededRng(31337), 4000)) {
    assert.ok(!blocked.has(id), `${id} was served inside the no-repeat window`);
  }
});

test('the TRANSPOSE of a fact served in the last 4 is never returned', () => {
  const model = deriveMastery([], CONFIG);
  const history = ['*:2x9', '*:5x4', '*:6x7', '*:10x3'];
  const blockedTransposes = new Set(['*:9x2', '*:4x5', SEVEN_SIX, '*:3x10']);

  for (const id of draw(model, history, NO_GOVERNOR, seededRng(2718), 4000)) {
    assert.ok(!blockedTransposes.has(id), `${id} is the transpose of a recent fact`);
  }
});

test('a symmetric fact blocks only itself and stays blocked', () => {
  // 5x5 is its own transpose; the exclusion must not misfire on it.
  const model = deriveMastery([], CONFIG);
  const history = ['*:5x5'];
  for (const id of draw(model, history, NO_GOVERNOR, seededRng(555), 2000)) {
    assert.notEqual(id, '*:5x5');
  }
});

test('a fact older than the no-repeat window becomes eligible again', () => {
  const model = deriveMastery([], CONFIG);
  // '*:1x2' sits 5 items back with noRepeatWithin === 4, so it is allowed.
  const history = ['*:1x2', '*:2x9', '*:5x4', '*:6x7', '*:10x3'];
  const counts = tally(draw(model, history, NO_GOVERNOR, seededRng(1234), 4000));

  assert.ok((counts.get('*:1x2') ?? 0) > 0, 'a fact past the window never resurfaced');
  assert.equal(counts.get('*:6x7') ?? 0, 0);
});

test('an empty history imposes no recency constraint', () => {
  const model = deriveMastery([], CONFIG);
  const counts = tally(draw(model, [], CONFIG, seededRng(8), 4000));
  assert.ok(counts.size > 100, `only ${counts.size} distinct facts appeared`);
});

// --- constraint 2: interference guard --------------------------------------

test('a confusion pair is not served adjacently while one of them is cold', () => {
  // 48 was typed for 6x7. 48 is the answer to 6x8 (and 8x6), so those are
  // confusion pairs with 6x7. 6x7 has no clean answer, so it is cold.
  const events = [...coldEvents(6, 7, [48]), ...warmEvents(6, 8), ...warmEvents(8, 6)];
  const model = deriveMastery(events, CONFIG);

  assert.equal(model.byId.get(SIX_SEVEN).bucket, 'cold');
  assert.equal(model.byId.get(SIX_EIGHT).bucket, 'warm');
  assert.ok(model.confusions.get(SIX_SEVEN).has(48));

  const counts = tally(draw(model, [SIX_SEVEN], NO_GOVERNOR, seededRng(60606), 5000));
  assert.equal(counts.get(SIX_EIGHT) ?? 0, 0, '6x8 followed cold 6x7');
  assert.equal(counts.get(EIGHT_SIX) ?? 0, 0, '8x6 followed cold 6x7');

  // Facts that are not confusion partners are unaffected.
  assert.ok((counts.get('*:9x9') ?? 0) > 0);
});

test('the guard fires in the other direction too — evidence on either fact counts', () => {
  // Here the wrong answer is recorded against 6x8 (42 typed for it), and 42 is
  // the answer to 6x7. The pair must be recognised from that side as well.
  const events = [...coldEvents(6, 8, [42]), ...warmEvents(6, 7)];
  const model = deriveMastery(events, CONFIG);

  assert.equal(model.byId.get(SIX_EIGHT).bucket, 'cold');
  const counts = tally(draw(model, [SIX_EIGHT], NO_GOVERNOR, seededRng(4004), 5000));
  assert.equal(counts.get(SIX_SEVEN) ?? 0, 0);
});

test('the guard lifts once both facts of the pair are warm or better', () => {
  // Same recorded confusion, but 6x7 now has a clean answer too, so it is warm.
  // The confusion record itself never ages out — the guard lifts on buckets.
  const events = [...coldEvents(6, 7, [48]), ...warmEvents(6, 7), ...warmEvents(6, 8)];
  const model = deriveMastery(events, CONFIG);

  assert.equal(model.byId.get(SIX_SEVEN).bucket, 'warm');
  assert.equal(model.byId.get(SIX_EIGHT).bucket, 'warm');
  assert.ok(model.confusions.get(SIX_SEVEN).has(48), 'confusion evidence must persist');

  const counts = tally(draw(model, [SIX_SEVEN], NO_GOVERNOR, seededRng(70707), 5000));
  assert.ok((counts.get(SIX_EIGHT) ?? 0) > 0, '6x8 stayed blocked after both went warm');
});

test('the guard only covers adjacency — a pair two items back is eligible', () => {
  const events = [...coldEvents(6, 7, [48]), ...warmEvents(6, 8)];
  const model = deriveMastery(events, CONFIG);

  const counts = tally(draw(model, [SIX_SEVEN, '*:2x3'], NO_GOVERNOR, seededRng(909), 5000));
  assert.ok((counts.get(SIX_EIGHT) ?? 0) > 0, '6x8 blocked when it was no longer adjacent');
});

test('facts with no recorded wrong answers are never treated as a pair', () => {
  const model = deriveMastery([], CONFIG);
  for (const stats of model.byId.values()) {
    assert.equal(stats.bucket, 'cold');
    assert.equal(model.confusions.get(stats.id).size, 0);
  }
  const counts = tally(draw(model, [SIX_SEVEN], NO_GOVERNOR, seededRng(17), 4000));
  assert.ok((counts.get(SIX_EIGHT) ?? 0) > 0);
});

// --- constraint 3: success governor ----------------------------------------

test('the governor forces a hot fact when the recent clean rate is below the floor', () => {
  const facts = allFacts();
  const events = [];
  const struggled = [];
  // Eight recent items, none answered cleanly => a clean rate of 0.
  for (let index = 0; index < 8; index += 1) {
    const fact = facts[index + 20];
    events.push(...coldEvents(fact.a, fact.b));
    struggled.push(factId(fact));
  }
  events.push(...hotEvents(3, 3), ...hotEvents(4, 4), ...hotEvents(9, 9));
  const model = deriveMastery(events, CONFIG);

  const ids = draw(model, struggled, CONFIG, seededRng(80808), 3000);
  for (const id of ids) {
    assert.equal(model.byId.get(id).bucket, 'hot', `${id} was served under the governor`);
  }
  assert.ok(tally(ids).size >= 2, 'the governor collapsed onto a single hot fact');
});

test('the governor stays out of the way when the recent clean rate is healthy', () => {
  const facts = allFacts();
  const events = [];
  const recent = [];
  for (let index = 0; index < 8; index += 1) {
    const fact = facts[index + 20];
    events.push(...warmEvents(fact.a, fact.b));
    recent.push(factId(fact));
  }
  events.push(...hotEvents(3, 3));
  const model = deriveMastery(events, CONFIG);

  const ids = draw(model, recent, CONFIG, seededRng(50505), 3000);
  const nonHot = ids.filter((id) => model.byId.get(id).bucket !== 'hot');
  assert.ok(nonHot.length > 0, 'the governor fired on a clean rate of 1.0');
});

test('the governor floor is a strict "below" — exactly at the floor does not fire', () => {
  const config = { ...CONFIG, governorWindow: 5 };
  const facts = allFacts();

  function modelAndHistory(cleanCount) {
    const events = [];
    const history = [];
    for (let index = 0; index < 5; index += 1) {
      const fact = facts[index + 30];
      events.push(
        index < cleanCount ? warmEvents(fact.a, fact.b)[0] : coldEvents(fact.a, fact.b)[0],
      );
      history.push(factId(fact));
    }
    events.push(...hotEvents(3, 3), ...hotEvents(4, 4));
    return { model: deriveMastery(events, config), history };
  }

  // 4 of 5 clean === 0.8 === the floor: not below it, so no forcing.
  const at = modelAndHistory(4);
  const atIds = draw(at.model, at.history, config, seededRng(3), 2000);
  assert.ok(atIds.some((id) => at.model.byId.get(id).bucket !== 'hot'));

  // 3 of 5 clean === 0.6: below the floor, so hot only.
  const below = modelAndHistory(3);
  const belowIds = draw(below.model, below.history, config, seededRng(3), 2000);
  for (const id of belowIds) {
    assert.equal(below.model.byId.get(id).bucket, 'hot');
  }
});

test('the governor does not fire when the window carries no scorable evidence', () => {
  // History ids the model has no retained attempts for — a fresh log, or items
  // that have aged out. Absent evidence is not bad evidence.
  const model = deriveMastery(hotEvents(3, 3), CONFIG);
  const history = ['*:2x9', '*:5x4', '*:10x3'];
  const ids = draw(model, history, CONFIG, seededRng(6), 2000);
  assert.ok(ids.some((id) => model.byId.get(id).bucket !== 'hot'));
});

test('a fact served twice in the window is scored against two separate attempts', () => {
  // 6x7 appears twice in the history; its two most recent retained attempts are
  // one clean and one not. Scoring the same attempt twice would give a rate of
  // 0 or 1 instead of 0.5, and 0.5 is below the floor either way — so the check
  // that bites is the healthy case: one clean plus one dirty across two facts.
  const events = [
    attempt(6, 7, 5000, 'reveal'),
    attempt(6, 7, 900, 'clean'),
    ...hotEvents(3, 3),
  ];
  const model = deriveMastery(events, CONFIG);
  const stats = model.byId.get(SIX_SEVEN);
  assert.deepEqual(
    stats.attempts.map((entry) => entry.stage),
    ['reveal', 'clean'],
  );

  // Window is [6x7, 6x7]: newest occurrence -> 'clean', older -> 'reveal'.
  // Rate 0.5 < 0.8, so the governor fires.
  const ids = draw(model, [SIX_SEVEN, SIX_SEVEN], CONFIG, seededRng(12), 1500);
  for (const id of ids) {
    assert.equal(model.byId.get(id).bucket, 'hot');
  }
});

test('only the last governorWindow items count toward the rate', () => {
  const facts = allFacts();
  const events = [];
  const history = [];
  // Ten bad items followed by eight clean ones: the window sees only the clean.
  for (let index = 0; index < 10; index += 1) {
    const fact = facts[index + 40];
    events.push(...coldEvents(fact.a, fact.b));
    history.push(factId(fact));
  }
  for (let index = 0; index < 8; index += 1) {
    const fact = facts[index + 60];
    events.push(...warmEvents(fact.a, fact.b));
    history.push(factId(fact));
  }
  events.push(...hotEvents(3, 3));
  const model = deriveMastery(events, CONFIG);

  const ids = draw(model, history, CONFIG, seededRng(64), 2000);
  assert.ok(ids.some((id) => model.byId.get(id).bucket !== 'hot'));
});

// --- relaxation: never undefined -------------------------------------------

test('returns a valid fact when the no-repeat window covers the whole fact space', () => {
  const model = deriveMastery([], CONFIG);
  const config = { ...CONFIG, noRepeatWithin: 500 };
  const history = allFacts().map(factId);
  const known = new Set(history);

  const rng = seededRng(777);
  for (let index = 0; index < 300; index += 1) {
    const fact = pickNext(model, history, config, rng);
    assert.notEqual(fact, undefined);
    assert.ok(known.has(factId(fact)));
  }
});

test('returns a valid fact when the governor demands hot and nothing is hot', () => {
  // Every fact cold and every recent item dirty: the governor wants a hot fact,
  // the fact space has none, and the history blocks everything. All three
  // constraints have to relax, in order, and a fact still comes out.
  const events = allFacts().flatMap((fact) => coldEvents(fact.a, fact.b, [fact.a * fact.b + 1]));
  const model = deriveMastery(events, CONFIG);
  const config = { ...CONFIG, noRepeatWithin: 500 };
  const history = allFacts().map(factId);
  const known = new Set(history);

  const rng = seededRng(31);
  for (let index = 0; index < 300; index += 1) {
    const fact = pickNext(model, history, config, rng);
    assert.notEqual(fact, undefined);
    assert.ok(known.has(factId(fact)));
  }
});

test('relaxes the governor before the confusion guard', () => {
  // Nothing is hot, so the governor cannot be satisfied. The confusion guard
  // must still hold: 6x8 stays blocked behind cold 6x7.
  const events = [...coldEvents(6, 7, [48]), ...warmEvents(6, 8)];
  const model = deriveMastery(events, CONFIG);

  const counts = tally(draw(model, [SIX_SEVEN], CONFIG, seededRng(2), 4000));
  assert.equal(counts.get(SIX_EIGHT) ?? 0, 0);
  assert.equal(counts.get(EIGHT_SIX) ?? 0, 0);
  assert.equal(counts.get(SIX_SEVEN) ?? 0, 0, 'no-repeat must survive too');
  assert.ok(counts.size > 50);
});

test('relaxes the confusion guard before no-repeat', () => {
  // A two-fact world: 0x0 and 1x1, mutually blocked by a confusion pair while
  // one is cold. With everything else excluded by recency, the confusion guard
  // has to give way while the no-repeat window still keeps the last item out.
  const events = [
    ...coldEvents(0, 0, [1]), // wrong answer 1 === the answer to 1x1
    ...warmEvents(1, 1),
  ];
  const model = deriveMastery(events, CONFIG);
  const config = { ...CONFIG, noRepeatWithin: 500, governorFloor: 0 };

  const history = allFacts()
    .map(factId)
    .filter((id) => id !== '*:0x0' && id !== '*:1x1');
  history.push('*:0x0');

  const rng = seededRng(19);
  for (let index = 0; index < 200; index += 1) {
    // Only 1x1 survives once the confusion guard relaxes but no-repeat holds.
    assert.equal(factId(pickNext(model, history, config, rng)), '*:1x1');
  }
});

// --- purity ----------------------------------------------------------------

test('pickNext mutates neither model, history, nor config', () => {
  const events = [
    ...coldEvents(6, 7, [48]),
    ...warmEvents(6, 8),
    ...hotEvents(3, 3),
    ...hotEvents(4, 4),
    ...warmEvents(9, 2),
    ...coldEvents(7, 8, [54]),
  ];
  const model = deriveMastery(events, CONFIG);
  const history = [SIX_SEVEN, '*:3x3', '*:9x2', '*:7x8', '*:4x4'];
  const config = { ...CONFIG };

  const modelBefore = structuredClone(model);
  const historyBefore = structuredClone(history);
  const configBefore = structuredClone(config);

  const rng = seededRng(4321);
  for (let index = 0; index < 400; index += 1) {
    pickNext(model, history, config, rng);
  }

  assert.deepEqual(model, modelBefore);
  assert.deepEqual(history, historyBefore);
  assert.deepEqual(config, configBefore);
});

test('the returned fact is a fresh object, not the model’s own', () => {
  const model = deriveMastery([], CONFIG);
  const fact = pickNext(model, [], CONFIG, seededRng(5));
  const stats = model.byId.get(factId(fact));

  assert.notEqual(fact, stats.fact);
  assert.deepEqual(fact, stats.fact);

  fact.a = 99;
  assert.notEqual(model.byId.get(stats.id).fact.a, 99);
});
