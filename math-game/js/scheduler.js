// The scheduler: which fact comes next.
//
// A weighted sample over all 121 facts — weight by bucket, `cold` 6, `warm` 3,
// `hot` 1 — narrowed by three constraints (spec §7). Hot keeps a weight of 1
// rather than 0 on purpose: a mastered fact that disappears entirely stops being
// evidence, and the cheapest way to know a fact is still fluent is to ask it
// occasionally.
//
// The three constraints, in order:
//
//   1. No repeat within `config.noRepeatWithin` items — AND that exclusion
//      covers the transpose. Serving 7×6 immediately after 6×7 gets answered out
//      of working memory rather than long-term retrieval, and logs a fast
//      latency that means nothing. The two orientations are separate facts
//      precisely so they can be scheduled independently, which is exactly what
//      makes this adjacency guard necessary rather than optional.
//   2. Interference guard. If a wrong answer recorded for fact A equals the
//      correct answer of fact B, A and B are a confusion pair, and they are not
//      served adjacently while EITHER is cold. Once both are warm or better the
//      guard lifts — juxtaposing two facts a kid can now retrieve is useful
//      discrimination practice, not a trap.
//   3. Success governor. Over the last `config.governorWindow` items, if the
//      clean rate is below `config.governorFloor`, force a hot fact. This is
//      what stops a bad night becoming twenty consecutive hard problems; ~80%
//      success is the band where learning per repetition is highest.
//
// Pure module: no DOM, no network, no clock, no randomness of its own. `rng` is
// injected and is the ONLY source of nondeterminism, which is what lets
// tools/replay.js re-run a session and get the same sequence back.

import { answerOf, parseFactId, transposeId } from './facts.js';

const COLD = 'cold';
const HOT = 'hot';
const CLEAN_STAGE = 'clean';

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
 * `config.noRepeatWithin` items, plus the transpose of each.
 *
 * `transposeId` takes a Fact object, not an id, so a history id has to be
 * parsed first. That is not a canonicalisation — it names the other orientation
 * so it can be excluded, it does not merge the two records.
 *
 * @param {string[]} history
 * @param {{noRepeatWithin: number}} config
 * @returns {Set<string>}
 */
function recentlyServed(history, config) {
  const blocked = new Set();
  for (const id of tailOf(history, config.noRepeatWithin)) {
    blocked.add(id);
    blocked.add(transposeId(parseFactId(id)));
  }
  return blocked;
}

/**
 * Are these two facts a confusion pair? True when a wrong answer ever recorded
 * for one of them is the correct answer of the other. The relation is checked
 * in both directions because either fact's history can be the evidence.
 *
 * `model.confusions` is total and all-time by design (spec §6) — every fact is
 * a key, mapping to an empty Set where nothing was recorded, and a wrong answer
 * from weeks ago never ages out. It is used exactly as given.
 *
 * @param {{byId: Map<string, object>, confusions: Map<string, Set<number>>}} model
 * @param {string} idA
 * @param {string} idB
 * @returns {boolean}
 */
function isConfusionPair(model, idA, idB) {
  const answerA = answerOf(model.byId.get(idA).fact);
  const answerB = answerOf(model.byId.get(idB).fact);
  return model.confusions.get(idA).has(answerB) || model.confusions.get(idB).has(answerA);
}

/**
 * Ids barred by the interference guard. "Adjacent" means directly after the
 * item just served, so the guard is evaluated against the last history entry
 * only — a confusion pair two items apart is fine.
 *
 * The guard applies while EITHER fact of the pair is cold, and lifts when both
 * have reached warm.
 *
 * @param {{byId: Map<string, object>, confusions: Map<string, Set<number>>}} model
 * @param {string[]} history
 * @returns {Set<string>}
 */
function interferingWithLast(model, history) {
  const blocked = new Set();
  if (history.length === 0) {
    return blocked;
  }
  const previousId = history[history.length - 1];
  const previous = model.byId.get(previousId);
  for (const stats of model.byId.values()) {
    if (stats.id === previousId) {
      continue;
    }
    if (previous.bucket !== COLD && stats.bucket !== COLD) {
      continue;
    }
    if (isConfusionPair(model, previousId, stats.id)) {
      blocked.add(stats.id);
    }
  }
  return blocked;
}

