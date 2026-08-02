// Learn session builder — fact selection and session shape.
//
// Two properties carry the mode's design and are asserted exhaustively rather
// than by example, because both would fail silently in the running game:
//
//   - a picked fact ALWAYS has strategy text, which is what keeps `0 x n` and
//     `1 x n` out of learn mode by construction. A learn session that filled up
//     with freebies would look fine on screen and teach nothing.
//   - selection is DETERMINISTIC. This module takes no randomness, so the same
//     model must always yield the same facts in the same order.
//
// Models are built here by hand rather than derived from a log. `deriveMastery`
// is a different module's contract; what this one actually consumes is
// `model.byId.get(id).bucket`, and constructing that directly lets a test place
// a fact in an exact bucket without reverse-engineering thresholds.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pickLearnFacts, buildLearnSession, isLearnable } from '../js/learn.js';
import { deriveMastery } from '../js/mastery.js';
import { allFacts, factId, answerOf } from '../js/facts.js';
import { strategyFor } from '../js/strategies.js';
import { CONFIG } from '../js/config.js';

// --- helpers ---------------------------------------------------------------

/**
 * A total mastery model, all 121 facts present, with each fact's bucket decided
 * by `bucketOf(fact)` and `taught` by `taughtOf(fact)`. Only the fields learn.js
 * reads are populated.
 */
function modelWith(bucketOf, taughtOf = () => false) {
  const byId = new Map();
  for (const fact of allFacts()) {
    const id = factId(fact);
    byId.set(id, {
      id,
      fact,
      bucket: bucketOf(fact),
      taught: taughtOf(fact),
      attempts: [],
      cleanCount: 0,
      medianCleanMs: null,
    });
  }
  return { byId, confusions: new Map() };
}

const allCold = () => modelWith(() => 'cold');
const allHot = () => modelWith(() => 'hot');

const isEligible = (fact) => strategyFor(fact) !== null;
const eligibleFacts = () => allFacts().filter(isEligible);

/** A learn-mode attempt event, as engine.toAttemptEvent writes one. */
function learnAttempt(fact) {
  return {
    type: 'attempt',
    t: '2026-08-01T15:04:05.123Z',
    build: CONFIG.build,
    session: 's_learn',
    op: '*',
    a: fact.a,
    b: fact.b,
    ms: 3200,
    stage: 'strategy',
    typed: String(answerOf(fact)).split(''),
    wrong: [],
    mode: 'learn',
    revealed: false,
  };
}

const label = (fact) => `${fact.a}x${fact.b}`;

/** Every field learn.js reads, snapshotted as a plain array, for mutation checks. */
const bucketSnapshot = (model) =>
  [...model.byId.entries()].map(([id, stats]) => `${id}:${stats.bucket}:${stats.taught}`);

// --- eligibility -----------------------------------------------------------

test('exactly 81 of the 121 facts are eligible for learn mode', () => {
  // The spec's number. If this moves, the strategy table moved, and the
  // "trivial facts cannot enter learn mode" guarantee needs re-reading.
  assert.equal(allFacts().length, 121);
  assert.equal(eligibleFacts().length, 81);
  assert.equal(allFacts().filter(isLearnable).length, 81);
});

test('isLearnable agrees exactly with having strategy text', () => {
  for (const fact of allFacts()) {
    assert.equal(
      isLearnable(fact),
      strategyFor(fact) !== null,
      `isLearnable disagrees with strategyFor on ${label(fact)}`,
    );
  }
});

test('isLearnable admits exactly the facts pickLearnFacts is willing to return', () => {
  // The point of exporting the predicate: a consumer computing `canLearn` from
  // isLearnable must not be able to promise a fact the picker would refuse, nor
  // refuse one the picker would offer.
  //
  // Forward: everything picked is learnable — checked here across every bucket
  // arrangement, and exhaustively in the sweep below.
  // Backward: every learnable fact IS reachable — make it the sole cold-untaught
  // fact in an otherwise hot model and confirm it comes back first.
  for (const fact of allFacts()) {
    const id = factId(fact);
    const model = modelWith((f) => (factId(f) === id ? 'cold' : 'hot'));
    const picked = pickLearnFacts(model, { ...CONFIG, learnFacts: 1 });

    assert.ok(picked.every(isLearnable));
    if (isLearnable(fact)) {
      assert.equal(label(picked[0]), label(fact), `${label(fact)} is unreachable`);
    } else {
      assert.notEqual(label(picked[0]), label(fact), `${label(fact)} is not learnable`);
    }
  }
});

