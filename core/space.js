// The item-space adapter contract.
//
// This is the entire seam between the shared core and a game's content. The core
// modules — mastery, scheduler, engine — know nothing about multiplication facts
// or spelling words. They know about Items, which are opaque, and ItemIds, which
// are strings. Everything item-specific arrives through one of the ten members
// below.
//
// This file holds no game logic. It documents the contract and validates an
// implementation of it, which is what stops two games drifting into two subtly
// different readings of the same seam.
//
// Pure module: no DOM, no network, no clock, no randomness.
//
// WHY TEN MEMBERS AND NOT FEWER. The obvious adapter is four or five members —
// enumerate the items, name them, recognise them in a log line. That is enough
// for mastery.js and nothing else. The engine has to know which keystrokes it
// accepts, what string counts as a match, and what fields identify the item on
// an attempt event. The scheduler's interference guard has to compare one item's
// recorded wrong answers against another item's correct answer. Those are all
// item-specific, and leaving them out does not make the core simpler — it makes
// the core secretly math-shaped and the second game impossible.

/**
 * @typedef {unknown} Item an opaque game-specific item
 * @typedef {string} ItemId
 *
 * @typedef {{
 *   allItems: () => Item[],
 *   itemId: (item: Item) => ItemId,
 *   idFromEvent: (event: object) => ItemId | null,
 *   relatedIds: (id: ItemId) => ItemId[],
 *   targetOf: (item: Item) => string,
 *   isTypableChar: (char: string) => boolean,
 *   coerceWrong: (typed: string) => unknown,
 *   isValidWrong: (value: unknown) => boolean,
 *   answerValue: (item: Item) => unknown,
 *   eventFields: (item: Item) => object,
 * }} ItemSpace
 */

/**
 * The contract, member by member.
 *
 * `allItems()`
 *   Every item in the space, in a STABLE order. Called on every mastery
 *   derivation, so it must be cheap and must not depend on anything outside
 *   itself. The order is the order both derived maps are keyed in, and the order
 *   a frontier walks.
 *
 * `itemId(item)`
 *   A stable string id. Two distinct items never share an id, and an item's id
 *   never changes between runs — ids are written into the log and read back
 *   months later.
 *
 * `idFromEvent(event)`
 *   The id an attempt event refers to, or `null` when the event names nothing in
 *   this space. Returning null is the normal path for a corrupt line or an event
 *   from an older item space, and callers skip those silently. This function must
 *   not throw on a malformed event — a corrupt log line must never break a
 *   session, and this is the first place a corrupt line is touched.
 *
 * `relatedIds(id)`
 *   Ids that must never be served immediately after this one. This generalises
 *   the math game's transpose guard: 6x7 and 7x6 are separate facts precisely so
 *   they can be scheduled independently, which is what makes the adjacency guard
 *   necessary. A space with no such relation returns `[]`.
 *
 * `targetOf(item)`
 *   The exact characters the kid must type, as a string. Its LENGTH is the slot
 *   count and the point at which the engine evaluates — there is no submit key in
 *   either game, so this length is load-bearing.
 *
 * `isTypableChar(char)`
 *   Whether a single character is accepted into the entry. Everything else is
 *   ignored by the engine, including modifier combinations and multi-character
 *   strings. Must return false for anything that is not a single character.
 *
 * `coerceWrong(typed)`
 *   A full-length entry that did not match, converted to the value recorded in
 *   the log's `wrong` array. Math records the number 48, not the string "48",
 *   because the interference guard compares it against a product.
 *
 * `isValidWrong(value)`
 *   The guard applied when reading `wrong` values BACK out of the log. A corrupt
 *   line carrying nulls or objects would otherwise land in the confusion set
 *   verbatim — inert for a membership check, but off-contract, and it surfaces as
 *   junk the moment a results screen renders it.
 *
 * `answerValue(item)`
 *   The item's correct answer as a value comparable with `wrong` entries. For
 *   math this is the number 42 while `targetOf` is the string "42". They are
 *   separate members because they are separate types, and conflating them makes
 *   every interference comparison quietly false — a string never equals a number,
 *   so the guard would simply never fire and no test would fail.
 *
 * `eventFields(item)`
 *   The item-identifying fields merged into an attempt event: `{op, a, b}` for
 *   math, `{word, patterns}` for spelling. `idFromEvent` must be able to read
 *   back exactly what this writes — that round trip is the log's whole integrity.
 */

const REQUIRED_MEMBERS = [
  'allItems',
  'itemId',
  'idFromEvent',
  'relatedIds',
  'targetOf',
  'isTypableChar',
  'coerceWrong',
  'isValidWrong',
  'answerValue',
  'eventFields',
];

