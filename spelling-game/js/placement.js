// Placement: where she is in the spine, what she has finished with, and what is
// worth drilling right now.
//
// THE ONE IDEA THIS MODULE EXISTS TO PROTECT: a miss produces INFORMATION, not
// an OBLIGATION.
//
// Those are two different decisions and the old design fused them. Every missed
// word became a drill word, which meant the only safe way to choose what to show
// was to walk the spine in order — and walking in order is how a kid who can
// already spell `necessary` ends up spending months on three-letter words before
// anyone finds out.
//
// Split, both halves get to be right:
//
//   probe selection    WIDE   — any word in the catalogue, so a word she already
//                               owns is discovered and retired on one sighting
//   admission to drill NARROW — a missed word only becomes a drill word if it is
//                               near her frontier; the rest are released
//
// Simulated over a synthetic learner, releasing deep misses was worth 120–190
// extra mastered words on the same budget and cut wasted repetitions three- to
// fourfold, at every level of ability. Random probing went from the WORST policy
// to the BEST the moment misses stopped sticking. See the spec for the tables.
//
// Nothing here is stored. Cursor, marking, admission and deferral are all
// recomputed from the log on every read, exactly the way buckets are. That is
// what lets `probeMargin` be changed later and all of history re-read under the
// new value — and it is the property to check first if any of this ever needs
// retuning. If placement state ever gets written into the log as a decision, the
// design has failed.
//
// Pure module: no DOM, no network, no clock, no randomness. `probePool` comes
// back in spine order rather than shuffled for exactly that reason — the caller
// owns the rng.

const CLEAN_STAGE = 'clean';

/**
 * @typedef {import('../../core/mastery.js').MasteryModel} MasteryModel
 * @typedef {import('../../core/space.js').ItemId} ItemId
 *
 * @typedef {{
 *   cursor: number,
 *   marked: Set<ItemId>,
 *   drill: ItemId[],
 *   pending: ItemId[],
 *   deferred: Set<ItemId>,
 *   probePool: ItemId[],
 * }} Placement
 *
 * The five sets PARTITION the spine: every word is in exactly one, always. That
 * is not decoration — it is the invariant that makes "where did that word go?"
 * answerable, and both bugs found during Wave 1 were words falling through the
 * gaps between sets that did not quite cover.
 */

/**
 * Is this word finished with?
 *
 * Two ways in, and the first is the whole reason this design is faster than what
 * it replaces:
 *
 * 1. **Clean on the very first sighting.** One observation, and it is enough
 *    here for a reason specific to spelling: GUESSING IS IMPOSSIBLE. You do not
 *    produce `because` by chance. Free-recall spelling has a guess probability
 *    of essentially zero, unlike the multiple-choice settings the "three in a
 *    row" convention comes from, where a quarter of correct answers are luck.
 *    A clean first answer really is strong evidence of retrieval.
 *
 * 2. **Three clean answers spanning `markSpanSessions` sittings.** For anything
 *    she missed the first time. Three in one sitting measures short-term memory;
 *    the session spread is what makes it retention.
 *
 * THE HOMOPHONE EXCEPTION IS LOAD-BEARING. Drill flashes a homophone on screen
 * before asking, because audio alone cannot say whether `sea` or `see` is wanted
 * — the word on screen IS the question. So a first-sight correct answer on a
 * homophone is partly copying, and route 1 would retire 64 spine words on
 * evidence that is not retrieval. Homophones take route 2 whatever happens.
 *
 * Note the asymmetry running through all of this: CORRECTS ARE TRUSTED, MISSES
 * ARE INVESTIGATED. Slips are common at seven — typos, mishearings, a moment's
 * distraction — so a miss is weak evidence and never a verdict.
 *
 * @param {import('../../core/mastery.js').ItemStats} stats
 * @param {string} word
 * @param {(word: string) => boolean} needsFullProof
 * @param {{markSpanSessions: number}} config
 * @returns {boolean}
 */
function isMarked(stats, word, needsFullProof, config) {
  if (stats.firstAttempt === null) {
    return false;
  }

  const firstWasClean = stats.firstAttempt.stage === CLEAN_STAGE;
  if (firstWasClean && !needsFullProof(word)) {
    return true;
  }

  return stats.cleanTotal >= 3 && stats.cleanSessions >= config.markSpanSessions;
}

/**
 * Derive the placement model.
 *
 * `spine` is a parameter rather than an import for the same reason
 * `core/frontier.js` takes one: the rule has to be runnable against a fixture, a
 * candidate reordering, or the audio-filtered `PLAYABLE` list. A word's POSITION
 * is its index in this array — there is no separate position lookup, because a
 * second source for the same fact is a second chance for the two to disagree.
 *
 * `needsFullProof` is injected rather than importing `homophones.js`, so this
 * module stays testable without the real list and so the rule stays visible at
 * the call site.
 *
 * The cursor and the admission decisions come out of ONE forward pass over first
 * sightings in timestamp order. They have to share a pass: admission asks "was
 * this word within reach *at the time she met it*", which is a question about a
 * cursor that no longer exists once the pass has moved on.
 *
 * @param {MasteryModel} model from core/mastery.js
 * @param {object[]} spine in difficulty order
 * @param {{probeMargin: number, drillCap: number, cursorStepUp: number,
 *          cursorStepDown: number, markSpanSessions: number}} config
 * @param {(word: string) => boolean} needsFullProof
 * @returns {Placement}
 */