test('never picks a fact without strategy text, whichever fact is coldest', () => {
  // Exhaustive: make each fact in turn the only cold one, everything else hot.
  // If the strategy filter were ever dropped, a trivial fact singled out as
  // cold would be picked first and this fails on that iteration.
  for (const target of allFacts()) {
    const targetId = factId(target);
    const model = modelWith((fact) => (factId(fact) === targetId ? 'cold' : 'hot'));
    const picked = pickLearnFacts(model, CONFIG);

    for (const fact of picked) {
      assert.notEqual(
        strategyFor(fact),
        null,
        `picked ${label(fact)} (no strategy) when ${label(target)} was cold`,
      );
    }
  }
});

test('never picks a 0x or 1x fact, in any bucket arrangement', () => {
  const arrangements = [
    allCold(),
    allHot(),
    modelWith(() => 'warm'),
    // Trivial facts cold, everything else hot: the arrangement that would most
    // tempt a selector that only looked at temperature.
    modelWith((fact) => (fact.a <= 1 || fact.b <= 1 ? 'cold' : 'hot')),
  ];

  for (const model of arrangements) {
    for (const fact of pickLearnFacts(model, CONFIG)) {
      assert.ok(fact.a >= 2 && fact.b >= 2, `picked trivial fact ${label(fact)}`);
    }
  }
});

// --- selection -------------------------------------------------------------

test('returns exactly learnFacts when enough eligible facts exist', () => {
  const picked = pickLearnFacts(allCold(), CONFIG);
  assert.equal(picked.length, CONFIG.learnFacts);
});

test('a fresh model opens with the HARDEST facts, never with 2x2', () => {
  // The regression this ordering exists for. On a fresh log every fact is
  // equally cold, so rank does not discriminate and difficulty decides alone.
  // Without it selection falls through to allFacts() order and opens 2x2, 2x3,
  // 2x4 — the three easiest facts in the table, in a mode whose entire job is
  // the hard ones.
  const picked = pickLearnFacts(allCold(), CONFIG).map(label);

  // 7x7 leads: difficulty 5+5 = 10, the highest score in the table. It was
  // unteachable until strategy text was added for the three squares.
  assert.deepEqual(picked, ['7x7', '6x7', '7x6']);
  assert.ok(!picked.includes('2x2'), 'learn mode must not open on 2x2');

  // Every picked fact is from the no-pattern-hook set: both operands in
  // {6,7,8,9}, the part of the table with nothing to lever off.
  for (const fact of pickLearnFacts(allCold(), CONFIG)) {
    assert.ok(fact.a >= 6 && fact.b >= 6, `${label(fact)} is not a hard fact`);
  }
});

test('difficulty ranks by pattern support, not by product size', () => {
  // The x10 row holds the biggest products in the set and is the easiest thing
  // in it. A product-descending sort would open with 10x9; this asserts it does
  // not, and that the x2 and x10 rows sit below the 6-8 block.
  const order = pickLearnFacts(allCold(), { ...CONFIG, learnFacts: 81 }).map(label);
  const rank = (name) => order.indexOf(name);

  assert.ok(rank('7x8') < rank('10x9'), 'x10 must not outrank 7x8');
  assert.ok(rank('6x7') < rank('2x9'), 'doubling is easier than 6x7');
  assert.ok(rank('7x8') < rank('9x8'), 'ten-minus-one is a hook, 7 is not');
  assert.ok(rank('3x8') < rank('5x8'), 'half-of-ten is easier than double-and-add');
  assert.equal(order.length, 81, 'every learnable fact is ordered, none dropped');
});

