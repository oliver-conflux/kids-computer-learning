// The results screen's pure seams.
//
// The screen itself is DOM and is not tested here — this repo does not test
// rendering. What is tested is the four functions that INTERPRET something
// rather than display it, because each of them reads a value written by another
// module into a file that outlives both, and each would be wrong silently:
//
//   - stageChip / stageText read the log's stage vocabulary months after the
//     ladder that wrote it may have changed shape
//   - describeWrong makes a factual claim about what a kid typed, and a
//     confident wrong label is worse than silence
//   - comparisonNote and frontierNote are the ONLY two comparisons the design
//     permits, and both are the kid against her own last session. Their tone is
//     a design decision, not a phrasing preference: a slower session must be
//     stated and shrugged off, never flagged.
//
// The module is importable in node because it does not look at `document` until
// something calls a render.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  stageChip,
  stageText,
  describeWrong,
  comparisonNote,
  frontierNote,
} from '../js/ui/results.js';

// --- the stage vocabulary ----------------------------------------------------

test('a clean attempt is named as one', () => {
  assert.equal(stageChip('clean'), 'clean');
  assert.equal(stageText('clean'), 'straight from memory, no letters given');
});

test('a reveal rung reports how many letters were given', () => {
  assert.equal(stageChip('r1'), '1 shown');
  assert.equal(stageChip('r12'), '12 shown');
  assert.equal(stageText('r1'), 'after 1 letter showed');
  assert.equal(stageText('r4'), 'after 4 letters showed');
});

test('an unrecognised stage falls through to itself rather than being guessed at', () => {
  for (const stage of ['strategy', 'reveal', 'nonsense', '']) {
    assert.equal(stageChip(stage), stage);
    assert.equal(stageText(stage), stage);
  }
});

// --- naming a wrong answer ---------------------------------------------------

const NAMES = new Map([
  ['belize', 'Belize'],
  ['guatemala', 'Guatemala'],
  ['costarica', 'Costa Rica'],
]);

test('a wrong answer that is another country names that country', () => {
  // The whole diagnostic value of this note. `guatemala` for Belize is a kid
  // with the right region and the wrong country, which is a completely
  // different lesson from a kid who typed `belgium`.
  assert.equal(describeWrong('guatemala', NAMES), 'that is Guatemala');
  assert.equal(describeWrong('costarica', NAMES), 'that is Costa Rica');
});

test('a wrong answer that is not a country gets no note at all', () => {
  // Silence rather than a guess: the note is the part a parent will believe.
  assert.equal(describeWrong('belgium', NAMES), null);
  assert.equal(describeWrong('qqq', NAMES), null);
  assert.equal(describeWrong('', NAMES), null);
});

test('describeWrong does not throw on junk out of a corrupt log', () => {
  for (const junk of [null, undefined, 42, {}, []]) {
    assert.equal(describeWrong(junk, NAMES), null, JSON.stringify(junk));
  }
});

// --- the median comparison ---------------------------------------------------

test('a first session is a starting point, not a score', () => {
  assert.equal(comparisonNote(4000, null).tone, 'first');
  assert.equal(comparisonNote(4000, undefined).tone, 'first');
});

test('the comparison is made on the DISPLAYED values, not the raw ones', () => {
  // 4.44s and 4.36s both render as "4.4s", so the sentence must not call them
  // different and contradict the two numbers beside it.
  assert.equal(comparisonNote(4440, 4360).tone, 'same');
  assert.equal(comparisonNote(4440, 4360).text, 'about the same as last time (4.4s)');
});

test('quicker is celebrated and slower is shrugged off', () => {
  assert.equal(comparisonNote(3000, 5000).tone, 'quicker');
  const slower = comparisonNote(6000, 4000);
  assert.equal(slower.tone, 'slower');
  assert.match(slower.text, /that happens/);
});

test('a missing median says something true rather than nothing', () => {
  assert.equal(comparisonNote(null, 4000).tone, 'plain');
  assert.equal(comparisonNote(undefined, null).tone, 'plain');
});

// --- the frontier comparison -------------------------------------------------

test('the frontier moving forward is reported as movement', () => {
  assert.equal(frontierNote(12, 8).tone, 'forward');
  assert.equal(frontierNote(12, 8).text, '4 steps further along than last time');
  assert.equal(frontierNote(9, 8).text, '1 step further along than last time');
});

test('a frontier that has not moved says so plainly', () => {
  assert.equal(frontierNote(8, 8).tone, 'same');
});

test('the frontier moving BACKWARDS is stated, not flagged', () => {
  // A hot item cools when its clean answers age out of the retain window and
  // comes back into the window, pulling the far edge with it. That is the
  // mastery model working, so it is muted like every other neutral note.
  const back = frontierNote(6, 10);
  assert.equal(back.tone, 'back');
  assert.match(back.text, /came back round/);
});

test('a first session and a junk frontier both avoid a comparison', () => {
  assert.equal(frontierNote(10, null).tone, 'first');
  assert.equal(frontierNote(Number.NaN, 4).tone, 'plain');
});
