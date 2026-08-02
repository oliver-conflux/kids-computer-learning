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
 *   taughtCount: number,
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
 * The `taught` split inside `cold` is the FIRST of two things that stop learn
 * mode repeating itself, and on its own it is not enough. It is the same trap
 * math's learn.js documents: learn attempts are excluded from mastery evidence,
 * so a family taught yesterday is still entirely cold today, and a purely
 * temperature-based ordering hands back the identical family every session.
 * Cold-and-taught ranks above warm rather than last — a word shown once and
 * never drilled SHOULD come back round, it just must not come back before every
 * untaught word has had a turn.
 *
 * WHERE THIS LADDER RUNS OUT: a boolean can demote a family exactly once. Once
 * every cold family in the window has had its lesson they are all rank 1 and
 * nothing here can separate them again, so the pick becomes fixed and the same
 * family returns forever. `pickLearnFamily` adds the lesson COUNT to this rank
 * for that reason; see the scoring comment there. Do not "simplify" the score
 * back to rank alone — the stall it causes is invisible from inside a session.
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
 * The members a session built on this family would ACTUALLY teach: the neediest
 * `learnWords` of them, coldest first and ties by window position.
 *
 * Scoring and selection both go through this, and they must. A family can be
 * larger than `learnWords` — `irregular` reached eight members in real play
 * against a limit of four — and scoring the whole family while teaching only
 * part of it makes the untaught leftovers hold the mean down. Measured: one
 * lesson moved `irregular`'s mean lessons by 0.25 instead of 1, so it stayed
 * cheapest and came up twice in a row while every small family moved a full
 * step per lesson.
 *
 * @param {{id: string, word: string, rank: number, lessons: number, position: number}[]} members
 * @param {number} learnWords
 * @returns {{id: string, word: string, rank: number, lessons: number, position: number}[]}
 */
function sessionMembers(members, learnWords) {
  return [...members]
    .sort((left, right) => left.rank - right.rank || left.position - right.position)
    .slice(0, Math.max(1, learnWords));
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
      // How many lessons this word has already had. `?? 0` so a model from
      // before the field existed reads as never taught rather than NaN, which
      // would poison the mean and silently disable the rotation below.
      lessons: stats.taughtCount ?? 0,
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
 * A family is scored by MEAN ATTENTION ALREADY SPENT on its members: mean rank
 * plus mean lesson count. Lowest wins.
 *
 * Means, not counts. By mean, a two-word family where both words are cold beats
 * a six-word family with two cold and four hot, which is right — the second is
 * one the kid has largely got, and re-teaching it spends a session on four words
 * that did not need it.
 *
 * The lesson term is what makes the mode advance rather than settle; the scoring
 * comment inside the loop explains why a tie-break was not enough. Ties go to the
 * family appearing earliest in the window.
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
  /** @type {{id: string, word: string, rank: number, lessons: number, position: number}[]} */
  let bestMembers = [];
  let bestScore = Infinity;
  let bestLessons = Infinity;

  for (const [pattern, members] of families) {
    if (members.length < MIN_FAMILY_SIZE) {
      continue;
    }
    // Scored on the words a session would actually teach, not on every member —
    // see sessionMembers. A family bigger than learnWords would otherwise be
    // scored partly on words the lesson never reaches.
    const teachable = sessionMembers(members, config.learnWords);
    const rank = teachable.reduce((total, member) => total + member.rank, 0) / teachable.length;
    const lessons = teachable.reduce((total, member) => total + member.lessons, 0) / teachable.length;

    // ATTENTION ALREADY SPENT = TEMPERATURE + LESSONS. This sum is why learn
    // mode advances at all, and the lessons term is the half that was missing.
    //
    // Rank alone stalls, silently. `taught` is a boolean, so it demotes a family
    // from "cold and untaught" to "cold and taught" exactly ONCE. After every
    // cold family in the window has had its one lesson, nothing can separate
    // them again: learn attempts are excluded from mastery evidence on purpose,
    // so no amount of teaching changes a bucket, and the pick falls to a fixed
    // Map insertion order. The same family then comes back every session
    // forever. Reproduced: pressing 'learn' ten times taught -at, -an, -ap, -ad,
    // -at, -an, then -at for every session after the sixth. Real play hit the
    // same wall on -in — `in pin win tin`, four sessions running.
    //
    // A TIE-BREAK IS NOT ENOUGH, which is the trap on the way to this fix.
    // Making lessons a secondary key only fires when two families score exactly
    // equal, and on real data they almost never do — measured `th` at 1.50
    // against `irregular` at 1.60, so the tie-break was never consulted and `th`
    // won three sessions out of four regardless of having had twice the lessons.
    // The count has to be IN the score.
    //
    // One lesson weighs one rank step, and that is the whole calibration: both
    // measure "this family has already had a turn". Rank still leads in
    // practice, because a family two steps colder needs two lessons before it
    // yields — but a family taught over and over does eventually give way, which
    // is exactly the property that was missing. Insertion order remains the last
    // resort and still breaks toward the easier end of the spine.
    // AND THEN lessons AGAIN, as a genuine tie-break behind the sum.
    //
    // This is not the discarded first attempt. That one used lessons as a
    // secondary key behind RANK, where it never fired because raw ranks
    // effectively never tie. Behind the SUM it fires on the one shape that
    // reaches an exact tie, and that shape is reachable on purpose: hot words
    // are excluded from the window, so every score sits between 0 and 2, and a
    // cold untaught family that has had one lesson (rank 1 + 1 lesson) lands
    // exactly on an untouched warm one (rank 2 + 0). Without this the tie went
    // to insertion order, which favours the earlier family — the one just
    // taught — and the same lesson came up twice in a row.
    //
    // Verified: cold `-at` first in the window against warm `-ig` gave -at, -at,
    // -ig. With this it gives -at, -ig. Two clicks of "learn a word" now never
    // teach the same family twice while another family qualifies.
    const score = rank + lessons;
    if (score < bestScore || (score === bestScore && lessons < bestLessons)) {
      bestScore = score;
      bestLessons = lessons;
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
  const words = sessionMembers(bestMembers, config.learnWords)
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
