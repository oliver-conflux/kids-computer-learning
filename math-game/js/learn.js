// Learn-mode session construction — which facts to teach, and in what order.
//
// Learn mode is the acquisition half of the game: a few facts, each shown with
// its strategy, cycled until the route is worn in. This module answers the only
// two questions that shape such a session — WHICH facts, and IN WHAT ORDER —
// and nothing else. It renders nothing, logs nothing, and scores nothing.
//
// Two decisions here are load-bearing and are the ones most likely to be
// "simplified" by a later edit:
//
//   1. Only facts WITH strategy text are eligible — `isLearnable`, exported so
//      there is exactly one copy of this filter in the codebase. `strategyFor`
//      returns null for anything with a 0 or 1 operand, because there is no
//      route to teach for "anything times zero" — it is a rule you either know
//      or do not. So the trivial facts cannot enter learn mode by construction
//      rather than by a separate filter someone could delete. 78 of the 121
//      facts are eligible. Squares (6x6, 7x7, 8x8) are excluded for the same
//      reason from the other end: they are the anchors the other strategies
//      lever off, so there is nothing shorter to derive them from.
//
//   2. The session CYCLES the facts (A B C A B C ...) rather than blocking each
//      one (A A A A B B B B ...). Blocking would let a kid coast on the answer
//      they gave a moment ago instead of retrieving it again, which defeats the
//      repetition. This is the opposite of drill's interleaving, on purpose:
//      blocked-by-session/cycled-within is right for building a route, and
//      interleaving is right for retaining one.
//
// There is deliberately NO success governor here, and no padding with mastered
// or easy facts. Drill mixes hot facts in to hold its clean rate near 80%, but
// that governor is a fix for FAILURE and learn mode has no failure state: the
// strategy is on screen and the answer is one button press away, so success is
// available at every moment. The real risk in learn mode is fatigue, not
// demoralisation, and that is answered by the session being short and narrow —
// padding would treat the wrong problem. See spec §4.
//
// Pure module: no DOM, no network, no clock, no randomness. Everything tunable
// arrives in `config`.

import { allFacts, factId } from './facts.js';
import { strategyFor } from './strategies.js';

/**
 * How much pattern support an operand carries — 0 is fully supported, 5 is
 * none. This is the difficulty model, and it is about ROUTES, not magnitudes.
 *
 * A fact is hard to memorise when there is no cheap way to derive it, not when
 * its product is large. The x10 row has the biggest products in the whole table
 * and is the easiest thing in it, so product size is exactly the wrong proxy:
 * sorting by product descending would open a learn session with 10x9. Ranking
 * by pattern support instead puts 7x8 and 6x7 at the top, which is where a kid
 * actually needs the time.
 *
 * 0, 1 and 10 score 0 and are mostly ineligible anyway — they are listed so the
 * table is total over 0..10 rather than relying on a default.
 */
const OPERAND_DIFFICULTY = new Map([
  [0, 0], [1, 0], [10, 0],  // trivial: zero, identity, place-shift
  [2, 1], [5, 1],           // doubling, half-of-ten
  [9, 2],                   // ten-minus-one
  [3, 3], [4, 3],           // some support: double-and-add, double-twice
  [6, 4], [8, 4],           // little
  [7, 5],                   // least — 7 has no pattern of its own
]);

/**
 * Selection ranks, most preferred first. A fact's rank is decided by the first
 * predicate it satisfies.
 *
 * The `taught` split inside `cold` is what stops learn mode repeating itself
 * forever. Learn attempts are deliberately excluded from mastery, so a fact
 * taught yesterday is still cold today and a purely temperature-based ordering
 * hands back the identical three facts every session, indefinitely.
 *
 * Cold-and-taught is rank 2 rather than last on purpose: a fact shown once and
 * never drilled stays cold, and it SHOULD come back round — it just must not
 * come back before every untaught fact has had a turn.
 *
 * `taught` is compared against `true` rather than read for truthiness so a
 * model predating the field ranks its facts as untaught instead of throwing.
 *
 * The four predicates are MUTUALLY EXCLUSIVE, and must stay so. Selection walks
 * the whole eligible list once per rank, so a fact matching two ranks would be
 * picked twice and a kid would get the same fact under two labels in one
 * session. Writing rank 2 as the loose `bucket === 'cold'` is the obvious
 * simplification and is exactly that bug.
 */
const RANKS = [
  (stats) => stats.bucket === 'cold' && stats.taught !== true,
  (stats) => stats.bucket === 'cold' && stats.taught === true,
  (stats) => stats.bucket === 'warm',
  (stats) => stats.bucket === 'hot',
];

/**
 * @typedef {{op: string, a: number, b: number}} Fact
 */

