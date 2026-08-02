// The word spine — the difficulty order the whole game walks.
//
// A Word is { word, rank, dolch }. The INDEX into SPINE is the frontier
// position: `activeWindow` walks this array in order, and the session event
// records how far it reached. Nothing else reads `rank` for ordering, so a
// retune changes this array and no consumer notices.
//
//   word   lowercase a-z only, no spaces, no punctuation, unique
//   rank   Fry frequency rank; 0 for the hand-authored opener that precedes Fry
//   dolch  Dolch sight-word membership
//
// Committed source data, checked in because it is a curriculum decision and a
// curriculum decision belongs in review. The OPENER below is hand-authored; the
// Fry half is GENERATED into js/fry.js from spelling-game/data/*.txt by
// tools/build-fry.js and committed alongside it, so the browser still imports a
// plain module and there is no build step to forget.
//
// TWO SECTIONS, AND THEY ARE ORDERED ON DIFFERENT PRINCIPLES.
//
// The opener is ordered by PHONICS: rime families, grouped, easiest vowel first.
// It is hand-authored because no frequency list produces a good first lesson —
// frequency gives you `the`, `of`, `and`, which are three different irregular
// spellings in a row and teach no pattern at all. A kid's first ten words should
// rhyme, so that spelling the second one is a deduction from the first. This is
// also why the opener is NOT sourced from the typing game's word lists: those
// are banded by which keys the kid has been taught, which is a different axis
// entirely (spec §2).
//
// Fry is ordered by FREQUENCY, which is the right principle once the kid can
// decode at all: the payoff per word learned is highest for the words they meet
// most often, whatever their spelling looks like.
//
// Pure module: no DOM, no network, no clock, no randomness.

import { FRY } from './fry.js';

/**
 * The hand-authored CVC opener, grouped in rime families from the very first
 * word. Short-a first, then short-i, o, u, e — the conventional order, and the
 * one that keeps the vowel constant while the kid learns that the ONSET is the
 * part that changes.
 *
 * `rank: 0` for all of these: they precede Fry rather than sitting inside it.
 * Some are also Fry words and some are Dolch sight words; `dolch` is flagged
 * where true, because a sight word that also fits a family is worth knowing
 * about even though it is taught here as a family member.
 */
const OPENER = [
  // -at
  { word: 'at', dolch: true },
  { word: 'cat', dolch: false },
  { word: 'hat', dolch: false },
  { word: 'bat', dolch: false },
  { word: 'sat', dolch: true },
  { word: 'mat', dolch: false },
  // -an
  { word: 'an', dolch: true },
  { word: 'can', dolch: true },
  { word: 'man', dolch: false },
  { word: 'ran', dolch: true },
  { word: 'pan', dolch: false },
  // -ap
  { word: 'cap', dolch: false },
  { word: 'map', dolch: false },
  { word: 'nap', dolch: false },
  { word: 'tap', dolch: false },
  // -ad
  { word: 'bad', dolch: false },
  { word: 'dad', dolch: false },
  { word: 'had', dolch: true },
  { word: 'sad', dolch: false },
  // -ig
  { word: 'big', dolch: true },
  { word: 'dig', dolch: false },
  { word: 'pig', dolch: false },
  { word: 'wig', dolch: false },
  // -it
  { word: 'it', dolch: true },
  { word: 'bit', dolch: false },
  { word: 'fit', dolch: false },
  { word: 'hit', dolch: false },
  { word: 'sit', dolch: true },
  // -in
  { word: 'in', dolch: true },
  { word: 'pin', dolch: false },
  { word: 'win', dolch: false },
  { word: 'tin', dolch: false },
  // -op
  { word: 'hop', dolch: false },
  { word: 'mop', dolch: false },
  { word: 'top', dolch: false },
  { word: 'stop', dolch: true },
  // -ot
  { word: 'got', dolch: true },
  { word: 'hot', dolch: true },
  { word: 'not', dolch: true },
  { word: 'pot', dolch: false },
  // -un
  { word: 'fun', dolch: true },
  { word: 'run', dolch: true },
  { word: 'sun', dolch: false },
  // -ug
  { word: 'bug', dolch: false },
  { word: 'hug', dolch: false },
  { word: 'rug', dolch: false },
  // -ed
  { word: 'bed', dolch: false },
  { word: 'fed', dolch: false },
  { word: 'red', dolch: true },
  // -en
  { word: 'hen', dolch: false },
  { word: 'pen', dolch: false },
  { word: 'ten', dolch: true },
  // -et
  { word: 'get', dolch: true },
  { word: 'let', dolch: true },
  { word: 'wet', dolch: false },
  { word: 'yet', dolch: true },
];

