// The progressive reveal, and the learn ladder — the two screens' pure seams.
//
// These files are DOM modules and most of what they do is only verifiable by
// playing the game: the amber pulse painting, the press-and-hold hiding on
// release, the word not moving when a letter arrives. That is deliberate — the
// plan's own history records that every DOM-layer bug in the typing build was
// invisible to 96 passing tests — so this file does not chase coverage. It pins
// the four decisions that are pure functions, that reach the LOG, and that would
// fail silently in a running game:
//
//   - the ladder has a rung per letter, so a wrong answer buys EXACTLY ONE more
//     and `stage === 'clean'` means exactly zero were given away
//   - the delay to the FIRST letter grows with mastery, and the step between
//     letters does not. Spec §14 names this the rule most likely to be silently
//     reverted
//   - learn mode reveals no letters at all, however its stage moved
//   - a learn ladder starts with 'strategy', which is the string core/engine.js
//     reads to decide that `tick` is a no-op
//
// No DOM is touched here. Both modules are importable in node because neither
// looks at `document` until something calls a render.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { revealLadder, revealedCount, revealDelayMs } from '../js/ui/word.js';
import { learnLadder, familyHeading } from '../js/ui/learn.js';

/** The shipped table, restated so a change to config.js is visible here. */
const CONFIG = {
  delays: { cold: 4000, warm: 6000, hot: 8000 },
  letterStepMs: 1200,
};

/** The parts of a ProblemState these functions read, and nothing else. */
function stateAt(ladder, stage) {
  return { ladder, stage };
}

// --- the ladder --------------------------------------------------------------

test('the ladder has one rung per letter, plus clean', () => {
  assert.deepEqual(revealLadder('cat'), ['clean', 'r1', 'r2', 'r3']);
  assert.equal(revealLadder('elephant').length, 'elephant'.length + 1);
});

test('the last rung shows the whole word, so a stuck kid always reaches an answer', () => {
  const word = 'friend';
  const ladder = revealLadder(word);
  assert.equal(revealedCount(stateAt(ladder, ladder[ladder.length - 1])), word.length);
});

test('a malformed word yields a ladder that is still usable', () => {
  assert.deepEqual(revealLadder(undefined), ['clean']);
  assert.deepEqual(revealLadder(''), ['clean']);
});

// --- how many letters are showing --------------------------------------------

test("stage 'clean' means zero letters were revealed — the log's whole definition of retrieval", () => {
  const ladder = revealLadder('cat');
  assert.equal(revealedCount(stateAt(ladder, 'clean')), 0);
});

test('each rung reveals exactly one more letter', () => {
  const ladder = revealLadder('friend');
  const counts = ladder.map((stage) => revealedCount(stateAt(ladder, stage)));
  assert.deepEqual(counts, [0, 1, 2, 3, 4, 5, 6]);
});

test('a wrong answer buys exactly one letter, not two and not the rest', () => {
  // What the engine does on a wrong entry is advance the stage by one rung. This
  // is the reveal side of that: one rung is one letter.
  const ladder = revealLadder('bat');
  const before = revealedCount(stateAt(ladder, 'clean'));
  const after = revealedCount(stateAt(ladder, 'r1'));
  assert.equal(after - before, 1);
});

test('learn mode reveals no letters, whatever its stage says', () => {
  // Pressing "show me" moves a learn problem to the last rung. By ladder index
  // alone that would grey the first letter into the slots at the exact moment
  // the kid is trying to hold the whole word in her head.
  const ladder = learnLadder();
  assert.equal(revealedCount(stateAt(ladder, 'strategy'), 'learn'), 0);
  assert.equal(revealedCount(stateAt(ladder, 'reveal'), 'learn'), 0);
});

test('an unrecognised stage reveals nothing rather than throwing', () => {
  const ladder = revealLadder('cat');
  assert.equal(revealedCount(stateAt(ladder, 'nonsense')), 0);
  assert.equal(revealedCount(null), 0);
});

// --- the two timings ---------------------------------------------------------

test('the delay to the FIRST letter grows with mastery — it does not shrink', () => {
  const ladder = revealLadder('cat');
  const clean = stateAt(ladder, 'clean');

  const cold = revealDelayMs(clean, 'cold', CONFIG);
  const warm = revealDelayMs(clean, 'warm', CONFIG);
  const hot = revealDelayMs(clean, 'hot', CONFIG);

  assert.ok(cold < warm && warm < hot, `expected cold < warm < hot, got ${cold} ${warm} ${hot}`);
});

test('the step between letters is flat, and is not the bucket delay', () => {
  const ladder = revealLadder('friend');
  for (const stage of ['r1', 'r3', 'r5']) {
    const state = stateAt(ladder, stage);
    assert.equal(revealDelayMs(state, 'cold', CONFIG), CONFIG.letterStepMs);
    assert.equal(revealDelayMs(state, 'hot', CONFIG), CONFIG.letterStepMs);
  }
});

test('an unknown bucket rescues the kid soonest rather than latest', () => {
  const ladder = revealLadder('cat');
  const state = stateAt(ladder, 'clean');
  assert.equal(revealDelayMs(state, undefined, CONFIG), CONFIG.delays.cold);
});

// --- the learn ladder --------------------------------------------------------

test("a learn ladder starts with 'strategy', which is what makes tick a no-op", () => {
  // core/engine.js reads `ladder[0] === 'strategy'` to decide a problem is a
  // learn problem. A ladder named anything else looks identical and quietly
  // gives learn mode a clock and a punishment for wrong answers.
  assert.equal(learnLadder()[0], 'strategy');
});

test('the learn ladder is a fresh copy each call', () => {
  const first = learnLadder();
  first.push('extra');
  assert.deepEqual(learnLadder(), ['strategy', 'reveal']);
});

// --- the header copy ---------------------------------------------------------

test('a rime family reads as "These are -at words"', () => {
  assert.deepEqual(familyHeading({ pattern: '-at' }), {
    before: 'These are',
    tag: '-at',
    after: 'words',
  });
});

test('the irregular set is told the truth about, and is never called a family', () => {
  const heading = familyHeading({ pattern: 'irregular' });
  assert.equal(heading.tag, null);
  assert.match(heading.before, /remember/);
  assert.doesNotMatch(`${heading.before} ${heading.after}`, /words/);
});

test('a structural tag does not claim the words contain it', () => {
  // "These are silent-e words" would be a sentence about a string the words do
  // not contain. The exception table exists for exactly these.
  assert.notDeepEqual(familyHeading({ pattern: 'silent-e' }), {
    before: 'These are',
    tag: 'silent-e',
    after: 'words',
  });
});

test('no family yields an empty heading rather than a broken sentence', () => {
  assert.deepEqual(familyHeading({ pattern: null }), { before: '', tag: null, after: '' });
  assert.deepEqual(familyHeading(undefined), { before: '', tag: null, after: '' });
});
