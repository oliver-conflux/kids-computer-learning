// Mastery derivation for the math game: the core model, plus the two
// instruction rungs.
//
// Most of the logic lives in core/mastery.js and is shared with the spelling
// game. This file is the binding: it supplies math's item-space adapter, which
// is also what tells the core to call the item `fact` rather than `item`, so
// nothing on this side of the seam had to learn a new word.
//
// Read core/mastery.js for those rules — the three windows, the retain window,
// the `maxPlausibleMs` outlier guard, and why instruction attempts are not
// mastery evidence. None of that is restated here, because a second copy of an
// explanation is a second thing to get out of date.
//
// WHAT THIS FILE ADDS. Every fact gains two rung records, `ordered` and `learn`.
// They answer the question the buckets cannot: not "did she get it" but AT
// WHICH LEVEL OF SUPPORT can she still get it. The three modes are one
// measurement taken at three levels of scaffolding — ordered (strategy on
// screen, and she knows the last one was 2×6, so context is carrying her),
// learn (strategy on screen, randomized), drill (nothing, against a clock).
// Weakest evidence first. Drill's rung is the existing `hot` bucket and is not
// touched.
//
// THE TWO RUNGS COUNT DIFFERENT THINGS, and a reader will assume they are
// symmetrical. `learn.attempts` counts ATTEMPTS, because a learn session cycles
// its few facts `config.learnPasses` times and each pass is a separate ask.
// `ordered.attempts` counts RUNS — the set of ordered attempts sharing a
// `session` id — because an ordered run serves each fact exactly once, so two
// attempts in one run are one occasion seen twice, not two occasions. What
// `unaidedRuns` is really asking for is two separate sittings.
//
// WHY THIS IS HERE AND NOT IN core/mastery.js. Runs-versus-attempts and the
// last-two window are math's design. The spelling game has no ordered mode, so
// putting these in the shared module would impose a rule on it that it cannot
// exercise and would have to be re-verified against.
//
// Pure module: no DOM, no network, no clock, no randomness. Config arrives as a
// parameter so the same log can be replayed under a different tunables table.

import { compareTimestamps, deriveMastery as deriveCoreMastery } from '../../core/mastery.js';
import { mathSpace } from './space.js';

export { compareTimestamps };

const ATTEMPT_TYPE = 'attempt';
const LEARN_MODE = 'learn';
const ORDERED_MODE = 'ordered';
// The stage an attempt lands on when the reveal button was never pressed. Both
// instruction ladders are ['strategy', 'reveal'], so this is the same rung in
// both modes — which is what lets one predicate serve them.
const UNAIDED_STAGE = 'strategy';

/**
 * @typedef {{ ms: number, stage: string, wrong: number[] }} Attempt
 * @typedef {{ attempts: number, unaided: number, cleared: boolean }} Rung
 * @typedef {{
 *   id: string,
 *   fact: {op: string, a: number, b: number},
 *   bucket: 'cold' | 'warm' | 'hot',
 *   attempts: Attempt[],
 *   cleanCount: number,
 *   medianCleanMs: number | null,
 *   taught: boolean,
 *   taughtCount: number,
 *   ordered: Rung, — `attempts` counts RUNS; see the header
 *   learn: Rung,
 * }} FactStats
 * @typedef {{ byId: Map<string, FactStats>, confusions: Map<string, Set<number>> }} MasteryModel
 */

/**
 * Was this attempt produced without help?
 *
 * Two conditions, both required: the attempt landed at the strategy stage — the
 * reveal button was never pressed — and nothing wrong was typed first. Right in
 * the end after a wrong guess is not unaided; the wrong guess is the kid
 * telling you she did not have it.
 *
 * Both fields are already on every AttemptEvent. No new attempt fields, and no
 * log migration.
 *
 * A `wrong` array that is missing entirely reads as no wrong answers, matching
 * the core's own handling. A `wrong` array carrying junk from a corrupt line
 * reads as AIDED — the raw length is used, not the count of valid numbers,
 * because "was she right first time" is unanswerable from a corrupt line and
 * the safe direction is the one that does not clear a rung. Clearing peels a
 * fact permanently off the front of a run.
 *
 * @param {object} event
 * @returns {boolean}
 */
function isUnaided(event) {
  if (event.stage !== UNAIDED_STAGE) {
    return false;
  }
  return !Array.isArray(event.wrong) || event.wrong.length === 0;
}

/**
 * Turn a list of per-occasion outcomes, oldest first, into a rung record.
 *
 * `cleared` is the last-two rule: the most recent `config.unaidedRuns`
 * occasions were ALL unaided. Fewer occasions than that never clears, however
 * good they were — the threshold is a count of separate sittings, not a ratio.
 *
 * TRAP: `unaidedRuns` is read straight off the config and is not defended. A
 * config missing the key makes `outcomes.length < undefined` false and
 * `slice(length - NaN)` return the whole array, so `cleared` silently becomes
 * "every occasion ever was unaided" — plausible, permanent, and nothing throws.
 * Any new tunables table for this game must supply it.
 *
 * @param {boolean[]} outcomes oldest first
 * @param {number} unaidedRuns
 * @returns {Rung}
 */
