// The scheduler: which item comes next.
//
// A weighted sample over the candidate items — weight by bucket, `cold` 6,
// `warm` 3, `hot` 1 — narrowed by three constraints. Hot keeps a weight of 1
// rather than 0 on purpose: a mastered item that disappears entirely stops being
// evidence, and the cheapest way to know an item is still fluent is to ask it
// occasionally.
//
// The three constraints, in order:
//
//   1. No repeat within `config.noRepeatWithin` items — AND that exclusion
//      covers everything `space.relatedIds` names. In the math game that is the
//      transpose: serving 7×6 immediately after 6×7 gets answered out of working
//      memory rather than long-term retrieval, and logs a fast latency that
//      means nothing. The two orientations are separate items precisely so they
//      can be scheduled independently, which is exactly what makes this
//      adjacency guard necessary rather than optional. A space with no such
//      relation returns `[]` and this costs nothing.
//   2. Interference guard. If a wrong answer recorded for item A equals the
//      correct answer of item B, A and B are a confusion pair, and they are not
//      served adjacently while EITHER is cold. Once both are warm or better the
//      guard lifts — juxtaposing two items a kid can now retrieve is useful
//      discrimination practice, not a trap.
//   3. Success governor. Over the last `config.governorWindow` items, if the
//      clean rate is below `config.governorFloor`, force a hot item. This is
//      what stops a bad night becoming twenty consecutive hard problems; ~80%
//      success is the band where learning per repetition is highest.
//
// Everything item-specific arrives through the `space` adapter — see
// core/space.js. This module never knows what an item is.
//
// Pure module: no DOM, no network, no clock, no randomness of its own. `rng` is
// injected and is the ONLY source of nondeterminism, which is what lets
// tools/replay.js re-run a session and get the same sequence back.

import { itemKeyOf } from './space.js';

const COLD = 'cold';
const HOT = 'hot';
const CLEAN_STAGE = 'clean';

/** The default `itemWeight`: every item carries only its bucket weight. */
const UNIFORM_ITEM_WEIGHT = () => 1;

/**
 * The last `count` entries of a list, most recent last. Never mutates.
 *
 * @param {string[]} history
 * @param {number} count
 * @returns {string[]}
 */
function tailOf(history, count) {
  if (count <= 0) {
    return [];
  }
  return count >= history.length ? history.slice() : history.slice(history.length - count);
}

/**
 * Ids barred by the no-repeat window: everything served in the last
 * `config.noRepeatWithin` items, plus everything `space.relatedIds` names for
 * each of them.
 *
 * `relatedIds` is not a canonicalisation — it names the other items so they can
 * be excluded, it does not merge records with them.
 *
 * @param {string[]} history
 * @param {{noRepeatWithin: number}} config
 * @param {import('./space.js').ItemSpace} space
 * @returns {Set<string>}
 */
function recentlyServed(history, config, space) {
  const blocked = new Set();
  for (const id of tailOf(history, config.noRepeatWithin)) {
    blocked.add(id);
    for (const related of space.relatedIds(id)) {
      blocked.add(related);
    }
  }
  return blocked;
}

/**
 * Are these two items a confusion pair? True when a wrong answer ever recorded
 * for one of them is the correct answer of the other. The relation is checked
 * in both directions because either item's history can be the evidence.
 *
 * `model.confusions` is total and all-time by design — every item is a key,
 * mapping to an empty Set where nothing was recorded, and a wrong answer from
 * weeks ago never ages out. It is used exactly as given.
 *
 * The comparison is `Set.has`, so `answerValue` must produce a value of the same
 * type the log's `wrong` entries carry. That is the whole reason `answerValue`
 * and `targetOf` are separate members of the adapter: math's answer is the
 * number 42 and its target is the string "42", and comparing the string would
 * make this guard silently never fire.
 *
 * @param {{byId: Map<string, object>, confusions: Map<string, Set<unknown>>}} model
 * @param {string} idA
 * @param {string} idB
 * @param {import('./space.js').ItemSpace} space
 * @returns {boolean}
 */
function isConfusionPair(model, idA, idB, space) {
  const itemKey = itemKeyOf(space);
  const answerA = space.answerValue(model.byId.get(idA)[itemKey]);
  const answerB = space.answerValue(model.byId.get(idB)[itemKey]);
  return model.confusions.get(idA).has(answerB) || model.confusions.get(idB).has(answerA);
}

