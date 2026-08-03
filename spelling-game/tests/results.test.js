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
  markedNote,
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

// --- markedNote ------------------------------------------------------------
//
// Progress is the marked-off count against the catalogue, NOT the old spine
// position and NOT a count of hot words (probe-and-release, 2026-08-03). These
// took over from the frontierNote tests one-for-one, and the case that used to
// be the interesting one — the number going backwards — is now the case that
// must produce no number at all.

test('markedNote counts the words finished since last session', () => {
  const note = markedNote(63, 59);
  assert.equal(note.tone, 'forward');
  assert.match(note.text, /^4 more words finished/);
});

test('markedNote singularises one word', () => {
  assert.match(markedNote(60, 59).text, /^1 more word finished/);
});

test('markedNote states a session that finished nothing flatly', () => {
  // The normal outcome of a good session and of every learn session: marking off
  // asks for three clean spellings across two sittings, so converting a stuck
  // word can easily finish none. It must not read as a stall or a failure.
  const note = markedNote(63, 63);
  assert.equal(note.tone, 'same');
  assert.doesNotMatch(note.text, /nothing|none|no new|still|stuck|did not|didn't/i);
});

test('markedNote makes no claim when the count has somehow fallen', () => {
  // Unreachable through play — both routes into `marked` read facts that only
  // accumulate. It means the item space shrank underneath the count, which is a
  // missing audio file, not something the kid did. Say nothing numeric rather
  // than tell her she lost words she did not lose.
  const note = markedNote(59, 63);
  assert.equal(note.tone, 'plain');
  assert.doesNotMatch(note.text, /\d/);
  assert.doesNotMatch(note.text, /lost|back|worse|fail|forgot/i);
});

test('markedNote has no previous session to compare against on a first run', () => {
  assert.equal(markedNote(20, null).tone, 'first');
  assert.equal(markedNote(0, null).tone, 'first');
  assert.equal(markedNote(20, undefined).tone, 'first');
});

test('markedNote survives a missing count rather than printing NaN', () => {
  assert.equal(markedNote(undefined, 20).tone, 'plain');
  assert.doesNotMatch(markedNote(undefined, 20).text, /NaN/);
  assert.equal(markedNote(NaN, 20).tone, 'plain');
});

test('no note on this screen compares the kid to anyone but herself', () => {
  // The house product rule, asserted rather than trusted to review. Both
  // permitted comparisons are against her own previous session; there is no
  // third reference point, and no wording that implies one.
  const notes = [
    markedNote(63, 59),
    markedNote(63, 63),
    markedNote(63, null),
    markedNote(59, 63),
    comparisonNote(4400, 5200),
    comparisonNote(5200, 4400),
    comparisonNote(4400, null),
  ];
  for (const note of notes) {
    assert.doesNotMatch(note.text, /average|typical kid|other|everyone|most kids|ahead of|behind/i);
    assert.doesNotMatch(note.text, /streak|record|score|target|goal|beat/i);
  }
});
