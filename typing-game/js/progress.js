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

/** Guidance level at or below which a 3-star round earns the hands-off badge. */
const HANDS_OFF_GUIDANCE = 1;

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
 * @returns {{stars: number, bestAccuracy: number, bestWpm: number, attempts: number, handsOff: boolean}}
 */
export function forLesson(events, lessonId) {
  let stars = 0;
  let bestAccuracy = 0;
  let bestWpm = 0;
  let attempts = 0;
  let handsOff = false;

  for (const event of events) {
    const round = asRound(event, lessonId);
    if (round === null) continue;

    attempts += 1;

    const roundStars = starsFor(round.accuracy);
    stars = Math.max(stars, roundStars);
    bestAccuracy = Math.max(bestAccuracy, Math.round(round.accuracy * 100));

    const wpm = typeof round.wpm === 'number' && Number.isFinite(round.wpm) ? round.wpm : 0;
    bestWpm = Math.max(bestWpm, Math.round(wpm));

    const guidance = typeof round.guidance === 'number' ? round.guidance : Infinity;
    if (roundStars === 3 && guidance <= HANDS_OFF_GUIDANCE) handsOff = true;
  }

  return { stars, bestAccuracy, bestWpm, attempts, handsOff };
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
