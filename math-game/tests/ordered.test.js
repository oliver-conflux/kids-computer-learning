// Ordered mode's rows, runs and per-table progress.
//
// Two properties carry the mode's design and both would fail SILENTLY in the
// running game — a run of the wrong length is still a playable run:
//
//   - peeling is PREFIX-ONLY. A cleared fact in the middle of a row stays in the
//     run. An implementation that filters instead of trimming passes every
//     example where the cleared facts happen to sit at the front, which is what
//     most models look like, and destroys the ordering the moment they do not.
//   - `tableProgress` and `runFor` READ THE SAME MODEL and must not disagree.
//     They are asserted against each other across all nine tables rather than by
//     example, because the disagreement would be one table wide.
//
// Models are built here BY HAND, with `ordered.cleared` set directly, rather
// than derived from an event log. `deriveMastery` is a different module's
// contract; what this one consumes is one boolean per fact, and constructing it
// directly lets a test place a fact in an exact state without reverse-
// engineering the rung rules. tests/learn.test.js does the same, for the same
// reason.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tableRow, runFor, tableProgress, isTable } from '../js/ordered.js';
import { allFacts, factId } from '../js/facts.js';

// --- helpers ---------------------------------------------------------------

/**
 * A total mastery model, all 121 facts present, with each fact's ordered rung
 * cleared according to `clearedOf(fact)`. Only the field ordered.js reads is
 * populated with anything interesting.
 */
function modelWith(clearedOf) {
  const byId = new Map();
  for (const fact of allFacts()) {
    const id = factId(fact);
    const cleared = clearedOf(fact);
    byId.set(id, {
      id,
      fact,
      bucket: 'cold',
      ordered: { attempts: cleared ? 2 : 0, unaided: cleared ? 2 : 0, cleared },
      learn: { attempts: 0, unaided: 0, cleared: false },
    });
  }
  return { byId, confusions: new Map() };
}

const nothingCleared = () => modelWith(() => false);
const everythingCleared = () => modelWith(() => true);

/** `[b, b, ...]` for a run or a row, which is how these read at a glance. */
const bs = (facts) => facts.map((fact) => fact.b);

// --- rows ------------------------------------------------------------------

test('a table is the eleven facts n x 0 .. n x 10, ascending', () => {
  const row = tableRow(2);
  assert.equal(row.length, 11);
  assert.deepEqual(bs(row), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const fact of row) {
    assert.equal(fact.a, 2, `${factId(fact)} is not in the 2s`);
    assert.equal(fact.op, '*');
  }
});

test('a is fixed and b varies, for every table', () => {
  // "The 2s" is 2x0 .. 2x10, never 0x2 .. 10x2. The transposed row is a
  // different set of eleven facts with eleven separate histories.
  for (let n = 2; n <= 10; n += 1) {
    const row = tableRow(n);
    assert.deepEqual(bs(row), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], `the ${n}s`);
    assert.ok(
      row.every((fact) => fact.a === n),
      `the ${n}s has a fact from another row`,
    );
  }
});

// --- runs ------------------------------------------------------------------

test('with nothing cleared the run is the whole row', () => {
  assert.deepEqual(runFor(nothingCleared(), 2), tableRow(2));
});

test('a cleared prefix peels off the front', () => {
  const model = modelWith((fact) => fact.a === 2 && fact.b <= 2);
  const run = runFor(model, 2);
  assert.equal(run.length, 8);
  assert.deepEqual(bs(run), [3, 4, 5, 6, 7, 8, 9, 10]);
});

test('peeling is prefix-only: a cleared fact in the middle stays in the run', () => {
  // 2x0 .. 2x4 and 2x7 have cleared; 2x5 has not. The run starts at 2x5 and
  // STILL CONTAINS 2x7.
  //
  // This is the test that stops someone implementing a filter. Filtering would
  // give a six-fact run of 5, 6, 8, 9, 10 — shorter, and with a hole in it. The
  // ordering is the only thing this mode sells: "how far in am I" stops being
  // answerable the moment the run no longer matches the table.
  const cleared = new Set([0, 1, 2, 3, 4, 7]);
  const model = modelWith((fact) => fact.a === 2 && cleared.has(fact.b));
  const run = runFor(model, 2);

  assert.deepEqual(bs(run), [5, 6, 7, 8, 9, 10]);
  assert.equal(run.length, 6);
  assert.ok(
    run.some((fact) => fact.b === 7),
    '2x7 was plucked out of the middle',
  );
});