/**
 * Is this fact one learn mode can teach?
 *
 * True exactly when the fact has strategy text — which is the same condition
 * `pickLearnFacts` selects on, by construction: both go through this function.
 * Exported so consumers (the `canLearn` flag on SessionSummary, the results
 * screen) ask this module rather than re-deriving the filter with
 * `strategyFor`. Two copies of a predicate is the divergence shape that has
 * already bitten this project twice, and it fails silently both times.
 *
 * @param {Fact} fact
 * @returns {boolean}
 */
export function isLearnable(fact) {
  return strategyFor(fact) !== null;
}

/**
 * How hard this fact is to memorise: the sum of both operands' pattern-support
 * scores. Higher is harder. Range 0..10; the hardest eligible facts are 6x7 and
 * 7x8 at 9, and 7x7 would top the table at 10 if it had a strategy to teach.
 *
 * @param {Fact} fact
 * @returns {number}
 */
function difficultyOf(fact) {
  return OPERAND_DIFFICULTY.get(fact.a) + OPERAND_DIFFICULTY.get(fact.b);
}

/**
 * The facts learn mode is allowed to teach, hardest first, ties in `allFacts()`
 * order.
 *
 * The sort is stable (guaranteed in Node 22), and the input is `allFacts()`
 * order, so equal-difficulty facts keep it — which is what makes the whole
 * selection deterministic without any secondary key.
 *
 * A fresh array of fresh fact objects each call, so nothing a caller does to
 * the result can reach back into another caller's.
 *
 * @returns {Fact[]}
 */
function eligibleFacts() {
  return allFacts()
    .filter(isLearnable)
    .sort((left, right) => difficultyOf(right) - difficultyOf(left));
}

/**
 * Choose the facts for one learn session: up to `config.learnFacts` learnable
 * facts, the least-known first and the hardest first within that.
 *
 * Two orderings compose, in this priority:
 *
 *   1. RANK — cold-and-untaught, then cold-and-taught, then warm, then hot.
 *      Teach what the kid does not own yet; come back to a taught-but-not-yet-
 *      fluent fact only once the untaught ones are done. Warm and hot are
 *      fallbacks so a session stays startable at the end of the table.
 *   2. DIFFICULTY — hardest first, by pattern support, ties in `allFacts()`
 *      order. On a fresh log every fact is equally cold and rank alone
 *      discriminates not at all, so without this the selection falls through to
 *      table order and opens with 2x2, 2x3, 2x4 — the three easiest facts in
 *      the set, and precisely backwards for a mode whose job is the hard ones.
 *      With it, a fresh log opens on 6x7, 7x6, 7x8.
 *
 * Selection is a stable partition over a pre-sorted list, so it is fully
 * deterministic: no randomness, no clock, no hidden state, and the same model
 * always yields the same facts in the same order.
 *
 * Returns fewer than `learnFacts` only when fewer learnable facts exist in
 * total, which cannot happen for the current table (78 learnable, 3 wanted) but
 * is the honest answer if the learnable set is ever narrowed.
 *
 * Neither `model` nor `config` is mutated.
 *
 * @param {{byId: Map<string, {bucket: string, taught: boolean}>}} model mastery
 *   model; `byId` is total over all 121 facts, so no lookup here can miss
 * @param {{learnFacts: number}} config
 * @returns {Fact[]}
 */
export function pickLearnFacts(model, config) {
  const eligible = eligibleFacts();
  /** @type {Fact[]} */
  const picked = [];

  for (const matchesRank of RANKS) {
    for (const fact of eligible) {
      if (picked.length >= config.learnFacts) {
        return picked;
      }
      if (matchesRank(model.byId.get(factId(fact)))) {
        picked.push(fact);
      }
    }
  }

  return picked;
}

/**
 * Expand chosen facts into the session's item list by cycling them
 * `config.learnPasses` times: `[A, B, C, A, B, C, A, B, C, A, B, C]`.
 *
 * CYCLED, not blocked per fact. `[A, A, A, A, B, B, B, B, ...]` is the same
 * multiset and the wrong session — repeating a fact back to back lets the kid
 * echo the answer they just gave rather than retrieving it again.
 *
 * The returned array holds the SAME fact objects as the input, repeated. Facts
 * are read-only value objects everywhere in this codebase; nothing may mutate
 * an item in place.
 *
 * @param {Fact[]} facts the session's distinct facts, in presentation order
 * @param {{learnPasses: number}} config
 * @returns {Fact[]} `facts.length * config.learnPasses` items
 */
export function buildLearnSession(facts, config) {
  /** @type {Fact[]} */
  const session = [];
  for (let pass = 0; pass < config.learnPasses; pass += 1) {
    for (const fact of facts) {
      session.push(fact);
    }
  }
  return session;
}
