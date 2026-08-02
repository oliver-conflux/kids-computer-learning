// The frontier: which stretch of the spine the game is currently working on.
//
// Nothing here is stored. There is no saved position, no advancement threshold
// and no placement test — the log is the placement test, and the window is
// recomputed from the mastery model on every load exactly the way buckets are.
// The rule is one line: the first `size` items in spine order that are not yet
// hot. Mastered items drop out and the window slides forward on its own, which
// is what lets a four-year-old and a ten-year-old run identical code and land in
// completely different regions of the same spine with no level setting anywhere.
//
// THE PROPERTY THIS MODULE EXISTS TO PROTECT: one stubborn item cannot block the
// window. An item the kid cannot get is not hot, so it stays in and keeps being
// served — but the items behind it advance past it regardless. The obvious
// alternative, "advance once the first N are all hot", stalls the whole game on a
// single leech, and that is the failure mode that makes a kid quit.
//
// So the window is a FILTER over the spine, never a contiguous slice of it. That
// distinction is the entire design, and it is the thing to check first if the
// frontier ever stops moving.
//
// Pure module: no DOM, no network, no clock, no randomness.

const HOT = 'hot';

/**
 * @typedef {import('./mastery.js').MasteryModel} MasteryModel
 */

/**
 * The active window: the first `size` ids in spine order that are not hot.
 *
 * BOTH `spine` AND `space` are passed in rather than read off one game's adapter,
 * and for the same reason: the rule has to be runnable against something other
 * than the shipped list — a fixture here, a candidate reordering in
 * tools/replay.js, a different game entirely. The id encoding is the adapter's
 * and is never restated here; ids are written into a log that is read back months
 * later, so a second copy of `w:${word}` would be a second chance to change it by
 * half.
 *
 * A spine entry with no entry in `model.byId` is treated as NOT hot. In practice
 * that cannot happen: `deriveMastery` keeps `byId` total over the item space. But
 * the safe reading of a missing key is "no evidence yet", which is the cold case,
 * and the alternative — treating an unknown word as hot — would silently drop it
 * out of the game with nothing to show for it.
 *
 * A `size` of zero or less yields an empty window rather than throwing; the
 * caller has configured the game off, which is a strange thing to do but not a
 * corrupt one.
 *
 * @param {object[]} spine in difficulty order
 * @param {MasteryModel} model from core/mastery.js
 * @param {number} size how many items the kid works on at once
 * @param {import('./space.js').ItemSpace} space
 * @returns {string[]} ids, in spine order
 */
export function activeWindow(spine, model, size, space) {
  const active = [];

  for (const entry of spine) {
    if (active.length >= size) {
      break;
    }
    const id = space.itemId(entry);
    const stats = model.byId.get(id);
    if (stats !== undefined && stats.bucket === HOT) {
      continue; // mastered — it has left the window, and the window fills from further down
    }
    active.push(id);
  }

  return active;
}