test('difficulty ordering is deterministic, ties in allFacts() order', () => {
  const first = pickLearnFacts(allCold(), { ...CONFIG, learnFacts: 81 }).map(label);
  const second = pickLearnFacts(allCold(), { ...CONFIG, learnFacts: 81 }).map(label);
  assert.deepEqual(first, second);

  // 6x7 and 7x6 are equally hard and equally cold. The tie-break is table
  // order, which puts the smaller `a` first — and it must not wobble.
  assert.ok(first.indexOf('6x7') < first.indexOf('7x6'));
  assert.ok(first.indexOf('3x7') < first.indexOf('7x3'));
});

test('cold-and-untaught outranks cold-and-taught', () => {
  // Every fact cold; the three hardest already taught. They must step aside for
  // untaught facts even though nothing about their temperature changed.
  const taught = new Set(['*:7x7', '*:6x7', '*:7x6']);
  const model = modelWith(
    () => 'cold',
    (fact) => taught.has(factId(fact)),
  );

  const picked = pickLearnFacts(model, CONFIG).map(label);
  assert.deepEqual(picked, ['7x8', '8x7', '3x7']);
  for (const name of ['7x7', '6x7', '7x6']) {
    assert.ok(!picked.includes(name), `${name} was already taught`);
  }
});

test('a taught cold fact still outranks any warm or hot fact', () => {
  // Rank 2 is not exile. Once the untaught facts are exhausted, a fact shown
  // once but never drilled comes back round — before anything warmer does.
  const model = modelWith(
    (fact) => (factId(fact) === '*:6x7' ? 'cold' : 'warm'),
    () => true,
  );

  assert.equal(label(pickLearnFacts(model, CONFIG)[0]), '6x7');
});

test('a second learn session does not repeat the first one', () => {
  // The bug this ordering fixes, reproduced end to end. Learn attempts are
  // excluded from mastery by design, so a re-derived model is unchanged in
  // bucket terms and a purely temperature-based picker hands back the identical
  // three facts every session, indefinitely. `taught` is what breaks the loop.
  const events = [];
  const first = pickLearnFacts(deriveMastery(events, CONFIG), CONFIG);

  // Play the whole session: every fact, every pass.
  for (const fact of buildLearnSession(first, CONFIG)) {
    events.push(learnAttempt(fact));
  }

  const model = deriveMastery(events, CONFIG);
  const second = pickLearnFacts(model, CONFIG);

  // The buckets genuinely did not move — this is not a test of mastery drifting.
  for (const fact of first) {
    assert.equal(model.byId.get(factId(fact)).bucket, 'cold');
    assert.equal(model.byId.get(factId(fact)).taught, true);
  }

  assert.equal(second.length, CONFIG.learnFacts);
  for (const fact of second) {
    assert.ok(
      !first.some((seen) => factId(seen) === factId(fact)),
      `${label(fact)} was taught last session and came straight back`,
    );
  }
});

test('successive learn sessions keep advancing through the table', () => {
  // Six sessions, no repeats anywhere: the loop is broken for good, not just
  // for one round.
  const events = [];
  const seen = new Set();

  for (let session = 0; session < 6; session += 1) {
    const picked = pickLearnFacts(deriveMastery(events, CONFIG), CONFIG);
    assert.equal(picked.length, CONFIG.learnFacts);

    for (const fact of picked) {
      assert.ok(!seen.has(factId(fact)), `${label(fact)} repeated in session ${session}`);
      seen.add(factId(fact));
    }
    for (const fact of buildLearnSession(picked, CONFIG)) {
      events.push(learnAttempt(fact));
    }
  }

  assert.equal(seen.size, 18);
});

test('prefers cold over warm over hot', () => {
  // 9x9 is eligible and sits near the END of allFacts() order, so it is only
  // picked first if temperature beats position. 2x2 is eligible and first.
  const model = modelWith((fact) => {
    if (fact.a === 9 && fact.b === 9) return 'cold';
    if (fact.a === 1 && fact.b === 8) return 'cold'; // ineligible: trivial operand
    if (fact.a === 2 && fact.b === 2) return 'warm';
    return 'hot';
  });

  const picked = pickLearnFacts(model, CONFIG);
  assert.equal(picked.length, 3);
  assert.equal(label(picked[0]), '9x9', 'the only eligible cold fact must lead');
  assert.equal(label(picked[1]), '2x2', 'the warm fact must beat every hot one');
  assert.equal(
    model.byId.get(factId(picked[2])).bucket,
    'hot',
    'only after warm is exhausted may a hot fact be picked',
  );
});

