// Mastery derivation: the event log in, a bucket picture out.
//
// Nothing here is stored. Buckets, counts and medians are recomputed from the
// log on every read (spec §6, §8), which is what lets us change a threshold and
// re-read history rather than having to re-collect it.
//
// The one idea this module exists to protect: a "clean" attempt is one where the
// correct answer landed while stage === 'clean', before any hint fired. That is
// the ONLY evidence of retrieval. A fact answered correctly a hundred times but
// always after a hint has never been retrieved from memory, and it stays cold.
//
// Pure module: no DOM, no network, no clock, no randomness. Config arrives as a
// parameter so the same log can be replayed under a different tunables table.

import { allFacts, factId } from './facts.js';

const CLEAN_STAGE = 'clean';
const ATTEMPT_TYPE = 'attempt';

// Enough of ISO 8601 to know the value is a real date-time we can order
// lexicographically. Anything else is treated as "no usable timestamp".
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/**
 * @typedef {{ ms: number, stage: string, wrong: number[] }} Attempt
 * @typedef {{
 *   id: string,
 *   fact: {op: string, a: number, b: number},
 *   bucket: 'cold' | 'warm' | 'hot',
 *   attempts: Attempt[],
 *   cleanCount: number,
 *   medianCleanMs: number | null,
 * }} FactStats
 * @typedef {{ byId: Map<string, FactStats>, confusions: Map<string, Set<number>> }} MasteryModel
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
function compareTimestamps(left, right) {
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
 * The bucket rules of spec §6, in one place.
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
 * Two different windows are in play, deliberately:
 *
 *   - `attempts` / `cleanCount` / `medianCleanMs` / `bucket` use only the last
 *     `config.retain` attempts for the fact. Mastery is a recent-form question.
 *   - `confusions` uses EVERY attempt event passed in, retained or not. A wrong
 *     answer from three weeks ago is still evidence that two facts interfere,
 *     and it must not age out just because the fact has been drilled since
 *     (spec §6).
 *
 * BOTH maps are total: every one of the 121 facts is a key in `byId` AND a key
 * in `confusions`, in `allFacts()` order, whatever the log happens to contain.
 * A fact with no attempts is cold with `cleanCount: 0`, `medianCleanMs: null`
 * and an empty `attempts` array; a fact with no recorded wrong answers maps to
 * an empty Set, never to `undefined`. Downstream code never has to handle a
 * missing key on either map, and never has to guard one but not the other.
 *
 * 6×7 and 7×6 are keyed separately and never merged (spec §1).
 *
 * Malformed events, and attempt events naming operands outside the 0..10 fact
 * space, are skipped silently — a corrupt log line must never break a session,
 * and it must never introduce a 122nd key that no consumer expects. Both maps
 * stay exactly the 121 known facts whatever the log contains.
 *
 * @param {object[]} events
 * @param {{retain: number, hotMs: number}} config
 * @returns {MasteryModel}
 */
export function deriveMastery(events, config) {
  /** @type {Map<string, Attempt[]>} */
  const attemptsById = new Map();
  /** @type {Map<string, Set<number>>} */
  const wrongById = new Map();

  const known = new Set(allFacts().map(factId));

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
    const id = factId({ op: event.op, a: event.a, b: event.b });
    if (!known.has(id)) {
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
    // `wrong` is contractually Set<number>. A corrupt line carrying nulls or
    // strings would otherwise land in it verbatim: inert for the scheduler's
    // membership check, but off-contract, and it would surface as junk the
    // moment the results grid renders a fact's recorded wrong answers.
    const wrong = Array.isArray(event.wrong)
      ? event.wrong.filter(Number.isFinite)
      : [];

    // Confusions come from the full history, before any retention trimming.
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

    let attempts = attemptsById.get(id);
    if (attempts === undefined) {
      attempts = [];
      attemptsById.set(id, attempts);
    }
    attempts.push({ ms: event.ms, stage: event.stage, wrong });
  }

  /** @type {Map<string, FactStats>} */
  const byId = new Map();
  /** @type {Map<string, Set<number>>} */
  const confusions = new Map();

  // One pass over the fact space fills both maps, so they carry the same keys
  // in the same order and a consumer can index either one without guarding.
  for (const fact of allFacts()) {
    const id = factId(fact);
    confusions.set(id, wrongById.get(id) ?? new Set());

    const all = attemptsById.get(id) ?? [];
    // Keep the most recent `retain` attempts — the tail of the list, not the head.
    const attempts = all.length > config.retain ? all.slice(all.length - config.retain) : all;

    const cleanMs = attempts
      .filter((attempt) => attempt.stage === CLEAN_STAGE)
      .map((attempt) => attempt.ms);
    const cleanCount = cleanMs.length;
    const medianCleanMs = cleanCount === 0 ? null : median(cleanMs);

    byId.set(id, {
      id,
      fact,
      bucket: bucketFor(cleanCount, medianCleanMs, config),
      attempts,
      cleanCount,
      medianCleanMs,
    });
  }

  return { byId, confusions };
}
