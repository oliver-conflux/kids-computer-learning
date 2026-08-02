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
//   1. Only facts WITH strategy text are eligible. `strategyFor` returns null
//      for anything with a 0 or 1 operand, because there is no route to teach
//      for "anything times zero" — it is a rule you either know or do not. So
//      the trivial facts cannot enter learn mode by construction rather than by
//      a separate filter someone could delete. 78 of the 121 facts are
//      eligible. Squares (6x6, 7x7, 8x8) are excluded for the same reason from
//      the other end: they are the anchors the other strategies lever off, so
//      there is nothing shorter to derive them from.
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
 * Buckets in the order learn mode wants them: coldest first.
 *
 * Learn mode teaches what the kid does not yet own, so a cold fact outranks a
 * warm one and a warm one outranks a hot one. Warm and hot are still listed
 * because the fallback matters at the end of the table — once every eligible
 * cold fact has been taught, a learn session should still be startable.
 */
const BUCKET_PREFERENCE = ['cold', 'warm', 'hot'];

/**
 * @typedef {{op: string, a: number, b: number}} Fact
 */

/**
 * The facts learn mode is allowed to teach: every fact with strategy text, in
 * `allFacts()` order.
 *
 * A fresh array of fresh fact objects each call, so nothing a caller does to
 * the result can reach back into another caller's.
 *
 * @returns {Fact[]}
 */
function eligibleFacts() {
  return allFacts().filter((fact) => strategyFor(fact) !== null);
}

/**
 * Choose the facts for one learn session: up to `config.learnFacts` of the
 * coldest facts that have strategy text.
 *
 * Selection is a stable partition, not a sort. The eligible facts are walked in
 * `allFacts()` order once per bucket — all cold ones first, then warm, then hot
 * — and the first `learnFacts` of that sequence are taken. So ordering among
 * equally-cold facts is `allFacts()` order: row-major, `a` ascending then `b`
 * ascending. That is arbitrary but DOCUMENTED and fixed; this module takes no
 * randomness, and the same model always yields the same facts in the same order.
 *
 * Returns fewer than `learnFacts` only when fewer eligible facts exist in
 * total, which cannot happen for the current table (78 eligible, 3 wanted) but
 * is the honest answer if the eligible set is ever narrowed.
 *
 * Neither `model` nor `config` is mutated.
 *
 * @param {{byId: Map<string, {bucket: string}>}} model mastery model; `byId` is
 *   total over all 121 facts, so no lookup here can miss
 * @param {{learnFacts: number}} config
 * @returns {Fact[]}
 */
export function pickLearnFacts(model, config) {
  const eligible = eligibleFacts();
  /** @type {Fact[]} */
  const picked = [];

  for (const bucket of BUCKET_PREFERENCE) {
    for (const fact of eligible) {
      if (picked.length >= config.learnFacts) {
        return picked;
      }
      if (model.byId.get(factId(fact)).bucket === bucket) {
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
