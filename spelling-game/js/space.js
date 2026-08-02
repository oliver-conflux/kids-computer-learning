// The spelling game's item-space adapter — see core/space.js for the contract.
//
// An item is a Word: { word, rank, dolch }. Its id is `w:${word}`. The `w:`
// prefix is not decoration — ids are written into a log that outlives any one
// version of this game, and a bare word could not later be distinguished from
// some other kind of item added to the same space.
//
// This file holds no game logic. Everything it exposes is a restatement of what
// a word IS, in the vocabulary the shared core reads.
//
// Pure module: no DOM, no network, no clock, no randomness.

import { SPINE } from './spine.js';
import { patternsFor } from './patterns.js';

const ID_PREFIX = 'w:';
const LETTER_PATTERN = /^[a-z]$/;

/** @type {import('../../core/space.js').ItemSpace} */
export const spellingSpace = {
  // No `itemKey`. That exists only for the math game, which shipped calling its
  // items `fact` before the core existed. A new game takes the default.

  allItems() {
    return SPINE;
  },

  itemId(word) {
    return `${ID_PREFIX}${word.word}`;
  },

  /**
   * An attempt event names a word through its `word` field. Anything else —
   * a corrupt line, an event from another game's log, a missing field — is not
   * a word in this space and reads as null.
   *
   * This does NOT check membership of the spine. A well-formed event naming a
   * word that has since left the spine gets an id, and the caller's `known` set
   * rejects it. Those are different failures and the caller distinguishes them.
   */
  idFromEvent(event) {
    if (event === null || typeof event !== 'object') {
      return null;
    }
    if (typeof event.word !== 'string' || event.word === '') {
      return null;
    }
    return `${ID_PREFIX}${event.word}`;
  },

  /**
   * Empty, always. This is the deliberate non-analogue of math's transpose
   * guard: 6x7 and 7x6 must not be served adjacently because the second is
   * answered out of working memory, and spelling has no pair of items standing
   * in that relationship. Words that merely rhyme are the opposite case — a
   * kid who spells `light` and then `night` is doing exactly the transfer the
   * game is teaching, and blocking it would remove the point.
   */
  relatedIds() {
    return [];
  },

  /** The word itself is what must be typed, letter by letter into the slots. */
  targetOf(word) {
    return word.word;
  },

  isTypableChar(char) {
    return LETTER_PATTERN.test(char);
  },

  /**
   * A wrong entry is recorded as the string that was typed. No coercion: for
   * math this is where "48" becomes 48 so the interference guard can compare it
   * against a product, but a misspelling IS a string and its value is the exact
   * sequence of letters the kid produced. `freind` is the whole signal.
   */
  coerceWrong(typed) {
    return typed;
  },

  isValidWrong(value) {
    return typeof value === 'string' && value !== '';
  },

  answerValue(word) {
    return word.word;
  },

  /**
   * `patterns` rides on every attempt event so the log can be read back by
   * pattern without re-deriving it — and, more importantly, so that a LATER
   * change to the pattern rules cannot silently rewrite what a past session
   * meant. The tags recorded are the tags that were on screen.
   */
  eventFields(word) {
    return { word: word.word, patterns: patternsFor(word.word) };
  },
};
