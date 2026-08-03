// Mastery derivation: the event log in, a bucket picture out.
//
// Nothing here is stored. Buckets, counts and medians are recomputed from the
// log on every read, which is what lets us change a threshold and re-read
// history rather than having to re-collect it.
//
// The one idea this module exists to protect: a "clean" attempt is one where the
// correct answer landed while stage === 'clean', before any hint fired. That is
// the ONLY evidence of retrieval. An item answered correctly a hundred times but
// always after a hint has never been retrieved from memory, and it stays cold.
//
// Everything item-specific arrives through the `space` adapter — see
// core/space.js. This module never knows whether an item is a multiplication
// fact or a spelling word.
//
// Pure module: no DOM, no network, no clock, no randomness. Config arrives as a
// parameter so the same log can be replayed under a different tunables table.

const CLEAN_STAGE = 'clean';
const ATTEMPT_TYPE = 'attempt';
// The modes that TEACH rather than measure. A game may have more than one — see
// isInstructionAttempt.
const INSTRUCTION_MODES = new Set(['learn', 'ordered']);

// Enough of ISO 8601 to know the value is a real date-time we can order
// lexicographically. Anything else is treated as "no usable timestamp".
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

import { itemKeyOf } from './space.js';

/**
 * @typedef {import('./space.js').Item} Item
 * @typedef {import('./space.js').ItemId} ItemId
 * @typedef {import('./space.js').ItemSpace} ItemSpace
 *
 * @typedef {{ ms: number, stage: string, wrong: unknown[] }} Attempt
 * @typedef {{
 *   id: ItemId,
 *   item: Item, — or whatever `space.itemKey` names it; `fact` in the math game

 *   bucket: 'cold' | 'warm' | 'hot',
 *   attempts: Attempt[],
 *   cleanCount: number,
 *   medianCleanMs: number | null,
 *   taught: boolean,
 *   taughtCount: number,
 * }} ItemStats
 * @typedef {{ byId: Map<ItemId, ItemStats>, confusions: Map<ItemId, Set<unknown>> }} MasteryModel
 */

/**
 * Median of a numeric list. Odd counts take the middle value; even counts take
 * the mean of the two middle values, unrounded — a derived statistic should not
 * quietly lose precision on its way to a threshold comparison.
 *
 * @param {number[]} values non-empty
 * @returns {number}
 */
