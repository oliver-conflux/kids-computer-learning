// The word spine.
//
// These tests pin the properties every other module assumes: unique ids, a
// stable order, and words made only of characters the engine will accept.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SPINE, spinePositionOf, playableSpine } from '../js/spine.js';

test('every word is lowercase a-z with no spaces or punctuation', () => {
  for (const entry of SPINE) {
    assert.match(entry.word, /^[a-z]+$/, `bad word: ${JSON.stringify(entry.word)}`);
  }
});

test('no duplicates — two entries would be two items with one id', () => {
  const seen = new Set();
  for (const entry of SPINE) {
    assert.ok(!seen.has(entry.word), `duplicate: ${entry.word}`);
    seen.add(entry.word);
  }
});

test('every entry has the full Word shape', () => {
  for (const entry of SPINE) {
    assert.deepEqual(
      Object.keys(entry).sort(),
      ['dolch', 'rank', 'word'],
      `unexpected shape on ${entry.word}`,
    );
    assert.equal(typeof entry.dolch, 'boolean');
    assert.ok(Number.isInteger(entry.rank) && entry.rank >= 0);
  }
});

test('the order is stable across reads', async () => {
  const again = (await import('../js/spine.js')).SPINE;
  assert.deepEqual(
    again.map((entry) => entry.word),
    SPINE.map((entry) => entry.word),
  );
});

test('the opener comes first and is rank 0', () => {
  const firstFry = SPINE.findIndex((entry) => entry.rank !== 0);
  assert.ok(firstFry > 0, 'there should be an opener');
  for (let index = 0; index < firstFry; index += 1) {
    assert.equal(SPINE[index].rank, 0);
  }
  // And nothing rank-0 appears after Fry begins — the two sections do not
  // interleave, because they are ordered on different principles.
  for (let index = firstFry; index < SPINE.length; index += 1) {
    assert.notEqual(SPINE[index].rank, 0, `rank 0 after Fry began: ${SPINE[index].word}`);
  }
});

test('the opener really is grouped in families, not scattered', () => {
  // The point of the opener is that the second word is a deduction from the
  // first. That only holds if same-rime words are ADJACENT. Check the -at
  // family specifically: every -at word in the opener must sit in one
  // uninterrupted run.
  const opener = SPINE.filter((entry) => entry.rank === 0).map((entry) => entry.word);
  const atPositions = opener
    .map((word, index) => (word.endsWith('at') ? index : -1))
    .filter((index) => index !== -1);

  assert.ok(atPositions.length >= 4, 'expected a real -at family');
  const span = atPositions[atPositions.length - 1] - atPositions[0] + 1;
  assert.equal(span, atPositions.length, `-at family is scattered: ${atPositions}`);
});

test('the opener starts on short a — the conventional first vowel', () => {
  assert.match(SPINE[0].word, /a/);
});

test('Fry ranks ascend', () => {
  const fry = SPINE.filter((entry) => entry.rank !== 0);
  for (let index = 1; index < fry.length; index += 1) {
    assert.ok(
      fry[index].rank > fry[index - 1].rank,
      `rank went backwards at ${fry[index].word}`,
    );
  }
});

test('spinePositionOf finds words and returns -1 for strangers', () => {
  assert.equal(spinePositionOf(SPINE[0].word), 0);
  assert.equal(spinePositionOf(SPINE[10].word), 10);
  assert.equal(spinePositionOf('zzzznotaword'), -1);
});

test('a word appearing in both sections is kept once, at its opener position', () => {
  // `at` is both the first -at family member and Fry rank 21. It must appear
  // once, early — not again three hundred places later as though it were new.
  const positions = SPINE.map((entry, index) => (entry.word === 'at' ? index : -1)).filter(
    (index) => index !== -1,
  );
  assert.equal(positions.length, 1);
  assert.equal(SPINE[positions[0]].rank, 0);
});

// --- playableSpine ---------------------------------------------------------
// The trim that keeps the game from asking for words it cannot pronounce. Its
// two fall-open cases matter more than the happy path: both exist to stop a
// lookup problem from presenting as an empty game.

test('playableSpine keeps only words that have audio, in spine order', () => {
  const spine = [
    { word: 'at', rank: 0, dolch: true },
    { word: 'said', rank: 89, dolch: true },
    { word: 'bat', rank: 0, dolch: false },
  ];
  const trimmed = playableSpine(spine, ['bat', 'at']);
  assert.deepEqual(trimmed.map((e) => e.word), ['at', 'bat'], 'order follows the spine, not the input');
  assert.equal(trimmed[0].rank, 0, 'entries are passed through whole');
});

test('playableSpine accepts a Set as well as an array', () => {
  const spine = [{ word: 'at', rank: 0, dolch: true }, { word: 'said', rank: 89, dolch: true }];
  assert.deepEqual(playableSpine(spine, new Set(['at'])).map((e) => e.word), ['at']);
});

test('playableSpine does NOT renumber rank', () => {
  // rank is a fact about Fry's frequency list, not about our audio cache.
  const spine = [
    { word: 'the', rank: 1, dolch: true },
    { word: 'said', rank: 89, dolch: true },
    { word: 'water', rank: 120, dolch: false },
  ];
  assert.deepEqual(playableSpine(spine, ['the', 'water']).map((e) => e.rank), [1, 120]);
});

test('playableSpine returns the whole spine when the lookup failed (null)', () => {
  // A server that could not answer must not empty the game.
  assert.equal(playableSpine(SPINE, null).length, SPINE.length);
  assert.equal(playableSpine(SPINE, undefined).length, SPINE.length);
});

test('playableSpine returns the whole spine for an empty cache', () => {
  // The state of every fresh clone. The game is meant to be fully playable with
  // no mp3s at all, speaking each word instead (spec §5).
  assert.equal(playableSpine(SPINE, []).length, SPINE.length);
  assert.equal(playableSpine(SPINE, new Set()).length, SPINE.length);
});

test('playableSpine returns the whole spine when nothing overlaps', () => {
  // A cache full of words from some other list is a configuration mistake, not
  // a reason to show a child an empty game with no explanation.
  assert.equal(playableSpine(SPINE, ['zzz', 'qqq']).length, SPINE.length);
});

test('playableSpine leaves the input spine untouched', () => {
  const spine = [{ word: 'at', rank: 0, dolch: true }, { word: 'said', rank: 89, dolch: true }];
  const before = spine.length;
  playableSpine(spine, ['at']);
  assert.equal(spine.length, before, 'trimming must not mutate the caller');
});
