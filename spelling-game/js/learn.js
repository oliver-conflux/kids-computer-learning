// Learn-mode session construction — which family to teach, and in what order.
//
// Learn mode is the acquisition half of the game: one pattern, a handful of
// words that share it, cycled until the route is worn in. This module answers
// the only two questions that shape such a session — WHICH words, and IN WHAT
// ORDER — and nothing else. It renders nothing, logs nothing, and scores
// nothing. Its counterpart in the math game is math-game/js/learn.js, and the
// two are deliberately the same shape.
//
// The load-bearing difference from math: math teaches FACTS and this teaches a
// FAMILY. A kid who learns `-ight` gets eight words, not one, which is the whole
// reason patterns.js exists. That is why a family of exactly one word is skipped
// in favour of the next-coldest — a family of one teaches no pattern, and a
// single word cycled twelve times is a spelling detention.
//
// ON "BLOCKED", which the plan and the spec both use and which means something
// specific here. The session is blocked AT THE SESSION LEVEL: one family, and
// nothing from outside it, as against drill's interleaving across the whole
// active window. WITHIN the session the words cycle — `A B C A B C`, not
// `A A A A B B B B`. This is exactly what math-game/js/learn.js does and says,
// and the reason is the same in both games: repeating a word back to back lets
// the kid echo the answer they gave a moment ago instead of retrieving it, which
// defeats the repetition the session exists for. Blocked-by-session, cycled
// within, is right for building a route; interleaving is right for retaining
// one. If a later edit reads "blocked" as `A A A A` and changes this, it will
// have removed the retrieval from the acquisition mode.
//
// There is deliberately NO success governor here and no padding with mastered
// words, for the reason math's file gives: the governor is a fix for FAILURE and
// learn mode has no failure state. The word is behind a press-and-hold button
// and the family stays on screen, so success is available at every moment. The
// real risk is fatigue, and that is answered by the session being short and
// narrow.
//
// Pure module: no DOM, no network, no clock, no randomness. Everything tunable
// arrives in `config`, so the same log replays under a different table.

import { patternsFor, IRREGULAR } from './patterns.js';

/**
 * @typedef {{word: string, rank: number, dolch: boolean}} Word
 * @typedef {{
 *   id: string,
 *   item: Word,
 *   bucket: 'cold' | 'warm' | 'hot',
 *   attempts: object[],
 *   cleanCount: number,
 *   medianCleanMs: number | null,
 *   taught: boolean,
 * }} WordStats
 * @typedef {{byId: Map<string, WordStats>, confusions: Map<string, Set<unknown>>}} MasteryModel
 *
 * @typedef {{id: string, word: string}} FamilyMember
 * @typedef {{pattern: string | null, words: FamilyMember[]}} LearnFamily
 */

/**
 * The smallest family worth teaching. Two words is the point at which a pattern
 * is visible at all — one word is an example of nothing.
 *
 * Not in CONFIG on purpose, unlike every other quantity in this game. It is not
 * a tunable: a family of one does not teach a pattern less well, it teaches no
 * pattern, and a config key implying otherwise would invite someone to set it
 * to 1 and quietly turn learn mode into single-word drill without a clock.
 */
const MIN_FAMILY_SIZE = 2;

/**
 * Selection ranks, coldest and least-taught first. A word's rank is the index of
 * the first predicate it satisfies.
 *
 * The `taught` split inside `cold` is what stops learn mode repeating itself
 * forever, and it is the same trap math's learn.js documents: learn attempts are
 * excluded from mastery evidence, so a family taught yesterday is still entirely
 * cold today, and a purely temperature-based ordering hands back the identical
 * family every single session. Cold-and-taught ranks above warm rather than last
 * — a word shown once and never drilled SHOULD come back round, it just must not
 * come back before every untaught word has had a turn.
 *
 * `taught` is compared against `true` rather than read for truthiness, so a
 * model predating the field ranks its words as untaught instead of throwing.
 *
 * The four predicates are mutually exclusive and must stay so.
 */
