// typing-game/tests/content.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LESSONS, lessonById } from '../js/curriculum.js';
import { CONTENT, contentFor, itemsFor } from '../js/content.js';

const KINDS = ['drills', 'words', 'sentences'];

test('every content key names a real lesson', () => {
  for (const id of Object.keys(CONTENT)) {
    assert.ok(lessonById(id) !== null, `CONTENT has "${id}", which is not a lesson`);
  }
});

// THE test. Hand-authored constrained content drifts silently; this is what
// catches a rung asking for a key it never taught.
test('every item uses only keys its lesson has taught', () => {
  for (const [id, buckets] of Object.entries(CONTENT)) {
    const lesson = lessonById(id);
    const allowed = new Set(lesson.availableKeys);
    for (const kind of KINDS) {
      for (const item of buckets[kind] ?? []) {
        for (const ch of item) {
          assert.ok(
            allowed.has(ch),
            `${id} ${kind} "${item}" uses ${JSON.stringify(ch)}, not in availableKeys`,
          );
        }
      }
    }
  }
});

test('no item has leading or trailing whitespace, or a double space', () => {
  for (const [id, buckets] of Object.entries(CONTENT)) {
    for (const kind of KINDS) {
      for (const item of buckets[kind] ?? []) {
        assert.equal(item, item.trim(), `${id} ${kind} "${item}" has stray whitespace`);
        assert.ok(!item.includes('  '), `${id} ${kind} "${item}" has a double space`);
        assert.ok(item.length > 0, `${id} ${kind} has an empty item`);
      }
    }
  }
});

// The §2 authoring rule. Capitals arrive at shift-caps and the period at
// bot-x-period, so everything before those is lowercase and unpunctuated. This
// reads wrong to a content author and gets "corrected" by reflex.
test('lessons before shift-caps contain no capitals', () => {
  for (const [id, buckets] of Object.entries(CONTENT)) {
    const lesson = lessonById(id);
    if (lesson.availableKeys.some((k) => k >= 'A' && k <= 'Z')) continue;
    for (const kind of KINDS) {
      for (const item of buckets[kind] ?? []) {
        assert.ok(!/[A-Z]/.test(item), `${id} ${kind} "${item}" capitalises before shift-caps`);
      }
    }
  }
});

test('lessons before bot-x-period end no sentence with a period', () => {
  for (const [id, buckets] of Object.entries(CONTENT)) {
    const lesson = lessonById(id);
    if (lesson.availableKeys.includes('.')) continue;
    for (const item of buckets.sentences ?? []) {
      assert.ok(!item.endsWith('.'), `${id} "${item}" ends with a period it has not taught`);
    }
  }
});

test('a lesson with a sentences mix of 0 supplies no sentences', () => {
  for (const [id, buckets] of Object.entries(CONTENT)) {
    const lesson = lessonById(id);
    if (lesson.mix.sentences === 0) {
      assert.equal((buckets.sentences ?? []).length, 0,
        `${id} has sentences but its mix asks for none`);
    }
  }
});

test('every lesson with content has enough of each kind to fill a round', () => {
  for (const [id, buckets] of Object.entries(CONTENT)) {
    const { mix } = lessonById(id);
    for (const kind of KINDS) {
      assert.ok((buckets[kind] ?? []).length >= mix[kind],
        `${id} needs ${mix[kind]} ${kind} but has ${(buckets[kind] ?? []).length}`);
    }
  }
});

test('no duplicate items within a bucket', () => {
  for (const [id, buckets] of Object.entries(CONTENT)) {
    for (const kind of KINDS) {
      const items = buckets[kind] ?? [];
      assert.equal(new Set(items).size, items.length, `${id} ${kind} has duplicates`);
    }
  }
});

test('contentFor returns empty buckets for an unauthored lesson', () => {
  assert.deepEqual(contentFor('not-a-lesson'), { drills: [], words: [], sentences: [] });
});

test('itemsFor builds a 10-item round in drills-then-words-then-sentences order', () => {
  const rng = () => 0; // deterministic: always take the first candidate
  const items = itemsFor('top-ei', rng);
  const lesson = lessonById('top-ei');
  assert.equal(items.length, 10);

  const { drills, words, sentences } = contentFor('top-ei');
  items.slice(0, lesson.mix.drills)
    .forEach((it) => assert.ok(drills.includes(it), `${it} should be a drill`));
  items.slice(lesson.mix.drills, lesson.mix.drills + lesson.mix.words)
    .forEach((it) => assert.ok(words.includes(it), `${it} should be a word`));
  items.slice(lesson.mix.drills + lesson.mix.words)
    .forEach((it) => assert.ok(sentences.includes(it), `${it} should be a sentence`));
});

test('itemsFor does not repeat an item within one round', () => {
  let n = 0;
  const rng = () => ((n += 0.37) % 1);
  const items = itemsFor('top-ei', rng);
  assert.equal(new Set(items).size, items.length);
});

test('itemsFor is deterministic for a given rng sequence', () => {
  const make = () => { let n = 0; return () => ((n += 0.37) % 1); };
  assert.deepEqual(itemsFor('top-ei', make()), itemsFor('top-ei', make()));
});
