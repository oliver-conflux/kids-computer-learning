// The geography game's item-space adapter — see core/space.js for the contract.
//
// An item is a spine entry: a country plus which prompt it is asked through.
// Its id is `geo:${kind}:${code}` -- `geo:shape:bz`, `geo:flag:bz`. The prefix
// is not decoration: ids are written into a log that outlives any one version
// of this game, and `bz` alone could not later be told apart from some other
// kind of item added to the same space.
//
// THE TARGET IS LETTERS ONLY. `Costa Rica` is typed as `costarica`; the space is
// rendered as a visual gap and the engine never sees it. That preserves the
// invariant the spelling spine already states for its own items -- lowercase
// a-z, no spaces, no punctuation -- and preserving it is precisely why
// core/engine.js needs no changes for this game.
//
// This file holds no game logic. Everything it exposes is a restatement of what
// a country IS, in the vocabulary the shared core reads.
//
// Pure module: no DOM, no network, no clock, no randomness.

import { SPINE } from './spine.js';

const ID_PREFIX = 'geo:';
const LETTER_PATTERN = /^[a-z]$/;
const ID_PATTERN = /^geo:(shape|flag):([a-z]{2})$/;
const CODE_PATTERN = /^[a-z]{2}$/;

const SIBLING = { shape: 'flag', flag: 'shape' };

/** @type {import('../../core/space.js').ItemSpace} */
export const geographySpace = {
  // No `itemKey`. That exists only for the math game, which shipped calling its
  // items `fact` before the core existed. A new game takes the default.

  allItems() {
    return SPINE;
  },

  itemId(item) {
    return `${ID_PREFIX}${item.kind}:${item.code}`;
  },

  /**
   * An attempt event names an item through `code` and `kind`. Anything else --
   * a corrupt line, an event from another game's log, a missing field -- is not
   * an item in this space and reads as null.
   *
   * This does NOT check spine membership. A well-formed event naming a country
   * that has since left the spine gets an id, and the caller's `known` set
   * rejects it. Those are different failures and the caller distinguishes them.
   */
  idFromEvent(event) {
    if (event === null || typeof event !== 'object') {
      return null;
    }
    const { code, kind } = event;
    if (typeof code !== 'string' || !CODE_PATTERN.test(code)) {
      return null;
    }
    if (kind !== 'shape' && kind !== 'flag') {
      return null;
    }
    return `${ID_PREFIX}${kind}:${code}`;
  },

  /**
   * The two prompts for one country. This IS math's transpose guard, arriving
   * for the same reason: asking for Belize's flag immediately after its shape is
   * answered out of working memory, not out of long-term retrieval, and logs a
   * fast latency that means nothing.
   *
   * They are separate items precisely so they can be scheduled independently,
   * which is exactly what makes this adjacency guard necessary rather than
   * optional.
   */
  relatedIds(id) {
    const match = ID_PATTERN.exec(id ?? '');
    if (match === null) {
      return [];
    }
    const [, kind, code] = match;
    return [`${ID_PREFIX}${SIBLING[kind]}:${code}`];
  },

  /** Letters only — see the header. */
  targetOf(item) {
    return item.target;
  },

  isTypableChar(char) {
    return LETTER_PATTERN.test(char);
  },

  /**
   * A wrong entry is the string that was typed. No coercion: for math this is
   * where "48" becomes 48 so the interference guard can compare it against a
   * product, but a wrong country IS a string, and `guinea` typed for Equatorial
   * Guinea is the whole signal -- it equals another item's correct answer, which
   * is exactly what trips the guard.
   */
  coerceWrong(typed) {
    return typed;
  },

  isValidWrong(value) {
    return typeof value === 'string' && value !== '';
  },

  answerValue(item) {
    return item.target;
  },

  eventFields(item) {
    return { code: item.code, kind: item.kind };
  },
};