const RANKS = [
  (stats) => stats.bucket === 'cold' && stats.taught !== true,
  (stats) => stats.bucket === 'cold' && stats.taught === true,
  (stats) => stats.bucket === 'warm',
  (stats) => stats.bucket === 'hot',
];

/**
 * How badly this word needs teaching — 0 is most, `RANKS.length` is least.
 *
 * A stats entry with an unrecognised bucket falls off the end of the table and
 * scores as the LEAST needy thing in the window rather than the most. A corrupt
 * line must never break a session, and it must certainly never be the reason a
 * whole family gets picked.
 *
 * @param {WordStats} stats
 * @returns {number}
 */
function rankOf(stats) {
  for (let rank = 0; rank < RANKS.length; rank += 1) {
    if (RANKS[rank](stats)) {
      return rank;
    }
  }
  return RANKS.length;
}

/**
 * Group the active window into families, one entry per pattern tag.
 *
 * Iteration follows `window` order, which is spine order, so the returned Map's
 * insertion order is "family whose first member appears earliest". That is what
 * makes the tie-break in `pickLearnFamily` deterministic without a secondary
 * sort key, and it breaks ties toward the easier end of the spine — which is
 * where a kid who is stuck should be sent.
 *
 * A word carries several tags and therefore joins several families. That is
 * expected: `snake` belongs to `-ake`, to `silent-e` and to `blend-start`, and
 * which of the three gets taught is this module's decision, not patterns.js's.
 *
 * Ids not present in `model.byId` are skipped silently — a stale window from an
 * older spine must not break a session.
 *
 * @param {MasteryModel} model
 * @param {string[]} window ids, spine order
 * @returns {Map<string, {id: string, word: string, rank: number, position: number}[]>}
 */
function familiesIn(model, window) {
  /** @type {Map<string, {id: string, word: string, rank: number, position: number}[]>} */
  const families = new Map();

  window.forEach((id, position) => {
    const stats = model.byId.get(id);
    if (stats === undefined || stats.item === undefined) {
      return;
    }

    const member = {
      id,
      word: stats.item.word,
      rank: rankOf(stats),
      position,
    };

    for (const pattern of patternsFor(stats.item.word)) {
      let family = families.get(pattern);
      if (family === undefined) {
        family = [];
        families.set(pattern, family);
      }
      family.push(member);
    }
  });

  return families;
}

/**
 * Choose the family for one learn session: the coldest pattern with at least
 * two words in the active window.
 *
 * Family coldness is the MEAN rank of its members in the window, not the count
 * of cold words in it. The distinction matters: by mean, a two-word family where
 * both words are cold beats a six-word family with two cold and four hot, which
 * is right — the second family is one the kid has largely got, and re-teaching
 * it spends a session on four words that did not need it. Ties go to the family
 * appearing earliest in the window.
 *
 * `irregular` competes on exactly the same terms as every other tag and is
 * neither preferred nor penalised. It is a SET, not a family — the words in it
 * share no route, only the absence of one — and the screen has to say so. That
 * is a UI concern (spec §6: "this one you just have to remember"), and the
 * honest thing this module can do is hand the tag over unmodified rather than
 * disguise it as a rhyme.
 *
 * Returns `{ pattern: null, words: [] }` when no family qualifies — an empty
 * window, or a window whose every tag has exactly one word in it. The caller
 * hides the learn continuation in that case, exactly as the math results screen
 * hides "Learn 3 facts" when no eligible fact remains. It does NOT fall back to
 * a family of one; that is the case this function exists to refuse.
 *
 * Neither `model`, `window` nor `config` is mutated, and the returned members
 * are fresh objects.
 *
 * @param {MasteryModel} model
 * @param {string[]} window ids, spine order
 * @param {{learnWords: number}} config
 * @returns {LearnFamily}
 */