function rungFrom(outcomes, unaidedRuns) {
  const recent = outcomes.slice(outcomes.length - unaidedRuns);
  return {
    attempts: outcomes.length,
    unaided: outcomes.filter(Boolean).length,
    cleared: outcomes.length >= unaidedRuns && recent.every(Boolean),
  };
}

/**
 * Collect per-fact outcomes for both instruction rungs from the raw event list.
 *
 * Events are filtered and sorted exactly as core/mastery.js does, for the same
 * reasons: file order is not chronological (the log client replays a queued
 * outbox at startup), and "the last two" has to mean the last two in TIME. A
 * corrupt line — non-finite `ms`, no fact, not an attempt — is dropped here too,
 * so a line that is corrupt for the buckets is corrupt for the rungs.
 *
 * An id outside the 121-fact space needs no check: the caller only ever reads
 * ids that are already keys of `byId`, so a stray one is collected and never
 * looked at.
 *
 * TRAP: ordered runs are grouped by the attempts' `session` id, NOT by
 * SessionEvents. A SessionEvent is written only when a session finishes
 * (`js/main.js`), so a run the kid abandoned halfway writes none at all while
 * its attempts are already on disk. Grouping by session events would silently
 * discard evidence she actually produced — the facts she reached before
 * stopping — and nothing would fail: the rung would just stay uncleared and the
 * run would stay long. Grouping from the attempts gives the correct answer, that
 * an abandoned run counts for the facts she reached and for nothing else.
 *
 * An ordered attempt with no session id is its own run, rather than being lumped
 * with every other sessionless attempt under one key — the same treatment
 * `taughtCount` gives a sessionless learn attempt, and for the same reason:
 * pooling them would make a whole old log count as one occasion.
 *
 * @param {object[]} events
 * @returns {{learn: Map<string, boolean[]>, ordered: Map<string, Map<string, boolean>>}}
 */
function collectRungOutcomes(events) {
  /** id -> one flag per learn attempt, oldest first. */
  const learn = new Map();
  /** id -> run key -> was that whole run unaided, runs in first-seen order. */
  const ordered = new Map();
  let looseRuns = 0;

  const usable = [];
  for (const event of events) {
    if (event === null || typeof event !== 'object') {
      continue;
    }
    if (event.type !== ATTEMPT_TYPE) {
      continue;
    }
    if (event.mode !== LEARN_MODE && event.mode !== ORDERED_MODE) {
      continue;
    }
    if (!Number.isFinite(event.ms)) {
      continue;
    }
    const id = mathSpace.idFromEvent(event);
    if (id === null) {
      continue;
    }
    usable.push({ id, event });
  }

  // Stable in Node 22, so equal timestamps fall back to file order.
  usable.sort((left, right) => compareTimestamps(left.event.t, right.event.t));

  for (const { id, event } of usable) {
    const unaided = isUnaided(event);

    if (event.mode === LEARN_MODE) {
      let outcomes = learn.get(id);
      if (outcomes === undefined) {
        outcomes = [];
        learn.set(id, outcomes);
      }
      outcomes.push(unaided);
      continue;
    }

    let runs = ordered.get(id);
    if (runs === undefined) {
      runs = new Map();
      ordered.set(id, runs);
    }
    const key =
      typeof event.session === 'string' && event.session !== ''
        ? event.session
        : `#loose${(looseRuns += 1)}`;
    // A run counts as unaided only if EVERY attempt it made on this fact was.
    // A run that served the fact twice because she got it wrong the first time
    // is not a run she produced it in.
    runs.set(key, (runs.get(key) ?? true) && unaided);
  }

  return { learn, ordered };
}

/**
 * Derive the mastery model from a list of log events.
 *
 * @param {object[]} events
 * @param {{retain: number, hotMs: number, maxPlausibleMs: number, unaidedRuns: number}} config
 * @returns {MasteryModel}
 */
export function deriveMastery(events, config) {
  const model = deriveCoreMastery(events, config, mathSpace);
  const outcomes = collectRungOutcomes(events);

  // `byId` is total over the fact space, so this reaches every fact and a fact
  // with no history gets {attempts: 0, unaided: 0, cleared: false} rather than
  // an absent record. Nothing downstream has to guard.
  for (const stats of model.byId.values()) {
    stats.ordered = rungFrom(
      [...(outcomes.ordered.get(stats.id)?.values() ?? [])],
      config.unaidedRuns,
    );
    stats.learn = rungFrom(outcomes.learn.get(stats.id) ?? [], config.unaidedRuns);
  }

  return model;
}
