// The hint ladders — one per mode.
//
// v1 had a single ladder whose middle rungs appeared or vanished per fact:
// clean -> strategy -> blocks -> reveal, advanced by a timer. Playing it exposed
// the fault. A strategy hint is not a CUE, it is a TASK — "6 x 6 = 36, add one
// more 6" means recall 36, hold it, add 6, which is comparable work to the
// original problem. Putting a task on a rescue timer is self-defeating: the
// clock that is meant to help is simultaneously counting down to the reveal that
// makes the effort pointless. Blocks are a smaller task, but counting a
// 20-square array against a clock is still work.
//
// So the modes split, and the ladders with them:
//
//   drill   -> ['clean', 'reveal']      no help of any kind, for all 121 facts
//   learn   -> ['strategy', 'reveal']   help from the first frame, no clock
//   ordered -> ['strategy', 'reveal']   the same two rungs as learn
//
// Ordered mode is INSTRUCTION, not drill. A kid marching a table she has not
// learned needs the route in front of her; what is new in that mode is the
// ordering, not the removal of help. So it shares learn's ladder exactly — and
// sharing it is what makes "unaided" mean the same thing in both, which is what
// lets one predicate serve both instruction rungs (see js/mastery.js).
//
// Both are FIXED. No predicates, no per-fact variation. That uniformity is the
// point in drill: keeping blocks would have made the game behave differently for
// 53 facts than for the other 68 for a reason no kid can perceive — 4 x 5 offers
// help, 6 x 7 does not — which reads as arbitrary rather than consistent. Drill
// asks one question ("got it or not"), so it shows one thing.
//
// In learn mode the initial stage IS 'strategy'. It is not revealed by a timer;
// it is on screen from the start, because a kid with no route to 6 x 7 will not
// invent one by staring at it. 'reveal' is reached by the kid pressing the
// button, never by elapsed time.
//
// Stage names are REUSED from v1, not extended. Blocks are no longer a stage at
// all — they are a second REPRESENTATION rendered alongside the strategy in
// learn mode, and the renderer asks `blocksApply` directly. Blocks and prose are
// alternatives for different developmental stages (see the quantity vs. derive
// from an anchor), not degrees of the same help, which is exactly what v1's
// ladder got wrong by making them rungs.
//
// Pure module: no DOM, no network, no clock, no randomness.

import { answerOf } from './facts.js';

/**
 * The fixed ladder for each mode, in order.
 *
 * Every ladder terminates in 'reveal' — every problem has to end somewhere —
 * and no ladder has a middle rung, because with one transition each there is no
 * middle to have.
 */
const LADDERS = {
  drill: ['clean', 'reveal'],
  learn: ['strategy', 'reveal'],
  ordered: ['strategy', 'reveal'],
};

/**
 * The stages for this mode, in order. The same two stages for all 121 facts —
 * `fact` and `config` are accepted so callers need not special-case, and so a
 * future operation can vary the ladder without every call site changing.
 *
 * PASS `mode`. The default is a historical shape, not a fallback: `CONFIG.mode`
 * was retired when a URL with no `?mode=` started meaning "show the menu", so an
 * omitted mode is now `undefined` and THROWS. That is the wanted failure — while
 * the fallback existed, forgetting the argument inside a learn session silently
 * returned the DRILL ladder and the log recorded `stage: 'clean'` on instruction
 * attempts.
 *
 * @param {{op: string, a: number, b: number}} fact
 * @param {{mode?: 'drill'|'learn'|'ordered'}} config
 * @param {'drill'|'learn'|'ordered'} [mode] no longer defaulted in practice
 * @returns {('clean'|'strategy'|'reveal')[]} a fresh array, safe to mutate
 */
export function ladderFor(fact, config, mode = config.mode) {
  const ladder = LADDERS[mode];
  if (ladder === undefined) {
    throw new Error(`No ladder for mode: ${mode}`);
  }
  return [...ladder];
}

/**
 * Whether a block array should be drawn alongside the strategy for this fact.
 * LEARN MODE ONLY — drill draws nothing.
 *
 * Above about 25 items the array stops being a visualisation; nobody counts 42
 * blocks, so the drawing is worse than useless there.
 *
 * The lower bound is not optional. A product of 0 draws an EMPTY array — a blank
 * region rather than a gentler hint. 21 of the 121 facts have a zero operand,
 * and none of them gets strategy text either, so for those the learn screen
 * shows the problem and nothing else. That is honest; a blank box where a
 * picture should be is not.
 *
 * @param {{op: string, a: number, b: number}} fact
 * @param {{blocksMaxProduct: number}} config
 * @returns {boolean}
 */
export function blocksApply(fact, config) {
  const product = answerOf(fact);
  return product >= 1 && product <= config.blocksMaxProduct;
}

/**
 * How long a stage is held before the next one fires, for a fact in this
 * bucket. Drill only — learn has no clock, so nothing in learn mode calls this.
 *
 * With one transition per ladder this is now the WHOLE retrieval window: the
 * time between the problem appearing and the answer appearing.
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
 * @param {('clean'|'strategy'|'reveal')[]} ladder
 * @param {'clean'|'strategy'|'reveal'} current
 * @returns {('clean'|'strategy'|'reveal') | null}
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
