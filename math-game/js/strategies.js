// Kid-facing strategy text — the content half of the hint ladder.
//
// `strategyFor(fact)` answers one question: is there a *derivation* worth
// teaching for this fact? Not "can it be computed" — everything can be computed
// — but "is there a one-line route from a fact the kid already owns to this
// one". When the answer is no, this returns null and the ladder simply omits its
// 'strategy' rung (see hints.js). There is nothing to teach about 7 x 0, and
// pretending otherwise would spend a hint stage saying nothing.
//
// Strategies are data, not branching code: a list of rules, each with a
// predicate and a text builder, tried in order. Adding addition or division
// later means appending rules here — the ladder machinery in hints.js does not
// change. That separation is the whole point.
//
// Every string is written to be read aloud by a 10-year-old and kept under about
// 40 characters, because it renders on one line under the problem.
//
// Pure module: no DOM, no network, no clock, no randomness.

/**
 * Facts that are their own special case. Keyed by the unordered pair, since
 * 6 x 7 and 7 x 6 want the same advice even though they are different facts
 * with different ids and different latency histories.
 *
 * These are the hard middle of the table — the ones with no small operand to
 * lever off. Each leans on the nearest square, or halves to an easier fact and
 * doubles back.
 */
const PAIR_STRATEGIES = new Map([
  ['6,7', '6 x 6 = 36, add one more 6'],
  ['6,8', 'half it: 3 x 8 = 24, now double'],
  ['7,8', '7 x 7 = 49, add one more 7'],

  // The three squares. v1 left these with no strategy on the reasoning that a
  // square is an ANCHOR — it is what the other strategies lever off — so there
  // is nothing shorter to derive it from.
  //
  // True of deriving a square from another square, but not of deriving one at
  // all, and the consequence was serious: drill shows no hints, and learn mode
  // only offers facts that have strategy text, so 6 x 6, 7 x 7 and 8 x 8 had no
  // teaching anywhere in the game. 7 x 7 = 49 is on the short list of facts that
  // genuinely need work, and it was the one fact learn mode could never reach.
  //
  // Each levers off an easier fact the kid already has: 6x6 and 7x7 off their
  // x5 neighbour, 8x8 off 4x8 and a double.
  ['6,6', '5 x 6 = 30, add one more 6'],
  ['7,7', '5 x 7 = 35, then two more 7s'],
  ['8,8', '4 x 8 = 32, then double it'],
]);

/**
 * Rules keyed on one operand having a particular value. `other` is the operand
 * that is not the anchor, so 10 x 7 and 7 x 10 both build text about 7.
 *
 * Order matters — the first matching rule wins. 5 x 9 takes the x9 rule only if
 * x9 is listed first, so the sequence below is the deliberate preference order:
 * the strategy with the least mental work comes first.
 */
const OPERAND_STRATEGIES = [
  { anchor: 10, text: (other) => `${other} then a 0 on the end` },
  { anchor: 2, text: (other) => `double ${other}: ${other} + ${other}` },
  { anchor: 9, text: (other) => `10 x ${other} = ${other * 10}, take away ${other}` },
  { anchor: 5, text: (other) => `10 x ${other} = ${other * 10}, take half` },
  // NEVER WRITE THE LAST NUMBER. This one used to read `double 8 twice: 16, 32`
  // and 32 is the answer — the kid reads it off the screen instead of doubling,
  // and the strategy stage stops being a route and becomes a slower reveal.
  // Every other rule here hands over an INTERMEDIATE and leaves the final step
  // to her; this is that rule matching the rest. Found by playing the 4s, where
  // the same text comes round nine times.
  { anchor: 4, text: (other) => `double ${other} twice: ${other * 2}, then double that` },
  { anchor: 3, text: (other) => `double ${other} = ${other * 2}, add one more ${other}` },
];

/**
 * Operands that make a fact trivial. "Anything times zero is zero" and
 * "anything times one is itself" are single rules a kid either knows or does
 * not; there is no derivation to walk them through, so no strategy stage.
 */
const TRIVIAL_OPERANDS = new Set([0, 1]);

function pairKey(fact) {
  const low = Math.min(fact.a, fact.b);
  const high = Math.max(fact.a, fact.b);
  return `${low},${high}`;
}

/**
 * Short kid-facing text for deriving this fact, or null when no strategy
 * applies. A null return is what makes the ladder drop its 'strategy' stage.
 *
 * @param {{op: string, a: number, b: number}} fact
 * @returns {string | null}
 */
export function strategyFor(fact) {
  if (TRIVIAL_OPERANDS.has(fact.a) || TRIVIAL_OPERANDS.has(fact.b)) {
    return null;
  }

  const pairStrategy = PAIR_STRATEGIES.get(pairKey(fact));
  if (pairStrategy !== undefined) {
    return pairStrategy;
  }

  for (const rule of OPERAND_STRATEGIES) {
    if (fact.a === rule.anchor) {
      return rule.text(fact.b);
    }
    if (fact.b === rule.anchor) {
      return rule.text(fact.a);
    }
  }

  // What is left has no rule and no pair override.
  return null;
}
