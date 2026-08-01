import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  allFacts,
  factId,
  parseFactId,
  answerOf,
  answerDigits,
  transposeId,
} from '../js/facts.js';

test('allFacts returns exactly 121 facts', () => {
  assert.equal(allFacts().length, 121);
});

test('allFacts covers operands 0..10 in both orientations', () => {
  const ids = new Set(allFacts().map(factId));
  for (let a = 0; a <= 10; a += 1) {
    for (let b = 0; b <= 10; b += 1) {
      assert.ok(ids.has(`*:${a}x${b}`), `missing *:${a}x${b}`);
    }
  }
});

test('allFacts has no duplicate ids', () => {
  const facts = allFacts();
  const ids = new Set(facts.map(factId));
  assert.equal(ids.size, facts.length);
});

test('allFacts order is stable and row-major', () => {
  const first = allFacts();
  const second = allFacts();
  assert.deepEqual(first, second);

  assert.deepEqual(first[0], { op: '*', a: 0, b: 0 });
  assert.deepEqual(first[1], { op: '*', a: 0, b: 1 });
  assert.deepEqual(first[11], { op: '*', a: 1, b: 0 });
  assert.deepEqual(first[120], { op: '*', a: 10, b: 10 });

  first.forEach((fact, index) => {
    assert.equal(fact.a * 11 + fact.b, index);
  });
});

test('factId and parseFactId round-trip for every one of the 121 facts', () => {
  for (const fact of allFacts()) {
    const id = factId(fact);
    assert.deepEqual(parseFactId(id), fact);
    assert.equal(factId(parseFactId(id)), id);
  }
});

test('factId formats as op:axb', () => {
  assert.equal(factId({ op: '*', a: 6, b: 7 }), '*:6x7');
  assert.equal(factId({ op: '*', a: 10, b: 0 }), '*:10x0');
});

test('6x7 and 7x6 are two different facts with two different ids', () => {
  const sixSeven = { op: '*', a: 6, b: 7 };
  const sevenSix = { op: '*', a: 7, b: 6 };
  assert.notEqual(factId(sixSeven), factId(sevenSix));
  assert.equal(factId(sixSeven), '*:6x7');
  assert.equal(factId(sevenSix), '*:7x6');
});

test('transposeId of 6x7 is *:7x6', () => {
  assert.equal(transposeId({ op: '*', a: 6, b: 7 }), '*:7x6');
});

test('transposeId is an involution and preserves squares', () => {
  for (const fact of allFacts()) {
    assert.equal(transposeId(parseFactId(transposeId(fact))), factId(fact));
  }
  assert.equal(transposeId({ op: '*', a: 4, b: 4 }), '*:4x4');
});

test('parseFactId rejects a malformed id', () => {
  assert.throws(() => parseFactId('6x7'));
  assert.throws(() => parseFactId('*:6*7'));
  assert.throws(() => parseFactId(''));
});

test('answerOf is correct for representative facts including zero', () => {
  assert.equal(answerOf({ op: '*', a: 0, b: 7 }), 0);
  assert.equal(answerOf({ op: '*', a: 7, b: 0 }), 0);
  assert.equal(answerOf({ op: '*', a: 1, b: 9 }), 9);
  assert.equal(answerOf({ op: '*', a: 2, b: 2 }), 4);
  assert.equal(answerOf({ op: '*', a: 6, b: 7 }), 42);
  assert.equal(answerOf({ op: '*', a: 7, b: 6 }), 42);
  assert.equal(answerOf({ op: '*', a: 8, b: 9 }), 72);
  assert.equal(answerOf({ op: '*', a: 10, b: 10 }), 100);
});

test('answerDigits is 1 for 2x2, 2 for 6x7, 3 for 10x10', () => {
  assert.equal(answerDigits({ op: '*', a: 2, b: 2 }), 1);
  assert.equal(answerDigits({ op: '*', a: 6, b: 7 }), 2);
  assert.equal(answerDigits({ op: '*', a: 10, b: 10 }), 3);
});

// Deliberately does NOT reuse String(product).length — that is the production
// formula, and asserting it against itself would pass even if both were wrong
// the same way. A piecewise range check is an independent statement of intent.
test('answerDigits matches the product range for every fact', () => {
  for (const fact of allFacts()) {
    const product = answerOf(fact);
    const expected = product <= 9 ? 1 : product <= 99 ? 2 : 3;
    assert.equal(
      answerDigits(fact),
      expected,
      `${factId(fact)} product ${product}`,
    );
  }
});

test('answerDigits changes at the 9 to 10 boundary', () => {
  assert.equal(answerDigits({ op: '*', a: 3, b: 3 }), 1); // 9
  assert.equal(answerDigits({ op: '*', a: 2, b: 5 }), 2); // 10
});

test('answerDigits treats a zero product as one digit', () => {
  assert.equal(answerDigits({ op: '*', a: 0, b: 0 }), 1);
  assert.equal(answerDigits({ op: '*', a: 0, b: 10 }), 1);
});

test('10x10 is the only three-digit answer', () => {
  const threeDigit = allFacts().filter((fact) => answerDigits(fact) === 3);
  assert.deepEqual(threeDigit.map(factId), ['*:10x10']);
});