// The Fry list now lives in a generated module built from the committed word
// lists — see tools/build-fry.js. It used to be an inline array of 296 entries
// written from memory, and the comment above it said so; measured against a
// sourced list, its exact ranks agreed 6% of the time. Generating it means the
// ordering has one origin and nobody hand-shifts 700 ranks to insert a word.
//
// Entries are [word, publishedRank, isDolch]. The rank is Fry's own, kept even
// though 28 untypable words were dropped, so that `band` — ceil(rank / 100) —
// stays comparable to anyone else's copy of the list.

/**
 * The spine: the opener, then Fry, with duplicates dropped.
 *
 * THE TWO SECTIONS OVERLAP AND THAT IS EXPECTED. `at`, `can`, `not`, `get`,
 * `stop`, `run`, `big`, `let`, `got` and others are both CVC family members and
 * high-frequency Fry words. Each appears ONCE, at its OPENER position, because
 * the opener position is the earlier and easier one — a word the kid met while
 * learning the -at family should not come round again three hundred places later
 * as though it were new.
 *
 * De-duplication is by word, first occurrence wins. It also covers the case
 * where a published Fry ordering repeats itself, which they do — two entries for
 * one word would put a second `w:its` into a space whose ids must be unique, and
 * `validateSpace` would reject it outright.
 *
 * The single-letter entry `a` is kept: a real word, typable, and a one-slot
 * problem is a legitimate one. `I` is NOT, because the engine accepts a-z and
 * cannot type a capital — it is one of the 28 words fry.js drops. An earlier
 * version of this comment claimed both were kept and `i` had never been in the
 * array at all.
 *
 * @type {{word: string, rank: number, dolch: boolean}[]}
 */
export const SPINE = buildSpine();

function buildSpine() {
  const spine = [];
  const seen = new Set();

  for (const entry of OPENER) {
    if (seen.has(entry.word)) {
      continue;
    }
    seen.add(entry.word);
    spine.push({ word: entry.word, rank: 0, dolch: entry.dolch });
  }

  // `rank` is Fry's PUBLISHED rank, not the array index. 28 untypable words were
  // dropped when fry.js was generated, and using position here would pull every
  // word after each gap into the wrong hundred — which is the one number
  // downstream code is allowed to trust.
  FRY.forEach(([word, rank, dolch]) => {
    if (seen.has(word)) {
      return;
    }
    seen.add(word);
    spine.push({ word, rank, dolch });
  });

  return spine;
}

/**
 * The spine index of a word, or -1. Linear because the spine is a few hundred
 * entries and this is not called per keystroke; a Map would be a cache to keep
 * in sync for no measurable gain.
 *
 * @param {string} word
 * @returns {number}
 */
export function spinePositionOf(word) {
  return SPINE.findIndex((entry) => entry.word === word);
}

/**
 * The spine trimmed to words we can actually say out loud.
 *
 * A word with no audio is not merely worse in drill mode, it is UNANSWERABLE:
 * the screen is a row of empty boxes and the only statement of the question is
 * the sound. Merriam-Webster has no recording for irregular inflections — it
 * puts the pronunciation on the base headword, so `said`, `went`, `feet` and 25
 * others come back with an entry and no audio (see docs/audio-sourcing.md).
 * Serving them is asking a child to spell a word nobody told her.
 *
 * TWO CASES DELIBERATELY RETURN THE SPINE WHOLE rather than an empty list:
 *
 *   - `audioWords` is null — the caller could not find out. A failed lookup must
 *     not silently empty the game.
 *   - nothing overlaps — an empty cache is the normal state of a fresh clone,
 *     which is meant to be fully playable through speechSynthesis (spec §5).
 *     Trimming to nothing would turn "no mp3s yet" into "no game".
 *
 * The failure mode being avoided in both is the same: a trim that removes
 * everything looks exactly like a game with no words, and nothing on screen
 * would say why.
 *
 * Order is preserved, so spine position — which is difficulty — still means what
 * it meant. This does NOT renumber `rank`: rank records where a word sits in
 * Fry's frequency list, which is a fact about English, not about our cache.
 *
 * @param {{word: string, rank: number, dolch: boolean}[]} spine
 * @param {string[] | Set<string> | null} audioWords words with a pronunciation
 * @returns {{word: string, rank: number, dolch: boolean}[]}
 */
export function playableSpine(spine, audioWords) {
  if (audioWords === null || audioWords === undefined) {
    return spine;
  }
  const have = audioWords instanceof Set ? audioWords : new Set(audioWords);
  if (have.size === 0) {
    return spine;
  }
  const trimmed = spine.filter((entry) => have.has(entry.word));
  return trimmed.length === 0 ? spine : trimmed;
}