export function pickLearnFamily(model, window, config) {
  const families = familiesIn(model, window);

  /** @type {string | null} */
  let bestPattern = null;
  /** @type {{id: string, word: string, rank: number, position: number}[]} */
  let bestMembers = [];
  let bestScore = Infinity;

  for (const [pattern, members] of families) {
    if (members.length < MIN_FAMILY_SIZE) {
      continue;
    }
    const score = members.reduce((total, member) => total + member.rank, 0) / members.length;
    // Strictly less than, so the first family to reach a score keeps it and Map
    // insertion order settles every tie.
    if (score < bestScore) {
      bestScore = score;
      bestPattern = pattern;
      bestMembers = members;
    }
  }

  if (bestPattern === null) {
    return { pattern: null, words: [] };
  }

  // Two orderings, in this priority, and they do different jobs. SELECTION is
  // by rank, so a family bigger than `learnWords` gives up its already-hot
  // members first. PRESENTATION is back in window order, so the words appear on
  // screen in spine order and the family header reads the way a kid would write
  // it out — `cat bat hat`, not whichever three happened to be coldest.
  const words = [...bestMembers]
    .sort((left, right) => left.rank - right.rank || left.position - right.position)
    .slice(0, Math.max(1, config.learnWords))
    .sort((left, right) => left.position - right.position)
    .map((member) => ({ id: member.id, word: member.word }));

  return { pattern: bestPattern, words };
}

/**
 * Is this family the irregular set rather than a pattern?
 *
 * Exported so the screen asks this module rather than comparing against the
 * string literal in its own file. Two copies of a predicate is the divergence
 * shape that has already bitten this project twice, and it fails silently both
 * times.
 *
 * @param {LearnFamily} family
 * @returns {boolean}
 */
export function isIrregularSet(family) {
  return family.pattern === IRREGULAR;
}

/**
 * Expand a chosen family into the session's item list: the words cycled
 * `[A, B, C, A, B, C, ...]` until the session is full.
 *
 * THE ITEM COUNT IS HELD CONSTANT ACROSS FAMILY SIZES. The target is
 * `learnWords × learnPasses` — twelve, at the shipped config — and a short
 * family raises its pass count to reach it: four words × 3 passes, three words ×
 * 4 passes and two words × 6 passes are all twelve items. Without this a kid
 * gets a six-item session purely because the family happened to be small, which
 * is a shorter session for the pattern with the least support in the window —
 * exactly backwards. `learnPasses` is therefore the FLOOR on passes, not the
 * count.
 *
 * The cycle is never truncated mid-pass, so the item count can exceed the target
 * when the family size does not divide it. Cutting it short would give the first
 * word of the cycle one more rep than the last, and an unequal number of reps is
 * the one thing a blocked-on-one-family session must not have.
 *
 * Returns ids, not words: the session loop looks each one up in the mastery
 * model, and an id is the only thing every other module in this game agrees on.
 *
 * @param {FamilyMember[]} words the family's distinct words, in presentation order
 * @param {{learnWords: number, learnPasses: number}} config
 * @returns {string[]} ids, `words.length * passes` of them
 */
export function buildLearnSession(words, config) {
  if (words.length === 0) {
    return [];
  }

  // Throw rather than degrade. A missing or non-numeric tunable makes `target`
  // NaN, `passes` NaN, and the loop below run zero times — handing back an empty
  // session that starts, ends immediately, logs nothing, and looks to the kid
  // like the game is broken with no error anywhere to say why. `typing-cost.js`
  // throws on exactly this class of mistake; two modules in one wave should not
  // disagree about it, and the silent one is the wrong choice.
  if (!Number.isFinite(config.learnWords) || !Number.isFinite(config.learnPasses)) {
    throw new Error(
      'buildLearnSession: config.learnWords and config.learnPasses must be numbers, ' +
        `got ${config.learnWords} and ${config.learnPasses}`,
    );
  }

  const target = config.learnWords * config.learnPasses;
  const passes = Math.max(config.learnPasses, Math.ceil(target / words.length));

  /** @type {string[]} */
  const session = [];
  for (let pass = 0; pass < passes; pass += 1) {
    for (const member of words) {
      session.push(member.id);
    }
  }
  return session;
}
