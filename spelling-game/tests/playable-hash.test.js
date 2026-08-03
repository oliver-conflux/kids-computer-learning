import test from 'node:test';
import assert from 'node:assert/strict';

import { playableHash } from '../js/playable-hash.js';

/** A stand-in for a real playable list — the shape matters, not the words. */
const WORDS = ['at', 'cat', 'hat', 'because', 'friend', 'necessary'];

// --- the one that matters -----------------------------------------------------

test('the same words in a different order hash the same', () => {
  // The playable list comes out of a directory listing, whose order is not
  // guaranteed between runs. If this ever fails, every session gets a fresh hash
  // and the log reports that the item space is changing constantly — which is
  // worse than no hash, because it trains a reader to ignore the signal.
  const forwards = playableHash(WORDS);
  const backwards = playableHash([...WORDS].reverse());
  const shuffled = playableHash(['friend', 'at', 'necessary', 'hat', 'because', 'cat']);

  assert.equal(backwards, forwards);
  assert.equal(shuffled, forwards);
});

test('sorting is by code unit, not by locale', () => {
  // localeCompare would make the hash depend on the machine's locale and ICU
  // build, so two machines replaying the same log would disagree. Casing is the
  // cheapest way to catch that: code-unit order puts all capitals first, most
  // locale collations interleave them.
  const mixed = ['Zebra', 'apple', 'Apple', 'zebra'];
  assert.equal(playableHash([...mixed].reverse()), playableHash(mixed));
  // And the two orderings genuinely differ, so the assertion above has teeth.
  assert.notDeepEqual([...mixed].sort(), [...mixed].sort((a, b) => a.localeCompare(b)));
});

// --- sensitivity --------------------------------------------------------------

test('different word sets hash differently', () => {
  assert.notEqual(playableHash(['cat', 'hat']), playableHash(['dog', 'log']));
});

test('adding one word changes the hash', () => {
  // The real change this module was written for: 401 words appearing in the
  // audio cache between one session and a later replay.
  const before = playableHash(WORDS);
  const after = playableHash([...WORDS, 'said']);
  assert.notEqual(after, before);
});

test('removing one word changes the hash', () => {
  const after = playableHash(WORDS.filter((word) => word !== 'friend'));
  assert.notEqual(after, playableHash(WORDS));
});

test('the same word count with one word swapped changes the hash', () => {
  // The count suffix cannot see this, so it is the hash body doing the work.
  const swapped = WORDS.map((word) => (word === 'friend' ? 'fiend' : word));
  assert.equal(swapped.length, WORDS.length);
  assert.notEqual(playableHash(swapped), playableHash(WORDS));
});

test('the word boundary is part of the fingerprint', () => {
  // Without a separator these two lists concatenate to the same characters and
  // would claim to be the same item space.
  assert.notEqual(playableHash(['ab', 'c']), playableHash(['a', 'bc']));
});

test('a duplicated word is a different list', () => {
  assert.notEqual(playableHash(['cat', 'cat']), playableHash(['cat']));
});

// --- edges --------------------------------------------------------------------

test('an empty list does not throw and is stable', () => {
  const empty = playableHash([]);
  assert.equal(typeof empty, 'string');
  assert.equal(empty, playableHash([]));
  assert.notEqual(empty, playableHash(['cat']));
});

test('a one-word list is fine', () => {
  assert.equal(typeof playableHash(['cat']), 'string');
});

test('a realistic list size does not blow up', () => {
  // The real PLAYABLE list is in the hundreds; this is well past it.
  const many = Array.from({ length: 2000 }, (_, index) => `word${index}`);
  const hash = playableHash(many);
  assert.equal(hash, playableHash([...many].reverse()));
  assert.equal(hash.split('.')[1], '2000');
});

// --- purity and shape ---------------------------------------------------------

test('the caller\'s array is not mutated', () => {
  // The caller passes the live PLAYABLE list. Sorting it in place would reorder
  // the list the game draws from, causing the divergence this module detects.
  const words = [...WORDS];
  playableHash(words);
  assert.deepEqual(words, WORDS);
});

test('repeated calls give the identical string', () => {
  assert.equal(playableHash(WORDS), playableHash(WORDS));
  assert.equal(playableHash(WORDS), playableHash([...WORDS]));
});

test('the output is a short string, safe to put on every session event', () => {
  const hash = playableHash(WORDS);
  assert.equal(typeof hash, 'string');
  assert.ok(hash.length <= 16, `expected something compact, got ${hash.length} chars: ${hash}`);
  assert.match(hash, /^[0-9a-f]{8}\.\d+$/);
});

test('the suffix is the word count, readable without running anything', () => {
  assert.equal(playableHash(WORDS).split('.')[1], String(WORDS.length));
  assert.equal(playableHash([]).split('.')[1], '0');
});

test('the hash body is pinned, so a change to the algorithm is a visible change', () => {
  // Not a property, a regression guard. Hashes already written into the log stop
  // being comparable if this value moves, so it should only ever change
  // deliberately — alongside a config `build` bump.
  assert.equal(playableHash(['at', 'cat', 'hat']), playableHash(['hat', 'at', 'cat']));
  assert.equal(playableHash([]), '811c9dc5.0');
});