/**
 * Check that `space` implements the contract, returning a list of the ways it
 * does not. An empty array means it conforms.
 *
 * Returns problems rather than throwing on the first one, so a test reports
 * everything wrong with an adapter in one run instead of one thing per run.
 *
 * This walks the whole item space and is not cheap. It is a test-time and
 * boot-time check, not something to call per problem.
 *
 * @param {object} space
 * @returns {string[]} human-readable problems, empty when the space conforms
 */
export function validateSpace(space) {
  const problems = [];

  if (space === null || typeof space !== 'object') {
    return ['space is not an object'];
  }

  for (const member of REQUIRED_MEMBERS) {
    if (typeof space[member] !== 'function') {
      problems.push(`missing member: ${member}`);
    }
  }
  if (problems.length > 0) {
    return problems; // nothing below can run against an incomplete adapter
  }

  const items = space.allItems();
  if (!Array.isArray(items) || items.length === 0) {
    return ['allItems() did not return a non-empty array'];
  }

  const seen = new Set();
  for (const item of items) {
    const id = space.itemId(item);

    if (typeof id !== 'string' || id === '') {
      problems.push(`itemId returned a non-string or empty id for ${JSON.stringify(item)}`);
      continue;
    }
    if (seen.has(id)) {
      problems.push(`duplicate id: ${id}`);
    }
    seen.add(id);

    const target = space.targetOf(item);
    if (typeof target !== 'string' || target === '') {
      problems.push(`targetOf(${id}) is not a non-empty string`);
      continue;
    }

    // Every character of a target must be typable, or the item is unanswerable:
    // the kid can never reach the length at which the engine evaluates, and the
    // problem hangs forever with no error anywhere.
    for (const char of target) {
      if (!space.isTypableChar(char)) {
        problems.push(`targetOf(${id}) contains untypable character ${JSON.stringify(char)}`);
        break;
      }
    }

    // The round trip that ties targetOf to answerValue. A correct entry, coerced
    // the way a wrong entry would be, must equal the item's answer value.
    // Without this the interference guard compares a string against a number and
    // silently never fires.
    const coerced = space.coerceWrong(target);
    const answer = space.answerValue(item);
    if (!Object.is(coerced, answer)) {
      problems.push(
        `coerceWrong(targetOf(${id})) is ${JSON.stringify(coerced)}, ` +
          `but answerValue is ${JSON.stringify(answer)}`,
      );
    }
    if (!space.isValidWrong(coerced)) {
      problems.push(`isValidWrong rejects the item's own answer for ${id}`);
    }

    // eventFields must round-trip back to the same id through idFromEvent, or a
    // logged attempt cannot be read back as the item that produced it.
    const fields = space.eventFields(item);
    if (fields === null || typeof fields !== 'object') {
      problems.push(`eventFields(${id}) is not an object`);
      continue;
    }
    const roundTripped = space.idFromEvent({ type: 'attempt', ...fields });
    if (roundTripped !== id) {
      problems.push(`idFromEvent(eventFields(${id})) returned ${JSON.stringify(roundTripped)}`);
    }
  }

  // relatedIds must name ids that exist. A typo'd relation is a guard that never
  // fires, which looks exactly like a guard that is working.
  for (const item of items) {
    const id = space.itemId(item);
    const related = space.relatedIds(id);
    if (!Array.isArray(related)) {
      problems.push(`relatedIds(${id}) is not an array`);
      continue;
    }
    for (const other of related) {
      if (!seen.has(other)) {
        problems.push(`relatedIds(${id}) names unknown id ${JSON.stringify(other)}`);
      }
    }
  }

  // A malformed event must produce null, not a throw and not a bogus id.
  for (const junk of [{}, { type: 'attempt' }, null, { op: null, a: 'x', b: {} }]) {
    let result;
    try {
      result = space.idFromEvent(junk);
    } catch (error) {
      problems.push(`idFromEvent threw on ${JSON.stringify(junk)}: ${error.message}`);
      continue;
    }
    if (result !== null && !seen.has(result)) {
      problems.push(`idFromEvent(${JSON.stringify(junk)}) returned unknown id ${result}`);
    }
  }

  // isTypableChar must reject non-single-character input rather than, say,
  // regex-matching a whole string.
  for (const junk of ['', 'ab', ' ']) {
    if (space.isTypableChar(junk)) {
      problems.push(`isTypableChar accepted ${JSON.stringify(junk)}`);
    }
  }

  return problems;
}
