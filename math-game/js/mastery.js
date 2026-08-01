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
 * Events are read in the order given, which for the append-only log is
 * chronological. "Most recent" therefore means "latest in the list"; this
 * function does not sort by timestamp and does not consult a clock.
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

    const wrong = Array.isArray(event.wrong) ? [...event.wrong] : [];

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
