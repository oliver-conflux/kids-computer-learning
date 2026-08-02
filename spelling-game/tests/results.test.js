// Tests for the pure seams of the results screen.
//
// DELIBERATELY NARROW. `js/ui/results.js` is a DOM module and most of it can
// only be checked by looking at it — the plan's own history records that every
// DOM-layer bug in the typing build was invisible to 96 passing tests, so
// chasing coverage here buys confidence that is not there. What IS tested is the
// part that is pure logic wearing a renderer's clothes: the three helpers that
// turn numbers and log strings into sentences, where an off-by-one or a wrong
// sign produces a screen that lies to a kid rather than one that looks broken.
//
// Importing the module at all is itself a check: it must not touch `document`
// at load time, or main.js's import graph would break under node and the
// module could never be exercised outside a browser.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  comparisonNote,
  describeMisspelling,
  frontierNote,
  stageChip,
  stageText,
} from '../js/ui/results.js';

// --- describeMisspelling ---------------------------------------------------

test('describeMisspelling names an adjacent transposition', () => {
  assert.equal(describeMisspelling('friend', 'freind'), 'the right letters, two swapped over');
  assert.equal(describeMisspelling('their', 'thier'), 'the right letters, two swapped over');
});

test('describeMisspelling names a single substituted letter', () => {
  assert.equal(describeMisspelling('cat', 'cot'), 'one letter out');
  assert.equal(describeMisspelling('said', 'sald'), 'one letter out');
});

test('describeMisspelling names a missing and an extra letter', () => {
  assert.equal(describeMisspelling('little', 'litle'), 'a letter missing');
  assert.equal(describeMisspelling('said', 'sad'), 'a letter missing');
  assert.equal(describeMisspelling('coming', 'comming'), 'one letter too many');
});

test('describeMisspelling stays silent rather than guessing', () => {
  // Two edits apart. A confident label here would be worse than none, because
  // the note is the part a parent will believe.
  assert.equal(describeMisspelling('because', 'becuz'), null);
  assert.equal(describeMisspelling('friend', 'frend'), 'a letter missing');
  assert.equal(describeMisspelling('friend', 'fred'), null);
});

test('describeMisspelling handles the degenerate inputs a corrupt log can carry', () => {
  assert.equal(describeMisspelling('cat', 'cat'), null);
  assert.equal(describeMisspelling('cat', ''), null);
  assert.equal(describeMisspelling('', 'cat'), null);
  assert.equal(describeMisspelling('cat', null), null);
  assert.equal(describeMisspelling(undefined, 'cat'), null);
  assert.equal(describeMisspelling('cat', 42), null);
});

test('describeMisspelling does not call two non-adjacent swaps a transposition', () => {
  // `tac` is `cat` with the ends exchanged, which is a different mistake from
  // the ie/ei one and must not be described as it.
  assert.equal(describeMisspelling('cat', 'tac'), null);
});

// --- the stage vocabulary --------------------------------------------------

test('stageChip and stageText read the drill ladder', () => {
  assert.equal(stageChip('clean'), 'clean');
  assert.equal(stageChip('r1'), '1 shown');
  assert.equal(stageChip('r4'), '4 shown');
  assert.equal(stageText('clean'), 'straight from memory, no letters given');
  assert.equal(stageText('r1'), 'after 1 letter showed');
  assert.equal(stageText('r4'), 'after 4 letters showed');
});

test('an unknown stage falls through to itself rather than being guessed at', () => {
  // The ladder belongs to the word screen and the log outlives it. A rung this
  // file has never heard of must render as what it is, not as a wrong word.
  assert.equal(stageChip('blocks'), 'blocks');
  assert.equal(stageText('blocks'), 'blocks');
});

// --- comparisonNote --------------------------------------------------------

test('comparisonNote compares the DISPLAYED values, not the raw ones', () => {
  // 4.44s and 4.42s both render as "4.4s", so the sentence must not call them
  // different — it would contradict the two numbers printed next to it.
  assert.equal(comparisonNote(4440, 4420).tone, 'same');
  assert.equal(comparisonNote(4400, 5200).tone, 'quicker');
  assert.equal(comparisonNote(5200, 4400).tone, 'slower');
});

test('comparisonNote has no previous session to compare against on a first run', () => {
  assert.equal(comparisonNote(4400, null).tone, 'first');
  assert.equal(comparisonNote(4400, undefined).tone, 'first');
});

test('comparisonNote says nothing numeric when there is no median', () => {
  assert.equal(comparisonNote(null, 4400).tone, 'plain');
  assert.equal(comparisonNote(NaN, 4400).tone, 'plain');
});

test('a slower session is never described as a failure', () => {
  const note = comparisonNote(6000, 4000);
  assert.match(note.text, /that happens/);
});

// --- frontierNote ----------------------------------------------------------

test('frontierNote counts the words moved, not the raw indices', () => {
  const note = frontierNote(63, 59);
  assert.equal(note.tone, 'forward');
  assert.match(note.text, /^4 words further along/);
});

test('frontierNote singularises one word', () => {
  assert.match(frontierNote(60, 59).text, /^1 word further along/);
});

test('frontierNote reports a frontier that moved BACKWARDS plainly', () => {
  // Reachable and not a bug: a hot word cools when its clean spellings age out
  // of the retain window, re-enters the active window, and pulls the far edge
  // back. Reported as an explanation, never as a loss.
  const note = frontierNote(59, 63);
  assert.equal(note.tone, 'back');
  assert.match(note.text, /^4 words came back round/);
  assert.doesNotMatch(note.text, /lost|slipped|worse|fail/i);
});

test('frontierNote handles a standing start and a first session', () => {
  assert.equal(frontierNote(63, 63).tone, 'same');
  assert.equal(frontierNote(20, null).tone, 'first');
  assert.equal(frontierNote(0, null).tone, 'first');
});

test('frontierNote survives a missing frontier rather than printing NaN', () => {
  assert.equal(frontierNote(undefined, 20).tone, 'plain');
  assert.doesNotMatch(frontierNote(undefined, 20).text, /NaN/);
});
