// typing-game/js/progress.js
//
// Progress is DERIVED, never stored (spec §9a). The log is the source of truth,
// and everything a kid sees about their history — stars, bests, badges, attempt
// counts — is computed on read from `round` events.
//
// The payoff is that changing a star threshold re-scores all history instead of
// leaving stale stars on disk. The cost is that this module must tolerate every
// shape a log line has ever had, including corrupt ones. A malformed event is
// skipped, never thrown: a kid must always be able to play.
//
// Pure module: no DOM, no network, no clock, no randomness.

const TWO_STAR_ACCURACY = 0.90;
const THREE_STAR_ACCURACY = 0.95;

/**
 * Stars for a round's accuracy. Finishing at all earns one — the ladder is a
 * soft gate and nobody gets stuck (spec §9).
 *
 * @param {number} accuracy 0..1
 * @returns {number} 1, 2, or 3
 */
export function starsFor(accuracy) {
  if (accuracy >= THREE_STAR_ACCURACY) return 3;
  if (accuracy >= TWO_STAR_ACCURACY) return 2;
  return 1;
}

/**
 * Accuracy as the whole-number percentage a kid is SHOWN.
 *
 * Floored, never rounded, and it lives here rather than in ui.js so it cannot
 * drift from starsFor. Rounding 0.9459 to "95%" next to a two-star result reads
 * to a kid as the game cheating them out of a star it just told them they
 * earned. Flooring keeps the number and the stars telling the same story: the
 * displayed percentage crosses a threshold exactly when the stars do.
 *
 * @param {number} accuracy 0..1
 * @returns {number} 0..100
 */
export function displayAccuracy(accuracy) {
  return Math.floor(accuracy * 100);
}

/** A round event we can actually score, or null. */
function asRound(event, lessonId) {
  if (event === null || typeof event !== 'object' || Array.isArray(event)) return null;
  if (event.type !== 'round') return null;
  if (event.lesson !== lessonId) return null;
  if (typeof event.accuracy !== 'number' || !Number.isFinite(event.accuracy)) return null;
  return event;
}

/**
 * Derive one lesson's progress from a tail of log events.
 *
 * @param {object[]} events
 * @param {string} lessonId
 * @returns {{stars: number, bestAccuracy: number, bestWpm: number, attempts: number}}
 */
export function forLesson(events, lessonId) {
  let stars = 0;
  let bestAccuracy = 0;
  let bestWpm = 0;
  let attempts = 0;

  for (const event of events) {
    const round = asRound(event, lessonId);
    if (round === null) continue;

    attempts += 1;

    const roundStars = starsFor(round.accuracy);
    stars = Math.max(stars, roundStars);
    bestAccuracy = Math.max(bestAccuracy, displayAccuracy(round.accuracy));

    const wpm = typeof round.wpm === 'number' && Number.isFinite(round.wpm) ? round.wpm : 0;
    bestWpm = Math.max(bestWpm, Math.round(wpm));

  }

  return { stars, bestAccuracy, bestWpm, attempts };
}

/**
 * Every lesson mentioned by the events, keyed by lesson id.
 *
 * @param {object[]} events
 * @returns {Record<string, object>}
 */
export function allProgress(events) {
  const ids = new Set();
  for (const event of events) {
    if (event !== null && typeof event === 'object' && event.type === 'round' &&
        typeof event.lesson === 'string') {
      ids.add(event.lesson);
    }
  }
  const out = {};
  for (const id of ids) out[id] = forLesson(events, id);
  return out;
}
