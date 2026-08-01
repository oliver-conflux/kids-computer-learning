// typing-game/tests/curriculum.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LESSONS, lessonById, lessonsForTrack, nextLesson } from '../js/curriculum.js';

test('there are 14 letter rungs and 5 number rungs', () => {
  assert.equal(lessonsForTrack('letters').length, 14);
  assert.equal(lessonsForTrack('numbers').length, 5);
  assert.equal(LESSONS.length, 19);
});

test('lesson ids are unique', () => {
  const ids = new Set(LESSONS.map((l) => l.id));
  assert.equal(ids.size, LESSONS.length);
});

test('every lesson has a complete shape', () => {
  for (const l of LESSONS) {
    assert.equal(typeof l.id, 'string', l.id);
    assert.ok(l.track === 'letters' || l.track === 'numbers', l.id);
    assert.ok(l.title.length > 0, l.id);
    assert.ok(Array.isArray(l.newKeys), l.id);
    assert.ok(Array.isArray(l.availableKeys), l.id);
    assert.ok(l.hint.length > 0, `${l.id} needs a hint — it is read aloud to a kid`);
    assert.equal(l.mix.drills + l.mix.words + l.mix.sentences, 10, `${l.id} mix must total 10`);
  }
});

test('availableKeys is cumulative within a track and never shrinks', () => {
  for (const track of ['letters', 'numbers']) {
    const lessons = lessonsForTrack(track);
    lessons.forEach((lesson, i) => {
      if (i === 0) return;
      const prev = new Set(lessons[i - 1].availableKeys);
      for (const k of prev) {
        assert.ok(lesson.availableKeys.includes(k), `${lesson.id} dropped ${JSON.stringify(k)}`);
      }
    });
  }
});

test("each lesson's new keys appear in its own availableKeys", () => {
  for (const l of LESSONS) {
    for (const k of l.newKeys) {
      if (k === 'Shift') continue;
      assert.ok(l.availableKeys.includes(k), `${l.id} teaches ${k} but does not list it`);
    }
  }
});

test("each lesson's new keys were NOT available in the previous rung", () => {
  for (const track of ['letters', 'numbers']) {
    const lessons = lessonsForTrack(track);
    lessons.forEach((lesson, i) => {
      if (i === 0) return;
      const prev = new Set(lessons[i - 1].availableKeys);
      for (const k of lesson.newKeys) {
        if (k === 'Shift') continue;
        assert.ok(!prev.has(k), `${lesson.id} re-teaches ${k}`);
      }
    });
  }
});

test('the tracks are independent: numbers inherit no letters, letters no digits', () => {
  for (const l of lessonsForTrack('numbers')) {
    for (const k of l.availableKeys) {
      assert.ok(!/[a-z]/.test(k), `${l.id} leaked the letter ${k}`);
    }
  }
  for (const l of lessonsForTrack('letters')) {
    for (const k of l.availableKeys) {
      assert.ok(!/[0-9]/.test(k), `${l.id} leaked the digit ${k}`);
    }
  }
});

test('home-base introduces space with the home row', () => {
  const home = lessonById('home-base');
  assert.deepEqual([...home.newKeys].sort(), [' ', ';', 'a', 'd', 'f', 'j', 'k', 'l', 's']);
  assert.ok(home.availableKeys.includes(' '));
  assert.equal(home.mix.sentences, 0, 'asdfjkl; cannot make a sentence');
});

test('the letter ladder ends with punctuation, and ! is NOT there', () => {
  const punct = lessonById('punctuation');
  assert.equal(punct.track, 'letters');
  assert.ok(punct.availableKeys.includes('?'));
  assert.ok(punct.availableKeys.includes(':'));
  assert.ok(!punct.availableKeys.includes('!'), '! is shift-1 and belongs to the number track');
});

// The 'Shift' sentinel unlocks the uppercase form of every letter taught so
// far. This went unnoticed at first: buildTrack skipped the sentinel without
// expanding it, so the one rung whose entire purpose is capitals had no
// capitals available and the content validator rejected every one of them.
test('shift-caps unlocks capitals for every letter taught so far', () => {
  const sc = lessonById('shift-caps');
  const caps = sc.availableKeys.filter((k) => k >= 'A' && k <= 'Z');
  assert.equal(caps.length, 26, 'all 26 letters are taught by rung 12');
  for (const ch of 'ABZQP') {
    assert.ok(sc.availableKeys.includes(ch), `shift-caps must allow ${ch}`);
  }
});

test('capitals carry forward to punctuation, the rung after shift-caps', () => {
  const p = lessonById('punctuation');
  assert.equal(p.availableKeys.filter((k) => k >= 'A' && k <= 'Z').length, 26);
});

test('no rung before shift-caps has any capital available', () => {
  for (const lesson of lessonsForTrack('letters')) {
    if (lesson.id === 'shift-caps') break;
    const caps = lesson.availableKeys.filter((k) => k >= 'A' && k <= 'Z');
    assert.deepEqual(caps, [], `${lesson.id} leaked capitals before shift taught them`);
  }
});

test('the number track never gains capitals — it teaches no letters', () => {
  for (const lesson of lessonsForTrack('numbers')) {
    const caps = lesson.availableKeys.filter((k) => k >= 'A' && k <= 'Z');
    assert.deepEqual(caps, [], lesson.id);
  }
});

test('the number track teaches ! at num-10, with - and =', () => {
  const last = lessonById('num-10');
  assert.ok(last.availableKeys.includes('!'));
  assert.ok(last.availableKeys.includes('-'));
  assert.ok(last.availableKeys.includes('='));
});

test('the number track follows middles, index, stretch, rings, pinkies', () => {
  assert.deepEqual(
    lessonsForTrack('numbers').map((l) => l.id),
    ['num-38', 'num-47', 'num-56', 'num-29', 'num-10'],
  );
});

test('no number lesson has sentences — digits alone cannot make one', () => {
  for (const l of lessonsForTrack('numbers')) {
    assert.equal(l.mix.sentences, 0, l.id);
  }
});

test('nextLesson walks a track and stops at its end', () => {
  assert.equal(nextLesson('home-base').id, 'home-stretch');
  assert.equal(nextLesson('num-38').id, 'num-47');
  assert.equal(nextLesson('punctuation'), null, 'letters end here');
  assert.equal(nextLesson('num-10'), null, 'numbers end here');
  assert.equal(nextLesson('nope'), null);
});

test('lessonById returns null for an unknown id rather than throwing', () => {
  assert.equal(lessonById('does-not-exist'), null);
});