test('a fully cleared table has an empty run', () => {
  // Which is what makes the row unstartable on the menu. A session with nothing
  // in it is the failure the canLearn guard already exists to prevent.
  assert.deepEqual(runFor(everythingCleared(), 2), []);
});

test('clearing one table does not shorten another', () => {
  const model = modelWith((fact) => fact.a === 2);
  assert.deepEqual(runFor(model, 2), []);
  assert.deepEqual(runFor(model, 3), tableRow(3));
});

// --- progress --------------------------------------------------------------

test('tableProgress covers tables 2 through 10, ascending, and nothing else', () => {
  // The 0s and the 1s are not tables. They are trivia — 21 of the 121 facts —
  // and they are reachable through drill only. "Every table is done" and "the
  // grid is complete" are different statements.
  const progress = tableProgress(nothingCleared());
  assert.deepEqual(
    progress.map((row) => row.table),
    [2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  for (const row of progress) {
    assert.equal(row.total, 11, `the ${row.table}s`);
    assert.equal(row.cleared, 0, `the ${row.table}s`);
  }
});

test('tableProgress counts every cleared fact in the row, gaps included', () => {
  const cleared = new Set([0, 1, 2, 3, 4, 7]);
  const model = modelWith((fact) => fact.a === 2 && cleared.has(fact.b));
  const twos = tableProgress(model).find((row) => row.table === 2);

  // Six cleared, but the run is still six long: 2x7 has cleared and has not
  // peeled. `cleared` is a count of the ROW, not a measure of the run.
  assert.equal(twos.cleared, 6);
  assert.equal(runFor(model, 2).length, 6);
});

test('tableProgress and runFor agree, for all nine tables, on one model', () => {
  // Two functions reading one model. Asserted exhaustively rather than by
  // example: a disagreement would be one table wide and invisible everywhere
  // else. The shape below gives every row a different prefix length, puts a gap
  // at b = 9 in all of them, and finishes the 10s outright.
  const model = modelWith((fact) => fact.a === 10 || fact.b < fact.a - 2 || fact.b === 9);

  for (const { table, cleared, total } of tableProgress(model)) {
    const row = tableRow(table);
    const run = runFor(model, table);
    const label = `the ${table}s`;

    assert.equal(total, row.length, label);

    // The run is a SUFFIX of the row — same facts, same order, front trimmed.
    assert.deepEqual(run, row.slice(row.length - run.length), label);

    // Empty run and finished table are the same statement in both directions.
    assert.equal(run.length === 0, cleared === total, label);

    // Everything ahead of the run has cleared, so the count is at least the
    // peeled prefix — and strictly more when a gap survives in the middle.
    assert.ok(cleared >= total - run.length, label);

    const isCleared = (fact) => model.byId.get(factId(fact)).ordered.cleared;
    assert.ok(
      row.slice(0, row.length - run.length).every(isCleared),
      `${label}: peeled a fact that has not cleared`,
    );
    if (run.length > 0) {
      assert.ok(!isCleared(run[0]), `${label}: the run starts on a cleared fact`);
    }
  }
});

// --- which numbers are tables ---------------------------------------------

test('isTable accepts 2 through 10 and nothing else', () => {
  // The URL is the only caller. A typo in a bookmark must not start a run over
  // a row that does not exist, and `?table=1.5` must not become the 1s.
  for (let n = 2; n <= 10; n += 1) {
    assert.equal(isTable(n), true, `${n}`);
  }
  for (const n of [0, 1, 11, -2, 2.5, NaN, Infinity, '2', null, undefined]) {
    assert.equal(isTable(n), false, `${String(n)}`);
  }
});
