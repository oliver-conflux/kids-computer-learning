// The spelling adapter against the core contract.
//
// The same validator the math adapter runs. That is the point of having one:
// two games cannot drift into two readings of the seam if both are pinned to it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateSpace } from '../../core/space.js';
import { spellingSpace } from '../js/space.js';
import { SPINE } from '../js/spine.js';
import { CONFIG } from '../js/config.js';

test('the spelling adapter satisfies the core contract', () => {
  assert.deepEqual(validateSpace(spellingSpace), []);
});

test('allItems is the spine, and ids are total over it', () => {
  const items = spellingSpace.allItems();
  assert.equal(items.length, SPINE.length);
  const ids = new Set(items.map((item) => spellingSpace.itemId(item)));
  assert.equal(ids.size, SPINE.length, 'every word has a distinct id');
});

test('ids carry the w: prefix', () => {
  assert.equal(spellingSpace.itemId({ word: 'friend' }), 'w:friend');
});

test('idFromEvent reads back what eventFields writes', () => {
  for (const word of ['cat', 'friend', 'because']) {
    const item = { word, rank: 0, dolch: false };
    assert.equal(spellingSpace.idFromEvent(spellingSpace.eventFields(item)), `w:${word}`);
  }
});

test('idFromEvent returns null rather than throwing on junk', () => {
  for (const junk of [null, undefined, {}, { word: 42 }, { word: '' }, 'nope', { op: '*' }]) {
    assert.equal(spellingSpace.idFromEvent(junk), null, JSON.stringify(junk));
  }
});

test('eventFields carries the patterns that were on screen', () => {
  const fields = spellingSpace.eventFields({ word: 'cat', rank: 0, dolch: false });
  assert.equal(fields.word, 'cat');
  assert.ok(Array.isArray(fields.patterns) && fields.patterns.length > 0);
});

test('relatedIds is empty — rhyming words are not a transpose', () => {
  assert.deepEqual(spellingSpace.relatedIds('w:light'), []);
});

test('a misspelling stays a string, uncoerced', () => {
  assert.equal(spellingSpace.coerceWrong('freind'), 'freind');
  assert.equal(spellingSpace.isValidWrong('freind'), true);
  assert.equal(spellingSpace.isValidWrong(''), false);
  assert.equal(spellingSpace.isValidWrong(42), false);
  assert.equal(spellingSpace.isValidWrong(null), false);
});

test('isTypableChar accepts single lowercase letters only', () => {
  for (const char of ['a', 'm', 'z']) {
    assert.equal(spellingSpace.isTypableChar(char), true, char);
  }
  for (const char of ['', 'A', 'ab', ' ', '4', '-', 'Enter']) {
    assert.equal(spellingSpace.isTypableChar(char), false, JSON.stringify(char));
  }
});

test('every spine word is typable end to end', () => {
  // If a word contains a character the engine will not accept, the kid can never
  // reach the length at which it evaluates and the problem hangs forever, with
  // no error anywhere. validateSpace covers this; pinning it separately because
  // the spine is hand-edited data and this is how a bad edit would show up.
  for (const item of SPINE) {
    for (const char of spellingSpace.targetOf(item)) {
      assert.equal(spellingSpace.isTypableChar(char), true, `${item.word} has ${char}`);
    }
  }
});

test('the config supplies every key the shared core reads', () => {
  for (const key of [
    'retain',
    'hotMs',
    'maxPlausibleMs',
    'weights',
    'noRepeatWithin',
    'governorWindow',
    'governorFloor',
    'build',
    'logTail',
  ]) {
    assert.ok(CONFIG[key] !== undefined, `core reads ${key} and the table lacks it`);
  }
  for (const bucket of ['cold', 'warm', 'hot']) {
    assert.equal(typeof CONFIG.weights[bucket], 'number');
    assert.equal(typeof CONFIG.delays[bucket], 'number');
  }
});

test('hotMs is not math 1500 — a word takes longer to type than a product', () => {
  assert.ok(CONFIG.hotMs > 1500, 'see the comment in config.js; this is deliberate');
});

test('the hint delay grows with mastery rather than shrinking', () => {
  assert.ok(CONFIG.delays.cold < CONFIG.delays.warm);
  assert.ok(CONFIG.delays.warm < CONFIG.delays.hot);
});
