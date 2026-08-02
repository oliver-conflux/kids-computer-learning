import test from 'node:test';
import assert from 'node:assert/strict';

import { activeWindow } from '../js/frontier.js';
import { spellingSpace } from '../js/space.js';

/** The id encoding under test comes from the adapter, not from a copy of it. */
const wordId = (word) => spellingSpace.itemId({ word, rank: 0, dolch: false });

/** A fixture spine. spine.js belongs to another task; these tests do not need it. */
function spineOf(...words) {
  return words.map((word, index) => ({ word, rank: index, dolch: false }));
}

/**
 * A mastery model over `spine`, total in `byId` the way deriveMastery guarantees.
 * `buckets` names the exceptions; everything unnamed is cold.
 */
function modelOf(spine, buckets = {}) {
  const byId = new Map();
  for (const entry of spine) {
    const id = wordId(entry.word);
    byId.set(id, {
      id,
      item: entry,
      bucket: buckets[entry.word] ?? 'cold',
      attempts: [],
      cleanCount: 0,
      medianCleanMs: null,
      taught: false,
    });
  }
  return { byId, confusions: new Map() };
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('');

/** A 26-word spine, one word per letter, so positions are readable in a failure. */
function longSpine() {
  return spineOf(...ALPHABET.map((letter) => `${letter}word`));
}

// --- the one that matters -----------------------------------------------------

test('a single permanently-cold word does not stop the window advancing past it', () => {
  // The whole prefix is mastered except one word the kid cannot get. That word
  // stays in — it is not hot — and the window must fill up from FURTHER DOWN the
  // spine, not from the words immediately behind it.
  const spine = longSpine();
  const buckets = {};
  for (const entry of spine.slice(1, 20)) {
    buckets[entry.word] = 'hot';
  }
  const leech = spine[0].word; // cold forever, never leaves

  const window = activeWindow(spine, modelOf(spine, buckets), 3);

  assert.deepEqual(window, [wordId(leech), wordId('uword'), wordId('vword')]);

  // Stated as properties too, because the literal above is easy to "fix" wrongly:
  assert.equal(window.length, 3, 'the leech must not shrink the window');
  assert.ok(window.includes(wordId(leech)), 'the leech is still being served');

  const positions = window.map((id) => spine.findIndex((entry) => wordId(entry.word) === id));
  assert.ok(Math.max(...positions) >= 20, 'the window reached past the 19 mastered words');
});

test('the naive readings of the rule are both wrong', () => {
  // Same fixture as above, spelled out against the two implementations someone
  // would reach for first. If either of these ever passes, the frontier has
  // silently become a contiguous slice again.
  const spine = longSpine();
  const buckets = {};
  for (const entry of spine.slice(1, 20)) {
    buckets[entry.word] = 'hot';
  }
  const model = modelOf(spine, buckets);
  const window = activeWindow(spine, model, 3);

  const firstNWords = spine.slice(0, 3).map((entry) => wordId(entry.word));
  assert.notDeepEqual(window, firstNWords, 'must not be simply the first N words');

  const untilFirstHot = [];
  for (const entry of spine) {
    if (model.byId.get(wordId(entry.word)).bucket === 'hot') break;
    untilFirstHot.push(wordId(entry.word));
  }
  assert.equal(untilFirstHot.length, 1, 'fixture check: the contiguous run is one word long');
  assert.notDeepEqual(window, untilFirstHot, 'must not stop at the first hot word');
});

test('two leeches far apart both stay in and the window still reaches the end', () => {
  const spine = longSpine();
  const buckets = {};
  for (const [index, entry] of spine.entries()) {
    if (index !== 0 && index !== 12 && index < 24) buckets[entry.word] = 'hot';
  }

  assert.deepEqual(activeWindow(spine, modelOf(spine, buckets), 4), [
    wordId('aword'),
    wordId('mword'),
    wordId('yword'),
    wordId('zword'),
  ]);
});

// --- the ordinary cases -------------------------------------------------------

test('an empty log yields the first `size` words in spine order', () => {
  const spine = longSpine();
  // No events at all means every word is cold, which is what deriveMastery
  // returns over an empty log.
  const window = activeWindow(spine, modelOf(spine), 5);
  assert.deepEqual(window, ['aword', 'bword', 'cword', 'dword', 'eword'].map(wordId));
});

test('a fully hot prefix slides the window forward', () => {
  const spine = longSpine();
  const buckets = {};
  for (const entry of spine.slice(0, 10)) {
    buckets[entry.word] = 'hot';
  }

  const window = activeWindow(spine, modelOf(spine, buckets), 4);
  assert.deepEqual(window, ['kword', 'lword', 'mword', 'nword'].map(wordId));
});

test('warm words stay in the window; only hot leaves', () => {
  const spine = spineOf('cat', 'bat', 'hat', 'sat');
  const model = modelOf(spine, { cat: 'warm', bat: 'hot', hat: 'cold' });

  assert.deepEqual(activeWindow(spine, model, 3), [wordId('cat'), wordId('hat'), wordId('sat')]);
});

test('a spine shorter than `size` returns what exists', () => {
  const spine = spineOf('cat', 'bat', 'hat');
  assert.deepEqual(activeWindow(spine, modelOf(spine), 20), ['cat', 'bat', 'hat'].map(wordId));
});

test('an entirely hot spine yields an empty window', () => {
  const spine = spineOf('cat', 'bat', 'hat');
  const model = modelOf(spine, { cat: 'hot', bat: 'hot', hat: 'hot' });
  assert.deepEqual(activeWindow(spine, model, 20), []);
});

test('an empty spine yields an empty window', () => {
  assert.deepEqual(activeWindow([], modelOf([]), 20), []);
});

test('a size of zero or less yields an empty window rather than throwing', () => {
  const spine = spineOf('cat', 'bat', 'hat');
  const model = modelOf(spine);
  assert.deepEqual(activeWindow(spine, model, 0), []);
  assert.deepEqual(activeWindow(spine, model, -3), []);
});

test('a word missing from the model is treated as not hot, never dropped', () => {
  // byId is total in practice. If it ever is not, the safe reading of "no entry"
  // is "no evidence", and a word must not vanish out of the game silently.
  const spine = spineOf('cat', 'bat', 'hat');
  const model = modelOf(spine, { cat: 'hot' });
  model.byId.delete(wordId('bat'));

  assert.deepEqual(activeWindow(spine, model, 5), [wordId('bat'), wordId('hat')]);
});

test('the window is in spine order, not bucket order', () => {
  const spine = longSpine();
  const buckets = { bword: 'warm', cword: 'hot', dword: 'warm' };
  const window = activeWindow(spine, modelOf(spine, buckets), 4);
  assert.deepEqual(window, ['aword', 'bword', 'dword', 'eword'].map(wordId));
});

test('the window never contains a duplicate', () => {
  const spine = longSpine();
  const window = activeWindow(spine, modelOf(spine), 26);
  assert.equal(new Set(window).size, window.length);
});

// --- ids ----------------------------------------------------------------------

test('the window is keyed by the adapter\'s ids, which mastery is also keyed by', () => {
  assert.equal(wordId('friend'), 'w:friend');

  const spine = spineOf('friend', 'could');
  assert.deepEqual(activeWindow(spine, modelOf(spine), 2), spine.map((e) => spellingSpace.itemId(e)));
});

test('activeWindow is pure — it does not mutate the spine or the model', () => {
  const spine = longSpine();
  const model = modelOf(spine, { aword: 'hot' });
  const spineBefore = JSON.stringify(spine);
  const bucketsBefore = [...model.byId.values()].map((s) => s.bucket).join(',');

  activeWindow(spine, model, 5);
  activeWindow(spine, model, 5);

  assert.equal(JSON.stringify(spine), spineBefore);
  assert.equal([...model.byId.values()].map((s) => s.bucket).join(','), bucketsBefore);
});

test('the same inputs give the same window every time', () => {
  const spine = longSpine();
  const model = modelOf(spine, { cword: 'hot', dword: 'hot' });
  assert.deepEqual(activeWindow(spine, model, 7), activeWindow(spine, model, 7));
});
