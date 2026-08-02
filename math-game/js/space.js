// The math game's item-space adapter — see core/space.js for the contract.
//
// Everything here is a thin restatement of facts.js in the core's vocabulary.
// There is no new logic: if a rule about the fact space appears to be defined
// here, it is defined in facts.js and this file is quoting it.
//
// Pure module: no DOM, no network, no clock, no randomness.

import { allFacts, factId, parseFactId, answerOf, transposeId } from './facts.js';

const DIGIT_PATTERN = /^[0-9]$/;

/** @type {import('../../core/space.js').ItemSpace} */
export const mathSpace = {
  allItems: allFacts,

  itemId: factId,

  /**
   * An attempt event names a fact through `op`, `a` and `b`. Anything that does
   * not produce one of the 121 known ids reads as null, including operands
   * outside 0..10 and non-numeric junk from a corrupt line.
   */
  idFromEvent(event) {
    if (event === null || typeof event !== 'object') {
      return null;
    }
    if (typeof event.op !== 'string') {
      return null;
    }
    if (!Number.isInteger(event.a) || !Number.isInteger(event.b)) {
      return null;
    }
    return factId({ op: event.op, a: event.a, b: event.b });
  },

  /**
   * The transpose, and only the transpose. 6x7 and 7x6 must not be served
   * adjacently — the second gets answered out of working memory and logs a fast
   * latency that means nothing (spec §7).
   *
   * A square fact is its own transpose, so 6x6 relates to itself. The scheduler's
   * no-repeat window already excludes an id from following itself, so this adds
   * nothing there and is harmless.
   */
  relatedIds(id) {
    return [transposeId(parseFactId(id))];
  },

  /** The product as a string — its length is the slot count. */
  targetOf(fact) {
    return String(answerOf(fact));
  },

  isTypableChar(char) {
    return DIGIT_PATTERN.test(char);
  },

  /**
   * A wrong entry is recorded as a NUMBER, not the string that was typed. The
   * interference guard compares these against products, and "48" never equals 48.
   */
  coerceWrong(typed) {
    return Number(typed);
  },

  isValidWrong: Number.isFinite,

  answerValue: answerOf,

  eventFields(fact) {
    return { op: fact.op, a: fact.a, b: fact.b };
  },
};
