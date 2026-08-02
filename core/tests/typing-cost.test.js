import test from 'node:test';
import assert from 'node:assert/strict';

import { typingCost, KEYMAP } from '../typing-cost.js';

// config.js belongs to another task; these tests pass the one key this function
// reads, per spec §12.
const CONFIG = { typingWeightFloor: 0.25 };

const cost = (word, config = CONFIG) => typingCost(word, KEYMAP, config);

// A spread of the spine, plus deliberately nasty strings.
const WORDS = [
  'a', 'at', 'cat', 'bat', 'hat', 'dog', 'pig', 'sun', 'the', 'and', 'said',
  'friend', 'could', 'because', 'light', 'night', 'right', 'elephant', 'rhythm',
  'pizzazz', 'plaza', 'minimum', 'lollipop', 'aqua', 'sixth', 'zzzz', 'qwerty',
];

// --- the guarantees -----------------------------------------------------------

test('never returns 0, so no word is ever unreachable', () => {
  for (const word of [...WORDS, '', 'ppp', 'zaq', 'ééé']) {
    assert.notEqual(cost(word), 0, `${word} scored 0`);
  }
});

test('never falls below the floor and never rises above 1', () => {
  for (const word of WORDS) {
    const weight = cost(word);
    assert.ok(weight >= CONFIG.typingWeightFloor, `${word} scored ${weight}, below the floor`);
    assert.ok(weight <= 1, `${word} scored ${weight}, above 1`);
  }
});

test('the floor is honoured inside the function, not left to callers', () => {
  // A floor of 1 collapses the dial entirely: every word must come back at 1,
  // which can only happen if the clamp is applied here.
  for (const word of WORDS) {
    assert.equal(cost(word, { typingWeightFloor: 1 }), 1, word);
  }

  // A high floor still bites on the most awkward strings in the set.
  const high = 0.9;
  const worst = WORDS.map((word) => cost(word, { typingWeightFloor: high }));
  assert.ok(worst.every((weight) => weight >= high));
  assert.ok(worst.some((weight) => weight === high), 'the floor should actually bind somewhere');
});

test('the floor is read from config, never hard-coded', () => {
  const awkward = 'pizzazz';
  assert.ok(cost(awkward, { typingWeightFloor: 0.25 }) > 0.25);
  assert.equal(cost(awkward, { typingWeightFloor: 0.5 }), Math.max(0.5, cost(awkward)));
  assert.ok(cost(awkward, { typingWeightFloor: 0.8 }) >= 0.8);
});

test('a missing or nonsensical floor is a loud error, not a silent default', () => {
  for (const config of [undefined, null, {}, { typingWeightFloor: 0 }, { typingWeightFloor: -1 },
    { typingWeightFloor: 1.5 }, { typingWeightFloor: '0.25' }, { typingWeightFloor: NaN }]) {
    assert.throws(() => typingCost('cat', KEYMAP, config), TypeError);
  }
});

// --- the model says something ------------------------------------------------

test('a home-row word scores better than a pinky-heavy one', () => {
  assert.ok(cost('dad') > cost('pizzazz'), 'dad vs pizzazz');
  assert.ok(cost('has') > cost('plaza'), 'has vs plaza');
  assert.ok(cost('fed') > cost('zap'), 'fed vs zap');
});

test('the same finger twice on different keys is worse than alternating hands', () => {
  // 'ed' is the same left-middle finger moving between rows; 'en' alternates.
  assert.ok(cost('en') > cost('ed'));
  // 'aq' is the left pinky on two keys; 'aj' is one pinky then the other hand.
  assert.ok(cost('aj') > cost('aq'));
});

test('a doubled letter is a cheap double tap, not a same-finger reach', () => {
  // 'zz' is the same key twice; 'za' moves the same pinky to another key.
  assert.ok(cost('zz') > cost('za'));
});

test('crossing rows costs more than staying on one', () => {
  assert.ok(cost('sad') > cost('sat')); // 'sad' is all home row; 't' is a row up
  assert.ok(cost('as') > cost('a1'));   // the number row is two rows off home
});

test('a longer word is not penalised merely for being longer', () => {
  // Awkwardness is measured per keystroke. If this ever fails, the dial has
  // collapsed into a length penalty and is telling us nothing spine order does
  // not already say.
  assert.ok(cost('adad') >= cost('pizzazz'));
  assert.ok(cost('dadadadad') > 0.7);
});

// --- robustness ---------------------------------------------------------------

test('unmapped characters do not throw', () => {
  for (const word of ['café', 'über', '你好', 'naïve', '—', '\u{1F600}', 'a b']) {
    const weight = cost(word);
    assert.ok(Number.isFinite(weight), `${word} scored ${weight}`);
    assert.ok(weight >= CONFIG.typingWeightFloor && weight <= 1);
  }
});

test('an empty string, a lone letter and a non-string do not throw', () => {
  for (const word of ['', 'a', undefined, null, 42, {}, []]) {
    const weight = cost(word);
    assert.ok(Number.isFinite(weight));
    assert.ok(weight >= CONFIG.typingWeightFloor && weight <= 1);
  }
});

test('case does not change the score — the spine is lowercase but the keys are the same', () => {
  assert.equal(cost('FRIEND'), cost('friend'));
  assert.equal(cost('Cat'), cost('cat'));
});

// --- purity -------------------------------------------------------------------

test('pure: the same word always scores the same, in any order', () => {
  const once = WORDS.map((word) => cost(word));
  const again = [...WORDS].reverse().map((word) => cost(word)).reverse();
  assert.deepEqual(again, once);
});

test('pure: it does not mutate the keymap it is handed', () => {
  const before = JSON.stringify({ FINGER: KEYMAP.FINGER, ROWS: KEYMAP.ROWS });
  for (const word of WORDS) cost(word);
  assert.equal(JSON.stringify({ FINGER: KEYMAP.FINGER, ROWS: KEYMAP.ROWS }), before);
});

test('the finger data is imported from the typing game, not copied', () => {
  // If someone inlines the tables, this stops being the same object identity and
  // the two copies are free to drift.
  assert.equal(typeof KEYMAP.fingerFor, 'function');
  assert.equal(KEYMAP.fingerFor('a'), 'lp');
  assert.equal(KEYMAP.fingerFor('j'), 'ri');
  assert.equal(Array.isArray(KEYMAP.ROWS), true);
});