/**
 * Ids barred by the interference guard. "Adjacent" means directly after the
 * item just served, so the guard is evaluated against the last history entry
 * only — a confusion pair two items apart is fine.
 *
 * The guard applies while EITHER item of the pair is cold, and lifts when both
 * have reached warm.
 *
 * SCOPE, AND WHY IT IS NOT SYMMETRIC. The blocked set is drawn from `candidates`
 * only, because that is the only set it can bite on — the result is intersected
 * with the candidates during the sampling pass either way, so restricting it
 * here changes nothing and saves walking an item space the caller has already
 * excluded. The PREVIOUS id is taken from history regardless of whether it is
 * still a candidate: what the kid just saw is a fact about the session, not
 * about the current window, and a window that slid between two problems must not
 * quietly switch the guard off.
 *
 * @param {{byId: Map<string, object>, confusions: Map<string, Set<unknown>>}} model
 * @param {string[]} history
 * @param {string[]} candidates
 * @param {import('./space.js').ItemSpace} space
 * @returns {Set<string>}
 */
function interferingWithLast(model, history, candidates, space) {
  const blocked = new Set();
  if (history.length === 0) {
    return blocked;
  }
  const previousId = history[history.length - 1];
  const previous = model.byId.get(previousId);
  for (const id of candidates) {
    if (id === previousId) {
      continue;
    }
    if (previous.bucket !== COLD && model.byId.get(id).bucket !== COLD) {
      continue;
    }
    if (isConfusionPair(model, previousId, id, space)) {
      blocked.add(id);
    }
  }
  return blocked;
}

/**
 * Clean rate over the recent history window, or null when there is no evidence
 * to judge on.
 *
 * NON-OBVIOUS, AND THE REASON THIS FUNCTION EXISTS: `history` carries ItemIds
 * only — it does NOT carry outcomes. A future reader will assume otherwise, so:
 * the outcome of each item in the window is recovered from the mastery model's
 * retained attempts for that id. `ItemStats.attempts` is most-recent-LAST and
 * holds at most `config.retain` entries, so the n-th most recent occurrence of
 * an id in the window maps to the n-th attempt from the end of that item's
 * retained list. Walking the window backwards and consuming one retained
 * attempt per occurrence keeps an item served twice in the window from being
 * scored twice against the same attempt.
 *
 * An item whose attempt has already fallen out of the retained window (or was
 * never recorded, e.g. a problem still in flight) is skipped rather than
 * counted as a failure — absent evidence is not bad evidence.
 *
 * THE WINDOW IS NOT RESTRICTED TO `candidates`, deliberately. The governor asks
 * "how is this sitting going for the kid", and every item she was actually
 * served answers that, including one that has since left the candidate window.
 * Filtering the window down to what is currently eligible would discard real
 * evidence and, on a small window, could empty it entirely — turning the
 * governor off at exactly the moment a struggling session most needs it.
 *
 * @param {{byId: Map<string, object>}} model
 * @param {string[]} history
 * @param {{governorWindow: number}} config
 * @returns {number | null} 0..1, or null when nothing in the window is scorable
 */
function recentCleanRate(model, history, config) {
  const recent = tailOf(history, config.governorWindow);
  /** @type {Map<string, number>} */
  // CALLER REQUIREMENT — the model MUST include this session's attempts.
  //
  // `history` carries item ids and no outcomes, so the recent clean rate is
  // recovered from each item's retained attempts below. That only works if the
  // model has actually seen this session. Pass a model derived once at load and
  // the governor is not merely blind — it is scored against the WRONG evidence:
  // an item answered well yesterday and badly today reads as yesterday's success.
  //
  // Measured in the math game: eight facts aced yesterday (hot) and bombed today
  // at 'reveal' give a true clean rate of 0.00 against a floor of 0.8. With a
  // stale model the governor fires on 1% of picks; with the model re-derived per
  // problem it fires on 100%. Nothing throws either way, so the failure is
  // invisible — the 80% floor silently ceases to exist and a struggling kid
  // receives a run of consecutive cold items, the exact bad night this mechanism
  // exists to stop.
  //
  // Re-derive mastery after every completed problem. It is cheap next to a kid
  // typing an answer.
  const consumed = new Map();
  let scored = 0;
  let clean = 0;

  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const id = recent[index];
    const alreadyUsed = consumed.get(id) ?? 0;
    consumed.set(id, alreadyUsed + 1);

    const { attempts } = model.byId.get(id);
    const attempt = attempts[attempts.length - 1 - alreadyUsed];
    if (attempt === undefined) {
      continue;
    }
    scored += 1;
    if (attempt.stage === CLEAN_STAGE) {
      clean += 1;
    }
  }

  return scored === 0 ? null : clean / scored;
}

/**
 * Weighted pick from parallel id/weight lists, drawing one number from `rng`.
 * Falls back to a uniform pick if every weight is zero, so a pathological
 * tunables table — or an `itemWeight` that zeroes everything — still yields a
 * problem rather than nothing.
 *
 * @param {string[]} ids non-empty
 * @param {number[]} weights
 * @param {() => number} rng
 * @returns {string}
 */
