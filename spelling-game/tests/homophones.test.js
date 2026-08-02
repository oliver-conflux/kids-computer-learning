// Homophones — the words the game cannot ask for by sound alone.
//
// This module exists because of a hole in the QUESTION, not in the kid: drill
// plays a sound and shows empty boxes, and for `sea` that does not choose
// between the spellings, so a correct answer can be marked wrong. The fix is to
// flash the word while it is spoken, for these words only.
//
// What matters most here is the NARROWING: the other spelling must be typable.
// The engine accepts a-z, so `it's` and `you're` can never be entered, which
// means `its` and `your` are not ambiguous inside this game and must not be
// flashed. Flashing a word that was never at risk spends recall practice on
// nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HOMOPHONE_SETS, hasHomophone, homophonesOf } from '../js/homophones.js';
import { SPINE } from '../js/spine.js';

test('every set has at least two members', () => {
  // A set of one names no collision and would flash a word for no reason.
  for (const set of HOMOPHONE_SETS) {
    assert.ok(set.length >= 2, `${set.join('/')} has ${set.length} member(s)`);
  }
});

test('every member is typable: lowercase a-z, no apostrophes', () => {
  // The whole narrowing. `they're` cannot be typed, so listing it would flash
  // `their` against a rival the kid could never have entered.
  for (const set of HOMOPHONE_SETS) {
    for (const word of set) {
      assert.match(word, /^[a-z]+$/, `${word} is not typable and must not be listed`);
    }
  }
});

test('no word appears in two different sets', () => {
  // Two sets naming the same word would make homophonesOf depend on order.
  const seen = new Map();
  for (const set of HOMOPHONE_SETS) {
    for (const word of set) {
      assert.equal(seen.has(word), false, `${word} is in both ${seen.get(word)} and ${set.join('/')}`);
      seen.set(word, set.join('/'));
    }
  }
});

test('no set contains a duplicate', () => {
  for (const set of HOMOPHONE_SETS) {
    assert.equal(new Set(set).size, set.length, `${set.join('/')} repeats a word`);
  }
});

test('hasHomophone is true for every listed word and false otherwise', () => {
  for (const set of HOMOPHONE_SETS) {
    for (const word of set) {
      assert.equal(hasHomophone(word), true, word);
    }
  }
  for (const word of ['cat', 'dog', 'spelling', 'because', 'water']) {
    assert.equal(hasHomophone(word), false, word);
  }
});

test('hasHomophone survives junk instead of a word', () => {
  // It gates a render, so a bad value must read as "not ambiguous" rather than
  // throwing in the middle of starting a problem.
  for (const value of [null, undefined, 42, {}, [], '']) {
    assert.equal(hasHomophone(value), false, JSON.stringify(value));
  }
});

test('homophonesOf returns the others and never the word itself', () => {
  assert.deepEqual(homophonesOf('two').sort(), ['to', 'too']);
  assert.deepEqual(homophonesOf('sea'), ['see']);
  assert.deepEqual(homophonesOf('cat'), []);
  assert.deepEqual(homophonesOf(null), []);
  for (const set of HOMOPHONE_SETS) {
    for (const word of set) {
      assert.equal(homophonesOf(word).includes(word), false, `${word} lists itself`);
    }
  }
});

test('contraction pairs are deliberately absent', () => {
  // `its`/`it's` and `your`/`you're` are homophones in English and NOT in this
  // game, because the rival cannot be typed. If someone adds them, this fails
  // and the comment in homophones.js explains why it should.
  assert.equal(hasHomophone('its'), false, "its/it's is not a collision here");
  assert.equal(hasHomophone('your'), false, "your/you're is not a collision here");
});

test('every colliding pair already in the spine is covered', () => {
  // The eight sets found in the shipped list on 2026-08-02. If a later edit
  // trims one out of HOMOPHONE_SETS while both words are still in the spine,
  // the game silently goes back to asking an unanswerable question.
  const inSpine = new Set(SPINE.map((entry) => entry.word));
  const known = [
    ['to', 'too', 'two'], ['see', 'sea'], ['hear', 'here'], ['their', 'there'],
    ['know', 'no'], ['right', 'write'], ['for', 'four'], ['read', 'red'],
  ];
  for (const set of known) {
    const present = set.filter((word) => inSpine.has(word));
    if (present.length < 2) {
      continue; // the collision is no longer live; nothing to cover
    }
    for (const word of present) {
      assert.equal(hasHomophone(word), true, `${word} is a live collision and would not be flashed`);
    }
  }
});