test('takes every cold eligible fact before any warm one', () => {
  // Two cold, one warm, rest hot — with the warm fact earlier in allFacts()
  // order than both cold ones, so position cannot explain the result.
  const cold = new Set(['*:7x8', '*:9x9']);
  const model = modelWith((fact) => {
    if (cold.has(factId(fact))) return 'cold';
    if (factId(fact) === '*:2x2') return 'warm';
    return 'hot';
  });

  assert.deepEqual(pickLearnFacts(model, CONFIG).map(label), ['7x8', '9x9', '2x2']);
});

test('falls back through warm to hot rather than returning short', () => {
  // Every eligible fact hot: the session must still be startable.
  const picked = pickLearnFacts(allHot(), CONFIG);
  assert.equal(picked.length, CONFIG.learnFacts);
  assert.ok(picked.every(isEligible));
});

test('returns fewer only when eligible facts run out', () => {
  // learnFacts beyond the eligible set: 81 back, not 121, and no duplicates.
  const config = { ...CONFIG, learnFacts: 200 };
  const picked = pickLearnFacts(allCold(), config);

  assert.equal(picked.length, 81);
  assert.equal(new Set(picked.map(factId)).size, 81);
  assert.ok(picked.every(isEligible));
});

test('returns nothing when learnFacts is zero', () => {
  assert.deepEqual(pickLearnFacts(allCold(), { ...CONFIG, learnFacts: 0 }), []);
});

test('picks distinct facts, whatever the rank mix', () => {
  // Selection walks the eligible list once per rank, so overlapping rank
  // predicates would serve the same fact twice in one session. The mixed-taught
  // arrangements below are the ones that expose it: a cold fact matching both
  // "cold and untaught" and a loosely-written "cold".
  const arrangements = [
    allCold(),
    allHot(),
    modelWith(() => 'warm'),
    modelWith(() => 'cold', (fact) => fact.a % 2 === 0),
    modelWith(() => 'cold', () => true),
    modelWith((fact) => (fact.a > 8 ? 'cold' : 'hot'), (fact) => fact.b > 8),
  ];

  for (const model of arrangements) {
    const picked = pickLearnFacts(model, { ...CONFIG, learnFacts: 81 });
    assert.equal(new Set(picked.map(factId)).size, picked.length, 'duplicate pick');
    assert.equal(picked.length, 81, 'every learnable fact must be offered once');
  }
});

test('is deterministic: the same model twice gives the same facts in order', () => {
  const model = modelWith((fact) => {
    if ((fact.a * fact.b) % 3 === 0) return 'cold';
    if ((fact.a * fact.b) % 3 === 1) return 'warm';
    return 'hot';
  });

  const first = pickLearnFacts(model, CONFIG);
  const second = pickLearnFacts(model, CONFIG);
  assert.deepEqual(first, second);

  // And across two separately-built but identical models — no hidden state
  // carried between calls, in this module or in facts.js.
  const rebuilt = modelWith((fact) => model.byId.get(factId(fact)).bucket);
  assert.deepEqual(pickLearnFacts(rebuilt, CONFIG), first);
});

test('works against a real derived model', () => {
  // An empty log derives 121 cold facts; learn mode must be startable on a
  // first-ever session, which is the case it exists for.
  const model = deriveMastery([], CONFIG);
  const picked = pickLearnFacts(model, CONFIG);

  assert.equal(picked.length, CONFIG.learnFacts);
  assert.ok(picked.every(isEligible));
});

// --- session shape ---------------------------------------------------------

test('session length is learnFacts * learnPasses', () => {
  const facts = pickLearnFacts(allCold(), CONFIG);
  const session = buildLearnSession(facts, CONFIG);
  assert.equal(session.length, CONFIG.learnFacts * CONFIG.learnPasses);
  assert.equal(session.length, 12);
});