/**
 * Clean rate over the recent history window, or null when there is no evidence
 * to judge on.
 *
 * NON-OBVIOUS, AND THE REASON THIS FUNCTION EXISTS: `history` carries FactIds
 * only — it does NOT carry outcomes. A future reader will assume otherwise, so:
 * the outcome of each item in the window is recovered from the mastery model's
 * retained attempts for that id. `FactStats.attempts` is most-recent-LAST and
 * holds at most `config.retain` entries, so the n-th most recent occurrence of
 * an id in the window maps to the n-th attempt from the end of that fact's
 * retained list. Walking the window backwards and consuming one retained
 * attempt per occurrence keeps a fact served twice in the window from being
 * scored twice against the same attempt.
 *
 * An item whose attempt has already fallen out of the retained window (or was
 * never recorded, e.g. a problem still in flight) is skipped rather than
 * counted as a failure — absent evidence is not bad evidence.
 *
 * @param {{byId: Map<string, object>}} model
 * @param {string[]} history
 * @param {{governorWindow: number}} config
 * @returns {number | null} 0..1, or null when nothing in the window is scorable
 */
function recentCleanRate(model, history, config) {
  const recent = tailOf(history, config.governorWindow);
  /** @type {Map<string, number>} */
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
 * Weighted pick from parallel candidate/weight lists, drawing one number from
 * `rng`. Falls back to a uniform pick if every weight is zero, so a
 * pathological tunables table still yields a problem rather than nothing.
 *
 * @param {object[]} candidates non-empty
 * @param {number[]} weights
 * @param {() => number} rng
 * @returns {{op: string, a: number, b: number}}
 */
function sampleWeighted(candidates, weights, rng) {
  const draw = rng();
  const roll = Number.isFinite(draw) ? Math.min(Math.max(draw, 0), 0.9999999999) : 0;

  let total = 0;
  for (const weight of weights) {
    total += weight > 0 ? weight : 0;
  }

  if (total <= 0) {
    const index = Math.min(candidates.length - 1, Math.floor(roll * candidates.length));
    return { ...candidates[index] };
  }

  let cursor = roll * total;
  for (let index = 0; index < candidates.length; index += 1) {
    cursor -= weights[index] > 0 ? weights[index] : 0;
    if (cursor < 0) {
      return { ...candidates[index] };
    }
  }
  return { ...candidates[candidates.length - 1] };
}

/**
 * Pick the next fact to serve.
 *
 * Constraints are applied as filters over the whole fact space before sampling,
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
 * The final relaxation leaves all 121 facts eligible, so this never returns
 * undefined.
 *
 * A fresh Fact object is returned rather than the model's own, so a caller that
 * mutates what it gets back cannot corrupt the derived model.
 *
 * @param {{byId: Map<string, object>, confusions: Map<string, Set<number>>}} model
 * @param {string[]} history FactIds served this session, most recent LAST
 * @param {{weights: object, noRepeatWithin: number, governorWindow: number, governorFloor: number}} config
 * @param {() => number} rng injected source in [0,1) — the only nondeterminism here
 * @returns {{op: string, a: number, b: number}}
 */
export function pickNext(model, history, config, rng) {
  const repeatBlocked = recentlyServed(history, config);
  const confusionBlocked = interferingWithLast(model, history);
  const cleanRate = recentCleanRate(model, history, config);
  const governorOn = cleanRate !== null && cleanRate < config.governorFloor;

  const passes = [
    { governor: governorOn, confusion: true, noRepeat: true },
    { governor: false, confusion: true, noRepeat: true },
    { governor: false, confusion: false, noRepeat: true },
    { governor: false, confusion: false, noRepeat: false },
  ];

  for (const pass of passes) {
    const candidates = [];
    const weights = [];
    for (const stats of model.byId.values()) {
      if (pass.governor && stats.bucket !== HOT) {
        continue;
      }
      if (pass.noRepeat && repeatBlocked.has(stats.id)) {
        continue;
      }
      if (pass.confusion && confusionBlocked.has(stats.id)) {
        continue;
      }
      candidates.push(stats.fact);
      weights.push(config.weights[stats.bucket]);
    }
    if (candidates.length > 0) {
      return sampleWeighted(candidates, weights, rng);
    }
  }

  // Unreachable: the last pass applies no filters and model.byId is total over
  // the 121 facts, so it can never be empty.
  throw new Error('pickNext: the fact space was empty');
}
