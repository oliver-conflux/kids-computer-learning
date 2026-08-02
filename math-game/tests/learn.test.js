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

import { pickLearnFacts, buildLearnSession } from '../js/learn.js';
import { deriveMastery } from '../js/mastery.js';
import { allFacts, factId } from '../js/facts.js';
import { strategyFor } from '../js/strategies.js';
import { CONFIG } from '../js/config.js';

// --- helpers ---------------------------------------------------------------

/**
 * A total mastery model, all 121 facts present, with each fact's bucket decided
 * by `bucketOf(fact)`. Only the fields learn.js reads are populated.
 */
function modelWith(bucketOf) {
  const byId = new Map();
  for (const fact of allFacts()) {
    const id = factId(fact);
    byId.set(id, {
      id,
      fact,
      bucket: bucketOf(fact),
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

const label = (fact) => `${fact.a}x${fact.b}`;

/** Buckets snapshotted as a plain array, for mutation checks. */
const bucketSnapshot = (model) =>
  [...model.byId.entries()].map(([id, stats]) => `${id}:${stats.bucket}`);

// --- eligibility -----------------------------------------------------------

test('exactly 78 of the 121 facts are eligible for learn mode', () => {
  // The spec's number. If this moves, the strategy table moved, and the
  // "trivial facts cannot enter learn mode" guarantee needs re-reading.
  assert.equal(allFacts().length, 121);
  assert.equal(eligibleFacts().length, 78);
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

test('picks the eligible facts in allFacts() order when all are equally cold', () => {
  // The documented tie-break. 2x2, 2x3, 2x4 are the first three eligible facts
  // row-major: everything with a 0 or 1 operand is filtered out ahead of them.
  const picked = pickLearnFacts(allCold(), CONFIG);
  assert.deepEqual(
    picked.map(label),
    ['2x2', '2x3', '2x4'],
  );
});

test('prefers cold over warm over hot', () => {
  // 9x9 is eligible and sits near the END of allFacts() order, so it is only
  // picked first if temperature beats position. 2x2 is eligible and first.
  const model = modelWith((fact) => {
    if (fact.a === 9 && fact.b === 9) return 'cold';
    if (fact.a === 8 && fact.b === 8) return 'cold'; // ineligible: a square
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
  // learnFacts beyond the eligible set: 78 back, not 121, and no duplicates.
  const config = { ...CONFIG, learnFacts: 200 };
  const picked = pickLearnFacts(allCold(), config);

  assert.equal(picked.length, 78);
  assert.equal(new Set(picked.map(factId)).size, 78);
  assert.ok(picked.every(isEligible));
});

test('returns nothing when learnFacts is zero', () => {
  assert.deepEqual(pickLearnFacts(allCold(), { ...CONFIG, learnFacts: 0 }), []);
});

test('picks distinct facts', () => {
  for (const model of [allCold(), allHot(), modelWith(() => 'warm')]) {
    const picked = pickLearnFacts(model, CONFIG);
    assert.equal(new Set(picked.map(factId)).size, picked.length);
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
    '2x2',
    '2x3',
    '2x4',
  ]);
});