function median(values) {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Order two log timestamps, oldest first.
 *
 * ISO 8601 in a fixed UTC format is chronological under plain string
 * comparison, so this parses nothing and consults no clock. A missing or
 * malformed `t` sorts to the front rather than throwing: the oldest slot is the
 * safe place for an event we cannot date, because it cannot then push a real
 * attempt out of the retain window.
 *
 * @param {unknown} left
 * @param {unknown} right
 * @returns {number}
 */
export function compareTimestamps(left, right) {
  const leftOk = typeof left === 'string' && ISO_TIMESTAMP_PATTERN.test(left);
  const rightOk = typeof right === 'string' && ISO_TIMESTAMP_PATTERN.test(right);
  if (!leftOk && !rightOk) {
    return 0; // both undatable — stable sort keeps file order
  }
  if (!leftOk) {
    return -1;
  }
  if (!rightOk) {
    return 1;
  }
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

/**
 * Is this attempt event an INSTRUCTION-mode attempt — one where the kid was
 * being shown a route rather than asked to retrieve an answer?
 *
 * Only the exact literals in `INSTRUCTION_MODES` count. Everything else — the
 * string `'drill'`, an absent field, or a corrupt value — is a drill attempt.
 *
 * The absent case is the load-bearing one: `mode` arrived after the first logs
 * were written, and every line written before it existed was a drill attempt.
 * Defaulting to drill is what lets all that history read correctly with no
 * migration pass over the log. A default of learn, or a requirement that the
 * field be present, would silently erase every bucket the kid has already
 * earned.
 *
 * This is a SET rather than a single string because the math game has two
 * instruction modes — `learn`, and `ordered`, which walks a times table end to
 * end with the strategy on screen. Both teach, so both are excluded from the
 * buckets and both set `taught`. The spelling game has only `learn` and never
 * writes `ordered`, so the extra member costs it nothing and changes none of its
 * history.
 *
 * @param {object} event
 * @returns {boolean}
 */
function isInstructionAttempt(event) {
  return INSTRUCTION_MODES.has(event.mode);
}

/**
 * The bucket rules, in one place.
 *
 * - cold: no clean attempt in the retained window; no evidence of retrieval.
 * - hot:  at least 3 clean attempts AND median clean latency < config.hotMs.
 * - warm: everything else — some retrieval evidence, not yet fast and repeated.
 *
 * Note the two ways to miss `hot`: too slow, or not yet enough clean answers.
 * One fast clean answer is warm, not hot; a single lucky retrieval is not
 * fluency. Both thresholds are boundary-inclusive against warm: exactly
 * `hotMs` is warm, and exactly 3 clean answers is enough for hot.
 *
 * `hotMs` is per-game and deliberately so — typing a five-letter word is not
 * the same physical act as typing a two-digit product, and the same number
 * would mislabel one of the two games.
 *
 * @param {number} cleanCount
 * @param {number | null} medianCleanMs
 * @param {{hotMs: number}} config
 * @returns {'cold' | 'warm' | 'hot'}
 */
function bucketFor(cleanCount, medianCleanMs, config) {
  if (cleanCount === 0) {
    return 'cold';
  }
  if (cleanCount >= 3 && medianCleanMs < config.hotMs) {
    return 'hot';
  }
  return 'warm';
}

/**
 * Derive the mastery model from a list of log events.
 *
 * Attempt events are sorted by their `t` timestamp before anything is folded in,
 * so "most recent" means latest in TIME, not last in the array.
 *
 * File order cannot be trusted to be chronological. The log is append-only, and
 * the log client queues events to an outbox when the server is unreachable and
 * replays them at the next startup — so Tuesday's attempts can land in the file
 * after Wednesday's and nothing ever corrects that. Reading in file order would
 * then hand the retain window the wrong five attempts and produce a wrong
 * bucket, a wrong median and a wrong scheduling weight, silently. Sorting on
 * read makes the model correct however the file came to be written, which also
 * keeps tools/replay.js honest against the same file.
 *
 * The sort is stable, so events sharing a timestamp keep file order. `t` values
 * are compared as strings: ISO 8601 in a fixed UTC format sorts chronologically
 * under lexicographic comparison, and no date parsing means no clock. Events
 * whose `t` is missing or not an ISO date-time sort to the front — the oldest
 * position, where they cannot displace real attempts out of the retain window —
 * rather than throwing.
 *
 * INSTRUCTION-MODE ATTEMPTS ARE NOT MASTERY EVIDENCE. An attempt event whose
 * `mode` is one of `INSTRUCTION_MODES` is excluded from `attempts`,
 * `cleanCount`, `medianCleanMs` and `bucket` — not discounted, excluded. Drill
 * measures retrieval speed against a clock; instruction measures whether a
 * taught route was followed, with the strategy on screen and the answer behind
 * a button the kid presses. A 20-second answer in learn mode is a successful
 * derivation, not slow recall. Folding it in would drag the median and mislabel
 * an item the kid is acquiring well. The two do not share a scale, so they must
 * not share a bucket.
 *
 * An ABSENT `mode` is a drill attempt — see `isInstructionAttempt`. Because the whole
 * model derives on read, this exclusion applies retroactively across all
 * history the moment the rule changes, with no migration.
 *
 * Three different windows are in play, deliberately:
 *
 *   - `attempts` / `cleanCount` / `medianCleanMs` / `bucket` use only the last
 *     `config.retain` DRILL attempts for the item. Mastery is a recent-form
 *     question, asked of the timed mode only.
 *   - `confusions` uses EVERY attempt event passed in — retained or not, drill
 *     or instruction. A wrong answer from three weeks ago is still evidence that
 *     two items interfere, and it must not age out just because the item has
 *     been drilled since. The instruction modes are the deliberate exception to
 *     the mode split: interference between two items is interference regardless
 *     of which mode surfaced it.
 *   - `taught` uses every instruction attempt in the FULL event list. A
 *     route taught three weeks ago is still a route the kid has been shown, so
 *     it must not expire out of the retain window. This is what lets a results
 *     screen render an item that is cold but taught as "shown how" rather than
 *     "not started" — a display state layered on top of the model, not a fourth
 *     bucket. `bucket` stays exactly cold | warm | hot and the scheduler is
 *     untouched.
 *
 * BOTH maps are total: every item in `space.allItems()` is a key in `byId` AND a
 * key in `confusions`, in `allItems()` order, whatever the log happens to
 * contain. An item with no attempts is cold with `cleanCount: 0`,
 * `medianCleanMs: null`, `taught: false` and an empty `attempts` array; an item
 * with no recorded wrong answers maps to an empty Set, never to `undefined`.
 * Downstream code never has to handle a missing key on either map, and never has
 * to guard one but not the other.
 *
 * Malformed events, and attempt events naming something outside the item space,
 * are skipped silently — a corrupt log line must never break a session, and it
 * must never introduce a key no consumer expects. Both maps stay exactly the
 * known item space whatever the log contains.
 *
 * The two skip conditions below look redundant and are not. `idFromEvent`
 * returning null means the event does not name an item at all — a corrupt line,
 * or a field shape from an older log. An id that is not in the known set means
 * the event named an item this space no longer contains: well-formed, readable,
 * and outside the space. Both must be dropped, and either check alone lets the
 * other case through.
 *
 * @param {object[]} events
 * @param {{retain: number, hotMs: number, maxPlausibleMs: number}} config
 * @param {ItemSpace} space
 * @returns {MasteryModel}
 */
export function deriveMastery(events, config, space) {
  /** @type {Map<ItemId, Attempt[]>} */
  const attemptsById = new Map();
  /** @type {Map<ItemId, Set<unknown>>} */
  const wrongById = new Map();
  /** Items with at least one instruction-mode attempt anywhere in the full log. */
  const taughtIds = new Set();
  /**
   * Item -> the set of learn SESSIONS that taught it, so `taughtCount` can be
   * how many lessons an item has had rather than how many attempts. A session
   * teaches each of its words `config.learnPasses` times, and counting raw
   * attempts would make one lesson look like three.
   *
   * @type {Map<ItemId, Set<unknown>>}
   */
  const taughtSessionsById = new Map();
  /** Fallback lesson key for a learn attempt with no session id. */
  let looseLearnAttempts = 0;

  const known = new Set(space.allItems().map((item) => space.itemId(item)));
  // The field name a game calls its item by — `item` for everything except the
  // math game. See core/space.js.
  const itemKey = itemKeyOf(space);

  // Keep only usable attempt events, then put them in time order. Filtering
  // first means a corrupt line is dropped before it can influence the sort.
  const usable = [];
  for (const event of events) {
    if (event === null || typeof event !== 'object') {
      continue;
    }
    if (event.type !== ATTEMPT_TYPE) {
      continue;
    }
    const id = space.idFromEvent(event);
    if (id === null || !known.has(id)) {
      continue;
    }
    // `ms` is the primary signal of the entire system — it drives buckets, hint
    // timing and scheduling weight. An attempt whose latency is missing or not a
    // finite number carries nothing this model reads, so it is dropped with the
    // other corrupt lines rather than admitted. Admitting it would put NaN into
    // `medianCleanMs` while `cleanCount` stayed positive, which contradicts the
    // contract's "null only when cleanCount is 0" and would then propagate a
    // silently poisoned median into the scheduler's weights and the grid.
    if (!Number.isFinite(event.ms)) {
      continue;
    }
    usable.push({ id, event });
  }

  // Stable in Node 22, so equal timestamps fall back to file order.
  usable.sort((left, right) => compareTimestamps(left.event.t, right.event.t));

  for (const { id, event } of usable) {
    // `wrong` is contractually a set of values `space.isValidWrong` admits. A
    // corrupt line carrying nulls or objects would otherwise land in it
    // verbatim: inert for the scheduler's membership check, but off-contract,
    // and it would surface as junk the moment a results screen renders an item's
    // recorded wrong answers.
    const wrong = Array.isArray(event.wrong)
      ? event.wrong.filter((value) => space.isValidWrong(value))
      : [];

    // Confusions come from the full history, before any retention trimming,
    // and from BOTH modes. This is the one deliberate leak across the mode
    // split: a wrong answer says two items interfere in the kid's head, and
    // that is true whether the strategy was on screen or not.
    if (wrong.length > 0) {
      let seen = wrongById.get(id);
      if (seen === undefined) {
        seen = new Set();
        wrongById.set(id, seen);
      }
      for (const answer of wrong) {
        seen.add(answer);
      }
    }

    // `taught` is likewise unwindowed: the question is whether the kid was ever
    // shown a route for this item, not whether it was shown recently.
    if (isInstructionAttempt(event)) {
      taughtIds.add(id);
      let lessons = taughtSessionsById.get(id);
      if (lessons === undefined) {
        lessons = new Set();
        taughtSessionsById.set(id, lessons);
      }
      // An attempt with no session id is its own lesson rather than being
      // lumped with every other sessionless attempt under `undefined`, which
      // would make a whole old log count as one lesson.
      lessons.add(
        typeof event.session === 'string' && event.session !== ''
          ? event.session
          : `#loose${(looseLearnAttempts += 1)}`,
      );
      // Everything below is mastery evidence, and instruction attempts are none.
      continue;
    }

    let attempts = attemptsById.get(id);
    if (attempts === undefined) {
      attempts = [];
      attemptsById.set(id, attempts);
    }
    attempts.push({ ms: event.ms, stage: event.stage, wrong });
  }

  /** @type {Map<ItemId, ItemStats>} */
  const byId = new Map();
  /** @type {Map<ItemId, Set<unknown>>} */
  const confusions = new Map();

  // One pass over the item space fills both maps, so they carry the same keys
  // in the same order and a consumer can index either one without guarding.
  for (const item of space.allItems()) {
    const id = space.itemId(item);
    confusions.set(id, wrongById.get(id) ?? new Set());

    const all = attemptsById.get(id) ?? [];
    // Keep the most recent `retain` attempts — the tail of the list, not the head.
    const attempts = all.length > config.retain ? all.slice(all.length - config.retain) : all;

    // An implausibly long attempt is excluded from the latency evidence even if
    // it landed at the clean stage. Waiting 90 seconds and then typing the right
    // answer is not retrieval — the kid switched tabs, or was called away, and
    // the rAF loop that drives the hint ladder pauses in a hidden tab while wall
    // time keeps running. One such attempt in a window of five drags the median
    // far enough to flip an item's bucket.
    //
    // The attempt stays in `attempts` because it did happen, and its `wrong`
    // entries still count toward `confusions` — a wrong answer is evidence of
    // interference no matter how long the kid took to give it.
    const cleanMs = attempts
      .filter(
        (attempt) =>
          attempt.stage === CLEAN_STAGE && attempt.ms <= config.maxPlausibleMs,
      )
      .map((attempt) => attempt.ms);
    const cleanCount = cleanMs.length;
    const medianCleanMs = cleanCount === 0 ? null : median(cleanMs);

    byId.set(id, {
      id,
      [itemKey]: item,
      bucket: bucketFor(cleanCount, medianCleanMs, config),
      attempts,
      cleanCount,
      medianCleanMs,
      taught: taughtIds.has(id),
      taughtCount: taughtSessionsById.get(id)?.size ?? 0,
    });
  }

  return { byId, confusions };
}
