// typing-game/tests/keymap.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FINGER, NAMES, ROWS, U, GAP,
  fingerFor, fingerName, needsShift, baseKeyFor, shiftSideFor, keyWidth,
} from '../js/keymap.js';

test('every letter has a finger', () => {
  for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
    assert.ok(fingerFor(ch) !== null, `no finger for ${ch}`);
  }
});

test('every digit and the number-row tag-alongs have a finger', () => {
  for (const ch of '1234567890-=') {
    assert.ok(fingerFor(ch) !== null, `no finger for ${ch}`);
  }
});

test('digits follow standard touch-typing assignments', () => {
  const expected = {
    '1': 'lp', '2': 'lr', '3': 'lm', '4': 'li', '5': 'li',
    '6': 'ri', '7': 'ri', '8': 'rm', '9': 'rr', '0': 'rp',
    '-': 'rp', '=': 'rp',
  };
  for (const [ch, code] of Object.entries(expected)) {
    assert.equal(fingerFor(ch), code, `${ch} should be ${code}`);
  }
});

test('every finger in FINGER has a display name', () => {
  for (const code of new Set(Object.values(FINGER))) {
    assert.equal(typeof NAMES[code], 'string');
    assert.ok(NAMES[code].length > 0, `empty name for ${code}`);
  }
});

test('fingerFor is case-insensitive for letters', () => {
  assert.equal(fingerFor('T'), fingerFor('t'));
});

test('ROWS includes the full number row', () => {
  const labels = ROWS[0].map((k) => (Array.isArray(k) ? k[0] : k));
  assert.deepEqual(labels.slice(0, 13), ['`','1','2','3','4','5','6','7','8','9','0','-','=']);
});

test('needsShift is true for capitals and the four shifted punctuation marks', () => {
  for (const ch of 'ABZ') assert.equal(needsShift(ch), true, ch);
  for (const ch of '?!":') assert.equal(needsShift(ch), true, ch);
});

test('needsShift is false for lowercase, digits, and unshifted punctuation', () => {
  for (const ch of "az0 9.,/;'") assert.equal(needsShift(ch), false, JSON.stringify(ch));
});

test('baseKeyFor maps shifted characters to their physical key', () => {
  assert.equal(baseKeyFor('A'), 'a');
  assert.equal(baseKeyFor('?'), '/');
  assert.equal(baseKeyFor('!'), '1');
  assert.equal(baseKeyFor('"'), "'");
  assert.equal(baseKeyFor(':'), ';');
  assert.equal(baseKeyFor('e'), 'e');
});

test('shiftSideFor returns the OPPOSITE hand for every letter', () => {
  for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
    const upper = ch.toUpperCase();
    const hand = fingerFor(ch)[0]; // 'l' or 'r'
    const expected = hand === 'l' ? 'ShiftRight' : 'ShiftLeft';
    assert.equal(shiftSideFor(upper), expected, `${upper} wants ${expected}`);
  }
});

test('shiftSideFor handles the spec example: T is left index, wants right shift', () => {
  assert.equal(shiftSideFor('T'), 'ShiftRight');
});

test('shiftSideFor returns null for characters that need no shift', () => {
  assert.equal(shiftSideFor('t'), null);
  assert.equal(shiftSideFor('4'), null);
});

test('! is shift-1, a left pinky key, so it wants the right shift', () => {
  assert.equal(shiftSideFor('!'), 'ShiftRight');
});

test('keyWidth applies the design formula', () => {
  assert.equal(U, 52);
  assert.equal(GAP, 8);
  assert.equal(keyWidth(1), 52);
  assert.equal(keyWidth(2), 2 * 52 + 8);
  assert.equal(keyWidth(1.5), 1.5 * 52 + 0.5 * 8);
});
