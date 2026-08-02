import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateSpace } from '../../core/space.js';
import { geographySpace } from '../js/space.js';
import { SPINE } from '../js/spine.js';

test('the geography adapter satisfies the core contract', () => {
  assert.deepEqual(validateSpace(geographySpace), []);
});

test('allItems is the spine, and ids are total over it', () => {
  const items = geographySpace.allItems();
  assert.equal(items.length, SPINE.length);
  const ids = new Set(items.map((item) => geographySpace.itemId(item)));
  assert.equal(ids.size, SPINE.length, 'every item has a distinct id');
});

test('ids name both the kind and the country', () => {
  assert.equal(geographySpace.itemId({ code: 'bz', kind: 'shape' }), 'geo:shape:bz');
  assert.equal(geographySpace.itemId({ code: 'bz', kind: 'flag' }), 'geo:flag:bz');
});

test('shape and flag name each other, and nothing else', () => {
  assert.deepEqual(geographySpace.relatedIds('geo:shape:bz'), ['geo:flag:bz']);
  assert.deepEqual(geographySpace.relatedIds('geo:flag:bz'), ['geo:shape:bz']);
});

test('relatedIds returns empty for an id it does not recognise', () => {
  for (const junk of ['w:friend', 'geo:bz', '', 'geo:shape:', 'nope']) {
    assert.deepEqual(geographySpace.relatedIds(junk), [], junk);
  }
});

test('idFromEvent reads back what eventFields writes', () => {
  for (const item of [{ code: 'bz', kind: 'shape' }, { code: 'fr', kind: 'flag' }]) {
    const fields = geographySpace.eventFields(item);
    assert.equal(geographySpace.idFromEvent(fields), `geo:${item.kind}:${item.code}`);
  }
});

test('idFromEvent returns null rather than throwing on junk', () => {
  for (const junk of [null, undefined, {}, { code: 42 }, { code: 'bz' }, { kind: 'shape' }, 'nope', { word: 'cat' }]) {
    assert.equal(geographySpace.idFromEvent(junk), null, JSON.stringify(junk));
  }
});

test('the typed target is letters only', () => {
  assert.equal(geographySpace.targetOf({ target: 'costarica' }), 'costarica');
  for (const item of geographySpace.allItems()) {
    assert.match(geographySpace.targetOf(item), /^[a-z]+$/, item.name);
  }
});

test('only letters are typable — space does not advance a slot', () => {
  assert.ok(geographySpace.isTypableChar('a'));
  for (const char of [' ', '-', "'", '1', 'A', '.']) {
    assert.ok(!geographySpace.isTypableChar(char), char);
  }
});
