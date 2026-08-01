// The hint ladder.
//
// Not a fixed sequence. The ladder is an ordered list of stages where each
// stage carries its own predicate saying whether it applies to a given problem,
// and `ladderFor` resolves that list against one fact. 6 x 7 gets
// clean -> strategy -> reveal because 42 blocks is not a picture anyone counts;
// 2 x 3 gets a blocks rung because six blocks is. Same engine, different
// applicable set.
//
// This is the mechanism that makes adding subtraction or division a content
// change rather than a rewrite: a new operation supplies new predicates and new
// strategy text, and every consumer of `ladderFor` keeps working untouched. Do
// not replace the predicate list with a hard-coded sequence.
//
// Pure module: no DOM, no network, no clock, no randomness.

import { answerOf } from './facts.js';
import { strategyFor } from './strategies.js';

/**
 * The full ladder in order, each rung with its applicability predicate.
 *
 * 'blocks' and 'reveal' are different kinds of help and deliberately not
 * interchangeable: blocks are a conceptual scaffold (re-derive it from what
 * multiplication means), reveal is a retrieval scaffold (here is the answer,
 * now practise pulling it). They sit at opposite ends of the concrete ->
 * strategic -> automatic progression, which is why order is fixed and only
 * membership varies.
 */
const LADDER = [
  {
    stage: 'clean',
    // Just the problem, no help. Always present — it is the only stage that
    // produces evidence of retrieval.
    applies: () => true,
  },
  {
    stage: 'strategy',
    // Present only when there is a derivation worth teaching for this fact.
    applies: (fact) => strategyFor(fact) !== null,
  },
  {
    stage: 'blocks',
    // Above about 25 items the array stops being a visualisation — nobody
    // counts 42 blocks — so the drawing is worse than useless there.
    applies: (fact, config) => answerOf(fact) <= config.blocksMaxProduct,
  },
  {
    stage: 'reveal',
    // The answer, greyed into the slots. Always present — every problem must
    // terminate somewhere.
    applies: () => true,
  },
];

/**
 * The stages that apply to this fact, in ladder order.
 *
 * Always starts with 'clean' and always ends with 'reveal'; the middle rungs
 * appear only when their predicates hold.
 *
 * @param {{op: string, a: number, b: number}} fact
 * @param {{blocksMaxProduct: number}} config
 * @returns {('clean'|'strategy'|'blocks'|'reveal')[]}
 */
export function ladderFor(fact, config) {
  return LADDER.filter((rung) => rung.applies(fact, config)).map((rung) => rung.stage);
}

/**
 * How long a stage is held before the next one fires, for a fact in this
 * bucket.
 *
 * THE DELAY GROWS WITH MASTERY. It does not shrink. A cold fact is rescued
 * almost immediately, because that is what keeps acquisition errorless and
 * stops a kid rehearsing a wrong answer into place. A hot fact is made to wait,
 * because by then the retrieval effort *is* the exercise — help arriving early
 * would replace the very thing being practised.
 *
 * This is progressive time delay. It reads backwards and it is not. There is a
 * test asserting hot > cold specifically to stop it being tidied away.
 *
 * @param {'cold'|'warm'|'hot'} bucket
 * @param {{delays: {cold: number, warm: number, hot: number}}} config
 * @returns {number} milliseconds
 */
export function delayMsFor(bucket, config) {
  const delay = config.delays[bucket];
  if (typeof delay !== 'number') {
    throw new Error(`No delay configured for bucket: ${bucket}`);
  }
  return delay;
}

/**
 * The stage after `current` in this ladder, or null when `current` is already
 * the last rung — which for every ladder means 'reveal', the terminal stage.
 *
 * @param {('clean'|'strategy'|'blocks'|'reveal')[]} ladder
 * @param {'clean'|'strategy'|'blocks'|'reveal'} current
 * @returns {('clean'|'strategy'|'blocks'|'reveal') | null}
 */
export function nextStage(ladder, current) {
  const index = ladder.indexOf(current);
  if (index === -1) {
    throw new Error(`Stage ${current} is not in this ladder: ${ladder.join(' -> ')}`);
  }
  if (index === ladder.length - 1) {
    return null;
  }
  return ladder[index + 1];
}
