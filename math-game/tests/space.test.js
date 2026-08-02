// The math adapter against the core contract.
//
// This file is the reason validateSpace exists: the spelling game will run the
// same check against its own adapter, and the two games cannot drift into two
// readings of the seam if both are pinned to one validator.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateSpace } from '../../core/space.js';
import { mathSpace } from '../js/space.js';

test('the math adapter satisfies the core contract', () => {
  assert.deepEqual(validateSpace(mathSpace), []);
});

test('allItems is the full 121-fact space', () => {
  assert.equal(mathSpace.allItems().length, 121);
});

test('relatedIds names the transpose', () => {
  assert.deepEqual(mathSpace.relatedIds('*:6x7'), ['*:7x6']);
});

test('a square fact relates to itself', () => {
  assert.deepEqual(mathSpace.relatedIds('*:6x6'), ['*:6x6']);
});

test('idFromEvent reads back what eventFields writes', () => {
  const fact = { op: '*', a: 6, b: 7 };
  assert.equal(mathSpace.idFromEvent(mathSpace.eventFields(fact)), '*:6x7');
});

test('idFromEvent returns null rather than throwing on junk', () => {
  for (const junk of [null, undefined, {}, { op: '*' }, { op: '*', a: '6', b: 7 }, 'nope']) {
    assert.equal(mathSpace.idFromEvent(junk), null, `junk: ${JSON.stringify(junk)}`);
  }
});

test('idFromEvent produces ids outside the known space rather than clamping', () => {
  // 11x11 is a well-formed event naming a fact that does not exist. The adapter
  // hands back its id and lets the caller's `known` check reject it — clamping
  // here would silently fold an out-of-range attempt onto a real fact.
  assert.equal(mathSpace.idFromEvent({ op: '*', a: 11, b: 11 }), '*:11x11');
});

test('targetOf is the product as a string and answerValue is the number', () => {
  const fact = { op: '*', a: 6, b: 7 };
  assert.equal(mathSpace.targetOf(fact), '42');
  assert.equal(mathSpace.answerValue(fact), 42);
});

test('coerceWrong yields a number so the interference guard can compare it', () => {
  assert.equal(mathSpace.coerceWrong('48'), 48);
  assert.equal(mathSpace.answerValue({ op: '*', a: 6, b: 8 }), 48);
});

test('isTypableChar accepts single digits only', () => {
  for (const char of ['0', '5', '9']) {
    assert.equal(mathSpace.isTypableChar(char), true, char);
  }
  for (const char of ['', 'a', '12', ' ', '-', 'Enter']) {
    assert.equal(mathSpace.isTypableChar(char), false, JSON.stringify(char));
  }
});
