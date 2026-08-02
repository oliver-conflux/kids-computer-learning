// typing-game/js/nextup.js
//
// "Keep going" — what to play next when a kid does not want to choose.
//
// DERIVED FROM THE LOG, LIKE ALL PROGRESS (spec §9a). There is no saved
// bookmark, no "current lesson" pointer, no queue on disk. The pool is
// recomputed from the round history every time, which means a re-scored star
// threshold moves the pool with it and a kid who plays a lesson by hand from the
// menu changes what comes next. A stored pointer would drift out of agreement
// with the stars the kid is looking at; this cannot.
//
// The pool is built in three tiers and then trimmed to three:
//
//   1. STUCK — played, under 3 stars, weakest first. The work that is actually
//      owed.
//   2. UNPLAYED — the ladder in order, to top the pool up. This is what makes a
//      kid stuck on one lesson still advance: with only one lesson owed, two
//      new ones come along with it.
//   3. FINISHED — 3-starred lessons, in ladder order, only if the first two
//      tiers cannot fill three. The button must never go dead; nothing in this
//      game is ever locked (spec §9).
//
// Then the LAST-PLAYED lesson is dropped, whichever tier it landed in, and the
// remaining three are shuffled. Dropping it is what stops "Keep going" from
// serving the round that just ended — and because it is dropped rather than
// demoted, a lesson a kid is stuck on comes straight back on the following
// turn. Two stuck lessons therefore alternate, which is the intended feel.
//
// Pure module: no DOM, no network, no clock, no randomness of its own — the rng
// is injected, exactly as content.itemsFor takes one, so a pick is reproducible
// in a test.

import { lessonsForTrack } from './curriculum.js';
import { allProgress } from './progress.js';

/** How many lessons a kid is shuffled between. Three, per the design. */
const POOL_SIZE = 3;

const UNPLAYED = { stars: 0, attempts: 0 };

/**
 * The lesson of the most recent round in the log, or null.
 *
 * NOT scoped to the track being asked about. What this excludes is the round
 * that just ended, and "just ended" is a fact about the whole log — a kid who
 * finishes a letters round and then asks the numbers track what to play next
 * has nothing owed to them there, so the number lesson they last played is a
 * perfectly good answer. Filtering per track would wrongly skip it.
 *
 * Walks backwards because the tail is append-ordered and the answer is nearly
 * always the final event. Malformed events are skipped rather than thrown on,
 * for the same reason progress.js tolerates them: a kid must always be able to
 * play.
 */
function lastPlayed(events) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event === null || typeof event !== 'object' || Array.isArray(event)) continue;
    if (event.type !== 'round') continue;
    if (typeof event.lesson !== 'string') continue;
    return event.lesson;
  }
  return null;
}

/**
 * The lessons "Keep going" will shuffle between, best candidate first.
 *
 * Exported for its own sake as well as for pickNext: it is the honest answer to
 * "why did it give me that one?", and it is what the tests assert against so
 * they do not have to reason about the rng.
 *
 * @param {object[]} events log tail, oldest first
 * @param {string} track 'letters' or 'numbers'
 * @returns {string[]} at most POOL_SIZE lesson ids; empty only for an unknown track
 */
export function candidates(events, track) {
  const ladder = lessonsForTrack(track).map((l) => l.id);
  const progress = allProgress(events);
  const of = (id) => progress[id] ?? UNPLAYED;

  // Built in ladder order and sorted with a stable sort, so lessons tied on
  // stars stay in difficulty order without a tiebreak comparator.
  const stuck = ladder
    .filter((id) => of(id).attempts > 0 && of(id).stars < 3)
    .sort((a, b) => of(a).stars - of(b).stars);
  const unplayed = ladder.filter((id) => of(id).attempts === 0);
  const finished = ladder.filter((id) => of(id).attempts > 0 && of(id).stars >= 3);

  const last = lastPlayed(events);
  return [...stuck, ...unplayed, ...finished]
    .filter((id) => id !== last)
    .slice(0, POOL_SIZE);
}

/**
 * One lesson to play next, drawn from `candidates`.
 *
 * @param {object[]} events log tail, oldest first
 * @param {string} track 'letters' or 'numbers'
 * @param {() => number} rng returns 0..1 — injected so a pick is reproducible
 * @returns {string | null} null only when the track has nothing left to offer
 */
export function pickNext(events, track, rng) {
  const pool = candidates(events, track);
  if (pool.length === 0) return null;
  return pool[Math.floor(rng() * pool.length) % pool.length];
}
