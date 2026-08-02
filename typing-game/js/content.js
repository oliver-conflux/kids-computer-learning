// typing-game/js/content.js
//
// Hand-authored lesson content. THIS FILE IS DATA — edit it freely, then run
// `node --test typing-game/tests/content.test.js` before committing.
//
// Two rules the tests enforce, both easy to break by reflex:
//
//   1. Every character must appear in the lesson's availableKeys. A rung cannot
//      ask for a key it has not taught.
//   2. Capitals arrive at shift-caps and the period at bot-x-period, so every
//      sentence before those is lowercase and unpunctuated. "she had a field",
//      never "She had a field." This looks wrong. It is correct.
//
// Practice-mode content is deliberately exempt from rule 1 and does not live
// here (spec §4).
//
// Pure module: no DOM, no network, no clock, no randomness.

import { lessonById } from './curriculum.js';
import { HOME } from './content/home.js';
import { TOP } from './content/top.js';
import { BOTTOM } from './content/bottom.js';
import { SHIFT } from './content/shift.js';
import { NUMBERS } from './content/numbers.js';

const EMPTY = { drills: [], words: [], sentences: [] };

/**
 * Every lesson's content, merged from the five group files. Downstream code
 * imports only from here and never reaches into content/ directly.
 */
export const CONTENT = { ...HOME, ...TOP, ...BOTTOM, ...SHIFT, ...NUMBERS };

/**
 * @param {string} lessonId
 * @returns {{drills: string[], words: string[], sentences: string[]}}
 */
export function contentFor(lessonId) {
  const buckets = CONTENT[lessonId];
  if (buckets === undefined) return { ...EMPTY };
  return {
    drills: buckets.drills ?? [],
    words: buckets.words ?? [],
    sentences: buckets.sentences ?? [],
  };
}

/** Draw `count` distinct items from `pool` using an injected rng. */
function sample(pool, count, rng) {
  const remaining = [...pool];
  const picked = [];
  for (let i = 0; i < count && remaining.length > 0; i += 1) {
    const index = Math.floor(rng() * remaining.length) % remaining.length;
    picked.push(remaining[index]);
    remaining.splice(index, 1);
  }
  return picked;
}

/**
 * Build one 10-item round. Items ramp: drills, then words, then a sentence
 * (spec §3). Sampling from a larger pool is what makes repeat attempts differ.
 *
 * @param {string} lessonId
 * @param {() => number} rng returns 0..1 — injected so rounds are reproducible
 * @returns {string[]}
 */
export function itemsFor(lessonId, rng) {
  const lesson = lessonById(lessonId);
  if (lesson === null) return [];
  const buckets = contentFor(lessonId);
  return [
    ...sample(buckets.drills, lesson.mix.drills, rng),
    ...sample(buckets.words, lesson.mix.words, rng),
    ...sample(buckets.sentences, lesson.mix.sentences, rng),
  ];
}