test('cycles A B C A B C, it does not block A A A A B B B B', () => {
  const facts = pickLearnFacts(allCold(), CONFIG);
  const session = buildLearnSession(facts, CONFIG);
  const names = facts.map(label);

  assert.deepEqual(
    session.map(label),
    [...names, ...names, ...names, ...names],
  );

  // Stated the other way round, so a future rewrite cannot satisfy the shape
  // test by accident: no item is ever immediately followed by itself.
  for (let i = 1; i < session.length; i += 1) {
    assert.notEqual(
      label(session[i]),
      label(session[i - 1]),
      `item ${i} repeats ${label(session[i])} back to back`,
    );
  }
});

test('every distinct fact appears exactly learnPasses times', () => {
  const facts = pickLearnFacts(allCold(), CONFIG);
  const session = buildLearnSession(facts, CONFIG);

  for (const fact of facts) {
    const seen = session.filter((item) => factId(item) === factId(fact)).length;
    assert.equal(seen, CONFIG.learnPasses, `${label(fact)} shown ${seen} times`);
  }
});

test('session handles the degenerate inputs without special-casing', () => {
  assert.deepEqual(buildLearnSession([], CONFIG), []);
  assert.deepEqual(buildLearnSession(allFacts().slice(0, 2), { learnPasses: 0 }), []);

  const one = [{ op: '*', a: 6, b: 7 }];
  assert.deepEqual(buildLearnSession(one, { learnPasses: 3 }).map(label), [
    '6x7',
    '6x7',
    '6x7',
  ]);
});

// --- purity ----------------------------------------------------------------

test('pickLearnFacts mutates neither model nor config', () => {
  const model = modelWith((fact) => (fact.b % 2 === 0 ? 'cold' : 'hot'));
  const config = { ...CONFIG };

  const buckets = bucketSnapshot(model);
  const size = model.byId.size;
  const configBefore = JSON.stringify(config);

  pickLearnFacts(model, config);

  assert.deepEqual(bucketSnapshot(model), buckets);
  assert.equal(model.byId.size, size);
  assert.equal(JSON.stringify(config), configBefore);
});

test('buildLearnSession mutates neither its facts array nor config', () => {
  const facts = pickLearnFacts(allCold(), CONFIG);
  const factsBefore = JSON.stringify(facts);
  const config = { ...CONFIG };
  const configBefore = JSON.stringify(config);

  const session = buildLearnSession(facts, config);

  assert.equal(JSON.stringify(facts), factsBefore);
  assert.equal(JSON.stringify(config), configBefore);
  assert.notEqual(session, facts, 'must return a new array');
});

test('the returned facts are not shared state between calls', () => {
  // Mutating a returned fact must not corrupt the next call's answer — the
  // facts come from a fresh allFacts() each time.
  const first = pickLearnFacts(allCold(), CONFIG);
  first[0].a = 99;

  assert.deepEqual(pickLearnFacts(allCold(), CONFIG).map(label), [
    '7x7',
    '6x7',
    '7x6',
  ]);
});

test('a model predating the taught field still yields a full learn session', () => {
  // V2-Review-W1 SMALL 4 — surviving mutation. The rank predicate is
  // `taught !== true`, not `taught === false`, precisely so a FactStats without
  // the field ranks as untaught. Under `=== false` such a fact matches neither
  // cold rank and then fails warm and hot too, and the session comes back EMPTY.
  const legacy = { byId: new Map(), confusions: new Map() };
  for (const f of allFacts()) {
    const id = factId(f);
    legacy.byId.set(id, {
      id, fact: f, bucket: 'cold', attempts: [], cleanCount: 0, medianCleanMs: null,
      // no `taught` key at all
    });
    legacy.confusions.set(id, new Set());
  }
  const picked = pickLearnFacts(legacy, CONFIG);
  assert.equal(picked.length, CONFIG.learnFacts, 'a legacy model must not yield an empty session');
  assert.deepEqual(picked.map((f) => `${f.a}x${f.b}`), ['7x7', '6x7', '7x6']);
});
