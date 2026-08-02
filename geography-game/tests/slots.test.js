// The name slots, and the multi-word answer.
//
// js/ui/country.js is a DOM module and most of what it does is only verifiable
// by playing the game: the amber pulse painting, the name not moving when a
// letter arrives, the prompt not flickering mid-word. That is deliberate — this
// repo does not test rendering — so this file does not chase coverage. It pins
// the three decisions that are pure functions, that reach the LOG or the SCREEN
// COUNT, and that would fail silently in a running game:
//
//   - the word breaks a kid sees come off the DISPLAY name, while the engine
//     only ever sees letters. This is the one place those two representations
//     have to agree, and disagreeing does not throw — it draws the wrong number
//     of slots and makes a country unanswerable
//   - the ladder has a rung per letter, so a wrong answer buys EXACTLY ONE more
//     and `stage === 'clean'` means exactly zero were given away
//   - `revealedCount` is written onto every attempt event, so a change here is a
//     change to what the log means
//
// No DOM is touched here. The module is importable in node because it does not
// look at `document` until something calls a render.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { slotGroups, revealLadder, revealedCount } from '../js/ui/country.js';
import { COUNTRIES } from '../js/countries.js';
import { SPINE } from '../js/spine.js';

// --- the word breaks ---------------------------------------------------------

test('a one-word name is one group', () => {
  assert.deepEqual(slotGroups('Belize', 6), [6]);
});

test('a space in the name becomes a gap between groups', () => {
  assert.deepEqual(slotGroups('Costa Rica', 9), [5, 4]);
  assert.deepEqual(slotGroups('Papua New Guinea', 14), [5, 3, 6]);
});

test('a hyphen is not a gap — it is not typed, so it gets no slot', () => {
  // `Guinea-Bissau` types as `guineabissau`. Drawing a slot for the hyphen would
  // invite a kid to try to type it, and the space bar is the only separator the
  // grouping is allowed to imply.
  assert.deepEqual(slotGroups('Guinea-Bissau', 12), [12]);
});

test('groups that do not sum to the target fall back to one ungrouped run', () => {
  // The guard that keeps a mismatch ugly rather than unanswerable. Too few slots
  // means a letter the engine is waiting for has nowhere to land, and nothing
  // throws: the country simply can never be finished.
  assert.deepEqual(slotGroups('Costa Rica', 5), [5]);
  assert.deepEqual(slotGroups('Costa Rica', 20), [20]);
});

test('a missing or empty name still yields drawable slots', () => {
  assert.deepEqual(slotGroups(undefined, 6), [6]);
  assert.deepEqual(slotGroups('', 6), [6]);
  assert.deepEqual(slotGroups('   ', 4), [4]);
});

test('every country in the spine groups cleanly against its own target', () => {
  // The property that matters: no shipped country hits the fallback. If one
  // does, its display name and its typed target have drifted apart and a kid is
  // being shown a run of slots with no word break in it.
  for (const country of COUNTRIES) {
    const groups = slotGroups(country.name, country.target.length);
    const words = country.name.split(' ').length;
    assert.equal(
      groups.length,
      words,
      `${country.name} fell back to one group of ${country.target.length}`,
    );
    assert.equal(
      groups.reduce((sum, count) => sum + count, 0),
      country.target.length,
      country.name,
    );
  }
});

test('both prompts for a country show the same slots', () => {
  // The shape item and the flag item ask the same word, so a kid must not meet
  // two different-looking answer rows for Costa Rica depending on which prompt
  // came up.
  const byCode = new Map();
  for (const entry of SPINE) {
    const groups = slotGroups(entry.name, entry.target.length).join(',');
    const seen = byCode.get(entry.code);
    if (seen === undefined) {
      byCode.set(entry.code, groups);
      continue;
    }
    assert.equal(groups, seen, entry.name);
  }
});

// --- the ladder --------------------------------------------------------------

test('the ladder has one rung per letter, on top of clean', () => {
  assert.deepEqual(revealLadder('chad'), ['clean', 'r1', 'r2', 'r3', 'r4']);
  assert.equal(revealLadder('costarica').length, 10);
});

test('the ladder is built from the TARGET, not the display name', () => {
  // Nine rungs plus clean for `Costa Rica`, not ten: the space is never typed
  // and must not buy the kid an extra rung of help.
  assert.equal(revealLadder('costarica').length, 'costarica'.length + 1);
});

test('a ladder is drawable for a junk target rather than throwing', () => {
  assert.deepEqual(revealLadder(''), ['clean']);
  assert.deepEqual(revealLadder(undefined), ['clean']);
});

// --- how many letters are showing --------------------------------------------

test('clean shows nothing', () => {
  const ladder = revealLadder('chad');
  assert.equal(revealedCount({ ladder, stage: 'clean' }), 0);
});

test('the count is the rung index, so one wrong answer shows one letter', () => {
  const ladder = revealLadder('chad');
  assert.equal(revealedCount({ ladder, stage: 'r1' }), 1);
  assert.equal(revealedCount({ ladder, stage: 'r3' }), 3);
  assert.equal(revealedCount({ ladder, stage: 'r4' }), 4);
});

test('a stage that is not on the ladder shows nothing rather than guessing', () => {
  const ladder = revealLadder('chad');
  assert.equal(revealedCount({ ladder, stage: 'reveal' }), 0);
  assert.equal(revealedCount({ ladder: [], stage: 'r2' }), 0);
  assert.equal(revealedCount(null), 0);
  assert.equal(revealedCount({}), 0);
});
