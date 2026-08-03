// "In order" — the rows of the table, which facts a run serves, and how far
// each row has got.
//
// This module answers the only two questions that shape an ordered session —
// WHICH facts and IN WHAT ORDER — and nothing else, the same division of labour
// learn.js has. It renders nothing, logs nothing and scores nothing.
//
// THE ORDER NEVER VARIES. `2x0, 2x1, 2x2 ...` ascending, every visit, and THE
// SCHEDULER PLAYS NO PART: `pickNext` is not called, nothing is weighted by
// bucket, nothing is shuffled, and no missed fact is re-inserted later in the
// same run. That is the whole mode. A kid marching a table is buying a sense of
// place — where she is, how far in, what is coming — and every one of those
// mechanisms, all of which are right for drill, would take it away.
//
// PEELING IS PREFIX-ONLY. The run starts at the first fact in the row whose
// ordered rung has not cleared, and runs to the end. GAPS SURVIVE: if `2x7` has
// cleared and `2x5` has not, the run starts at `2x5` and still contains `2x7`.
// Only the front moves.
//
// Plucking cleared facts out of the middle is the obvious optimisation and it is
// wrong. It would shorten the run faster and destroy the ordering, which is the
// one thing the mode sells — the progress bar counts the run, so `6 of 7` means
// what it says only while the run is a contiguous tail of the table. See spec
// §4.
//
// Peeling is not a special case, and there is no second notion of knowing here:
// it is the ordered rung from js/mastery.js, applied to a row. That rung is the
// WEAKEST of the three (the strategy is on screen and she knows the last one was
// `2x6`, so context is carrying her), which is exactly why it is allowed to be
// permanent — the two rungs above it are the ones that notice a fact slipping.
// It means "you can stop starting here", not "she knows it".
//
// Pure module: no DOM, no network, no clock, no randomness.

import { allFacts, factId } from './facts.js';

/**
 * The rows ordered mode walks, inclusive. The 0s and the 1s are deliberately
 * absent and are NOT a tunable — they are the shape of the fact space, not a
 * setting. `0 x n` and `1 x n` have no route to teach (`strategyFor` returns
 * null for them, which is what keeps them out of learn mode by construction),
 * so a row of them is a row of trivia with the strategy region blank.
 *
 * The consequence is stated rather than buried: tables are rows 2..10, so
 * ordered mode serves `2x0` but never `0x2`. The `a = 0` and `a = 1` rows — 21
 * of the 121 facts — are reachable through drill only, so "every table is done"
 * and "the grid is complete" are different statements and neither implies the
 * other.
 */
const FIRST_TABLE = 2;
const LAST_TABLE = 10;

/**
 * @typedef {{op: string, a: number, b: number}} Fact
 * @typedef {{ordered: {cleared: boolean}}} FactStats the only field read here
 * @typedef {{byId: Map<string, FactStats>}} MasteryModel
 */

/**
 * The eleven facts of one table, `n x 0` through `n x 10`, ascending.
 *
 * `a` is FIXED and `b` VARIES: "the 2s" is `2x0 .. 2x10`, never `0x2 .. 10x2`.
 * Those are eleven different facts with eleven separate histories — this
 * codebase never merges the two orientations of a pair (see facts.js).
 *
 * Built by filtering the fact space rather than by counting to ten, so the row
 * cannot drift out of step with the space it is a row of, and so no bound
 * appears here that also appears in facts.js.
 *
 * A fresh array of the space's own fresh fact objects each call, so nothing a
 * caller does to the result can reach back into another caller's.
 *
 * @param {number} n
 * @returns {Fact[]} 11 facts, or [] for an `n` outside the fact space
 */
export function tableRow(n) {
  return allFacts().filter((fact) => fact.a === n);
}

/**
 * Is `n` a table ordered mode can serve?
 *
 * Exported so `readTable` in main.js asks this module rather than re-deriving
 * the bounds from the URL side. Two copies of a range is the divergence shape
 * that has already bitten this project twice, and both times it failed silently.
 *
 * @param {unknown} n
 * @returns {boolean}
 */
export function isTable(n) {
  return Number.isInteger(n) && n >= FIRST_TABLE && n <= LAST_TABLE;
}

/**
 * Has this fact's ordered rung cleared?
 *
 * An absent fact or an absent rung reads as NOT cleared. That is the safe
 * direction in both places this is used: it makes a run longer, never shorter,
 * so a broken model shows a fact again rather than peeling one the kid has
 * never met. `model.byId` is total over the fact space, so neither absence can
 * actually happen — this is about which way the mistake falls if it ever does.
 *
 * @param {MasteryModel} model
 * @param {Fact} fact
 * @returns {boolean}
 */
function hasCleared(model, fact) {
  return model.byId.get(factId(fact))?.ordered?.cleared === true;
}

/**
 * The facts this visit to table `n` serves: the row from the first fact whose
 * ordered rung has not cleared, through to the end of the row.
 *
 * Empty when every fact in the row has cleared, which is how the menu knows a
 * table is done and must not be startable.
 *
 * Neither `model` nor the returned facts are mutated.
 *
 * @param {MasteryModel} model
 * @param {number} n
 * @returns {Fact[]} a contiguous tail of `tableRow(n)`
 */
export function runFor(model, n) {
  const row = tableRow(n);
  let start = 0;
  while (start < row.length && hasCleared(model, row[start])) {
    start += 1;
  }
  return row.slice(start);
}

/**
 * How far each table has got, for the menu's bars. Tables 2..10, ascending.
 *
 * `cleared` counts EVERY cleared fact in the row, gaps included, so it is not
 * always `total - runFor(model, n).length` — a fact that cleared out of order is
 * counted here and is still served in the run. The two agree at the ends, which
 * is what matters: `cleared === total` exactly when the run is empty.
 *
 * @param {MasteryModel} model
 * @returns {{table: number, cleared: number, total: number}[]}
 */
export function tableProgress(model) {
  const progress = [];
  for (let table = FIRST_TABLE; table <= LAST_TABLE; table += 1) {
    const row = tableRow(table);
    progress.push({
      table,
      cleared: row.filter((fact) => hasCleared(model, fact)).length,
      total: row.length,
    });
  }
  return progress;
}