export function derivePlacement(model, spine, config, needsFullProof) {
  /** @type {Set<ItemId>} */
  const marked = new Set();
  /** @type {Set<ItemId>} */
  const deferred = new Set();
  /** @type {Set<ItemId>} */
  const admitted = new Set();

  // Position lookup for this call only. Built once rather than per-item, because
  // the alternative is a findIndex inside a loop over a 995-word spine.
  /** @type {Map<ItemId, number>} */
  const positionById = new Map();
  /** @type {Map<ItemId, string>} */
  const wordById = new Map();
  spine.forEach((entry, index) => {
    const itemId = `w:${entry.word}`;
    positionById.set(itemId, index);
    wordById.set(itemId, entry.word);
  });

  // First sightings, oldest first. A word with no attempts has no first sighting
  // and takes no part in the cursor.
  //
  // Ties on `t` fall back to spine position rather than to map insertion order.
  // Two attempts sharing a timestamp is rare but a replay must not depend on
  // which one the Map happened to hold first.
  const sightings = [];
  for (const [itemId, stats] of model.byId) {
    if (stats.firstAttempt === null || !positionById.has(itemId)) {
      continue;
    }
    sightings.push({ itemId, stats, position: positionById.get(itemId) });
  }
  sightings.sort((left, right) => {
    const leftT = typeof left.stats.firstAttempt.t === 'string' ? left.stats.firstAttempt.t : '';
    const rightT = typeof right.stats.firstAttempt.t === 'string' ? right.stats.firstAttempt.t : '';
    if (leftT !== rightT) {
      return leftT < rightT ? -1 : 1;
    }
    return left.position - right.position;
  });

  // THE FORWARD PASS. Cursor and admission, in one walk.
  //
  // The steps are asymmetric on purpose, and it is the same asymmetry as the
  // marking rule: a correct answer is strong evidence, so the cursor advances
  // confidently past it; a miss is weak, so the retreat is generous and
  // provisional rather than a judgement about her ceiling.
  let cursor = 0;
  for (const { itemId, stats, position } of sightings) {
    if (stats.firstAttempt.stage === CLEAN_STAGE) {
      cursor = Math.max(cursor, position - config.cursorStepUp);
      continue;
    }

    // ADMISSION USES THE CURSOR AS IT STOOD BEFORE THIS MISS. The question is
    // whether the word was within reach given what we knew when she met it, not
    // what we know having just watched her miss it. Applying the retreat first
    // would let a miss lower the bar and then admit itself under the lower bar.
    if (position <= cursor + config.probeMargin) {
      admitted.add(itemId);
    } else {
      deferred.add(itemId);
    }

    cursor = Math.min(cursor, position + config.cursorStepDown);
  }

  // Marking is independent of the pass — it reads only per-item facts — so it
  // runs over the whole spine rather than over sightings, which keeps the result
  // total and makes the "exactly one bucket" property below easy to hold.
  for (const [itemId, stats] of model.byId) {
    if (!positionById.has(itemId)) {
      continue;
    }
    if (isMarked(stats, wordById.get(itemId), needsFullProof, config)) {
      marked.add(itemId);
    }
  }

  // A marked word is finished with, whatever else was true of it. Clearing it
  // from both other sets is what stops it reappearing as a probe or a drill.
  for (const itemId of marked) {
    admitted.delete(itemId);
    deferred.delete(itemId);
  }

  // A deferred word rejoins the game once the cursor has caught up with it — and
  // it rejoins as a DRILL word, not as a probe.
  //
  // The spec first said probe, written while a re-probe was still expected to
  // reset the word's first sighting. That reset was rejected on 2026-08-03: the
  // miss stands. Given it stands, the word already needs three clean answers,
  // and probing it again would spend a problem asking a question whose answer is
  // on file. The first drill turn serves as the re-check for free.
  //
  // Recomputed here rather than recorded as a transition, which is what keeps
  // `probeMargin` retunable — change it and this boundary moves for all history.
  for (const itemId of [...deferred]) {
    if (positionById.get(itemId) <= cursor + config.probeMargin) {
      deferred.delete(itemId);
      admitted.add(itemId);
    }
  }

  // Spine order for all three lists. The drill cap is a slice of the front
  // rather than a sample: taking the easiest stuck words first is what keeps the
  // set converting instead of stalling on a leech.
  //
  // THE RULE THAT MAKES THIS TOTAL: a word she has MET and that is not finished
  // with needs drilling, whatever route it took to get here. Stating it as
  // "admitted" alone leaves two holes, and both were live bugs found by running
  // this against the real log:
  //
  //   - A HOMOPHONE ANSWERED CLEANLY FIRST TIME. Not marked, because the flash
  //     means a first-sight correct is partly copying. Never missed, so never
  //     admitted. Has a first sighting, so not a probe. It fell through all
  //     three and vanished from the game — unreachable and unmarkable, for up to
  //     64 words. The exception in `isMarked` cannot be written without this
  //     catch, and that coupling is the thing to remember.
  //   - AN ADMITTED WORD PAST `drillCap`. It has a slot waiting, not no slot at
  //     all, and it must not evaporate while it waits.
  //
  // So `pending` exists to make the model total. Nothing serves from it; it is
  // the queue behind `drill` and the reason every spine word can be accounted
  // for. If a word is ever in none of the five sets, that is a bug.
  const drill = [];
  const pending = [];
  const probePool = [];
  for (const entry of spine) {
    const itemId = `w:${entry.word}`;
    if (marked.has(itemId) || deferred.has(itemId)) {
      continue;
    }

    const stats = model.byId.get(itemId);
    const hasBeenMet = stats !== undefined && stats.firstAttempt !== null;

    if (!hasBeenMet) {
      // Never sighted. That is the ONLY way into the probe pool: a word she has
      // met is a word we have evidence about, and evidence is drilled or
      // deferred rather than re-asked.
      probePool.push(itemId);
      continue;
    }

    if (drill.length < config.drillCap) {
      drill.push(itemId);
    } else {
      pending.push(itemId);
    }
  }

  return { cursor, marked, drill, pending, deferred, probePool };
}