function sampleWeighted(ids, weights, rng) {
  const draw = rng();
  const roll = Number.isFinite(draw) ? Math.min(Math.max(draw, 0), 0.9999999999) : 0;

  let total = 0;
  for (const weight of weights) {
    total += weight > 0 ? weight : 0;
  }

  if (total <= 0) {
    const index = Math.min(ids.length - 1, Math.floor(roll * ids.length));
    return ids[index];
  }

  let cursor = roll * total;
  for (let index = 0; index < ids.length; index += 1) {
    cursor -= weights[index] > 0 ? weights[index] : 0;
    if (cursor < 0) {
      return ids[index];
    }
  }
  return ids[ids.length - 1];
}

/**
 * Pick the next item to serve. Returns an ItemId, not an item — the id is what
 * the log, the history and both derived maps are keyed by, and a caller that
 * wants the item itself has the model in hand.
 *
 * Constraints are applied as filters over the candidate set before sampling,
 * not as rejection after it, so a draw always lands on something legal.
 *
 * If the constraints together eliminate every candidate, they are relaxed one at
 * a time, in this order, and this order is deliberate:
 *
 *   1. the governor goes first — it is a comfort mechanism, and an easy problem
 *      is worth less than a legal one;
 *   2. then the confusion guard — pedagogical, valuable, but a single adjacent
 *      confusion pair is a missed opportunity rather than a broken session;
 *   3. no-repeat goes last, because repeating a problem the kid just answered is
 *      the failure that looks most obviously broken from the other side of the
 *      screen.
 *
 * The final relaxation leaves every candidate eligible, so this never returns
 * undefined for a non-empty candidate set.
 *
 * TWO DIALS, NOT ONE. `candidates` decides WHICH items are in play and
 * `itemWeight` decides how often each is served relative to the others; the
 * bucket weight is what the kid knows and `itemWeight` is a property of the item
 * itself. They are separate parameters because they answer separate questions,
 * and a game that needs neither passes neither.
 *
 * `itemWeight` multiplies the bucket weight rather than replacing it, so an
 * awkward item is served less often but never never — the adapter's own floor is
 * what keeps the product away from zero, and `sampleWeighted` falls back to a
 * uniform draw if it ever reaches it anyway.
 *
 * @param {object} options
 * @param {{byId: Map<string, object>, confusions: Map<string, Set<unknown>>}} options.model
 * @param {string[]} options.history ItemIds served this session, most recent LAST
 * @param {{weights: object, noRepeatWithin: number, governorWindow: number, governorFloor: number}} options.config
 * @param {() => number} options.rng injected source in [0,1) — the only nondeterminism here
 * @param {import('./space.js').ItemSpace} options.space
 * @param {string[]} [options.candidates] ids to sample from; defaults to every id in the model
 * @param {(id: string) => number} [options.itemWeight] per-item multiplier; defaults to 1
 * @returns {string}
 */
export function pickNext({
  model,
  history,
  config,
  rng,
  space,
  candidates = [...model.byId.keys()],
  itemWeight = UNIFORM_ITEM_WEIGHT,
}) {
  const repeatBlocked = recentlyServed(history, config, space);
  const confusionBlocked = interferingWithLast(model, history, candidates, space);
  const cleanRate = recentCleanRate(model, history, config);
  const governorOn = cleanRate !== null && cleanRate < config.governorFloor;

  const passes = [
    { governor: governorOn, confusion: true, noRepeat: true },
    { governor: false, confusion: true, noRepeat: true },
    { governor: false, confusion: false, noRepeat: true },
    { governor: false, confusion: false, noRepeat: false },
  ];

  for (const pass of passes) {
    const eligible = [];
    const weights = [];
    for (const id of candidates) {
      const stats = model.byId.get(id);
      if (pass.governor && stats.bucket !== HOT) {
        continue;
      }
      if (pass.noRepeat && repeatBlocked.has(id)) {
        continue;
      }
      if (pass.confusion && confusionBlocked.has(id)) {
        continue;
      }
      eligible.push(id);
      weights.push(config.weights[stats.bucket] * itemWeight(id));
    }
    if (eligible.length > 0) {
      return sampleWeighted(eligible, weights, rng);
    }
  }

  // Reachable only when `candidates` was empty to begin with: the last pass
  // applies no filters. An empty candidate set is a caller bug — a window that
  // slid off the end of its spine, say — and it is worth a loud failure rather
  // than a silent undefined that surfaces three frames later in the renderer.
  throw new Error('pickNext: the candidate set was empty');
}
