// The pattern rule table — totality, and the rules that lie if written loosely.
//
// One property carries this whole module and is asserted exhaustively rather
// than by example: `patternsFor` NEVER returns an empty array. Learn mode
// assumes a family exists for anything the frontier hands it, so an empty result
// would not throw anywhere — it would quietly produce a session with no words in
// it, on screen, in front of a kid.
//
// The rest of the file is mostly negative assertions, because that is where the
// bugs live. A rime rule written as `/at$/` passes every positive test — `cat`,
// `bat`, `that` all tag correctly — and silently teaches a kid that `eat` and
// `great` rhyme with `cat`. The regexes that keep those out are the thing worth
// pinning down.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { patternsFor, IRREGULAR } from '../js/patterns.js';

// --- the spine ---------------------------------------------------------------

// spine.js is another task's file and may not be on disk yet. Loading it
// dynamically means this suite reports an honest skip in that window rather than
// failing to import, and starts asserting for real the moment the file lands —
// with no edit here. The shape is fixed by the plan's Wave 2 preamble:
// `{word: string, rank: number, dolch: boolean}[]`.
let SPINE = null;
try {
  ({ SPINE } = await import('../js/spine.js'));
} catch {
  SPINE = null;
}

// A stand-in for the spine's shape: the hand-authored CVC opener the spec
// describes, plus the head of Fry. Real coverage today, and it stays useful as a
// fast regression set once the spine exists.
const SAMPLE = [
  'cat', 'bat', 'hat', 'sat', 'mat', 'rat',
  'dog', 'log', 'fog', 'jog',
  'pig', 'big', 'dig', 'wig',
  'sun', 'run', 'fun', 'bun',
  'the', 'of', 'and', 'a', 'to', 'in', 'is', 'you', 'that', 'it', 'he', 'was',
  'for', 'on', 'are', 'as', 'with', 'his', 'they', 'i', 'at', 'be', 'this',
  'have', 'from', 'or', 'one', 'had', 'by', 'word', 'but', 'not', 'what',
  'all', 'were', 'we', 'when', 'your', 'can', 'said', 'there', 'use', 'an',
  'each', 'which', 'she', 'do', 'how', 'their', 'if', 'will', 'up', 'other',
  'about', 'out', 'many', 'then', 'them', 'these', 'so', 'some', 'her',
  'would', 'make', 'like', 'him', 'into', 'time', 'has', 'look', 'two',
  'more', 'write', 'go', 'see', 'number', 'no', 'way', 'could', 'people',
  'my', 'than', 'first', 'water', 'been', 'call', 'who', 'oil', 'its', 'now',
  'find', 'long', 'down', 'day', 'did', 'get', 'come', 'made', 'may', 'part',
  'light', 'night', 'right', 'friend', 'because', 'little', 'table', 'boxes',
  'wishes', 'nation', 'question', 'stop', 'shop', 'ship', 'snake', 'thing',
];

// --- totality ----------------------------------------------------------------

test('patternsFor never returns an empty array', () => {
  for (const word of SAMPLE) {
    const tags = patternsFor(word);
    assert.ok(Array.isArray(tags), `${word}: not an array`);
    assert.ok(tags.length > 0, `${word}: no tags`);
  }
});

test('patternsFor is total over the entire spine', (t) => {
  if (SPINE === null) {
    t.skip('spelling-game/js/spine.js not on disk yet — Task 2.1 owns it');
    return;
  }

  assert.ok(SPINE.length > 0, 'spine is empty');
  for (const entry of SPINE) {
    const tags = patternsFor(entry.word);
    assert.ok(tags.length > 0, `${entry.word}: no tags`);
    for (const tag of tags) {
      assert.equal(typeof tag, 'string');
      assert.ok(tag.length > 0, `${entry.word}: empty tag`);
    }
  }
});

test('a word matching no rule falls back to irregular', () => {
  // No rime, no team, no r-controlled vowel, no affix, no digraph, no blend.
  assert.deepEqual(patternsFor('zzyqx'), [IRREGULAR]);
});

test('garbage in is irregular, not a throw', () => {
  // This table runs over log lines as well as over the spine, and a corrupt line
  // must never break a session.
  assert.deepEqual(patternsFor(''), [IRREGULAR]);
  assert.deepEqual(patternsFor('   '), [IRREGULAR]);
  assert.deepEqual(patternsFor(null), [IRREGULAR]);
  assert.deepEqual(patternsFor(undefined), [IRREGULAR]);
  assert.deepEqual(patternsFor(42), [IRREGULAR]);
  assert.deepEqual(patternsFor({}), [IRREGULAR]);
});

// --- the named cases from the spec -------------------------------------------

test('the known irregulars tag as irregular, and only that', () => {
  for (const word of ['said', 'one', 'friend', 'could']) {
    assert.deepEqual(patternsFor(word), [IRREGULAR], word);
  }
});

test('light, night and right share a tag', () => {
  const light = patternsFor('light');
  const night = patternsFor('night');
  const right = patternsFor('right');

  const shared = light.filter((tag) => night.includes(tag) && right.includes(tag));
  assert.ok(shared.length > 0, 'no shared tag');
  assert.ok(shared.includes('-ight'), `expected -ight, got ${shared.join(' ')}`);
});

test('a word carries more than one tag when more than one is true', () => {
  // `snake` is an -ake word AND a silent-e word AND starts with a blend. All
  // three are true and each is a different thing to notice about it.
  const tags = patternsFor('snake');
  assert.ok(tags.includes('-ake'));
  assert.ok(tags.includes('silent-e'));
  assert.ok(tags.includes('blend-start'));
});

// --- the rules that lie if written loosely -----------------------------------

test('a rime is a syllable, not a suffix', () => {
  // `/at$/` would catch every one of these. None of them rhymes with `cat`.
  for (const word of ['eat', 'heat', 'seat', 'meat', 'great']) {
    assert.ok(!patternsFor(word).includes('-at'), `${word} tagged -at`);
  }
  for (const word of ['cat', 'that', 'flat', 'at']) {
    assert.ok(patternsFor(word).includes('-at'), `${word} not tagged -at`);
  }
});

test('an r-controlled vowel is one vowel, not two', () => {
  // In every one of these the r attaches to a vowel TEAM, and the sound is
  // nothing like `car`, `her` or `for`.
  assert.ok(!patternsFor('year').includes('ar'));
  assert.ok(!patternsFor('hear').includes('ar'));
  assert.ok(!patternsFor('deer').includes('er'));
  assert.ok(!patternsFor('poor').includes('or'));
  assert.ok(!patternsFor('our').includes('ur'));

  assert.ok(patternsFor('car').includes('ar'));
  assert.ok(patternsFor('her').includes('er'));
  assert.ok(patternsFor('first').includes('ir'));
  assert.ok(patternsFor('for').includes('or'));
  assert.ok(patternsFor('turn').includes('ur'));
});

test('silent-e and consonant-le are different patterns', () => {
  for (const word of ['make', 'time', 'mile', 'while']) {
    assert.ok(patternsFor(word).includes('silent-e'), `${word} not silent-e`);
    assert.ok(!patternsFor(word).includes('-le'), `${word} tagged -le`);
  }
  for (const word of ['little', 'table', 'uncle']) {
    assert.ok(patternsFor(word).includes('-le'), `${word} not -le`);
    assert.ok(!patternsFor(word).includes('silent-e'), `${word} tagged silent-e`);
  }
});

test('the -ed suffix and the -ed rime cannot both fire', () => {
  for (const word of ['called', 'asked', 'looked', 'used']) {
    const tags = patternsFor(word);
    assert.ok(tags.includes('-ed'), `${word} not tagged -ed`);
  }
  // `bed` and `sled` are the RIME, and both come out under the same tag by
  // design — the two regexes are mutually exclusive, so a word is never
  // double-tagged.
  for (const word of ['bed', 'red', 'sled', 'called']) {
    const ed = patternsFor(word).filter((tag) => tag === '-ed');
    assert.equal(ed.length, 1, `${word}: ${ed.length} -ed tags`);
  }
  // `need` and `feed` are vowel teams, not past tenses.
  assert.ok(!patternsFor('need').includes('-ed'));
  assert.ok(!patternsFor('feed').includes('-ed'));
});

test('plural -s does not fire on words that merely end in s', () => {
  for (const word of ['this', 'was', 'his', 'has', 'yes', 'is', 'as', 'us', 'class']) {
    assert.ok(!patternsFor(word).includes('-s'), `${word} tagged -s`);
  }
  // `words` is deliberately absent: `word` is a known irregular, so `words` is
  // one too and carries no other tag. See the inflection test below.
  for (const word of ['dogs', 'cats', 'books', 'things']) {
    assert.ok(patternsFor(word).includes('-s'), `${word} not tagged -s`);
  }
});

test('an inflected irregular is still irregular', () => {
  // `word` is irregular, so `words` is too. Without the stem check `words`
  // picks up the `or` tag and gets taught alongside `for` and `corn`.
  assert.deepEqual(patternsFor('words'), [IRREGULAR]);
  assert.deepEqual(patternsFor('eyes'), [IRREGULAR]);
  assert.deepEqual(patternsFor('wanted'), [IRREGULAR]);
  assert.deepEqual(patternsFor('walking'), [IRREGULAR]);

  // But a stem that is not itself irregular changes nothing.
  assert.ok(patternsFor('looking').includes('-ing'));
  assert.ok(patternsFor('beds').includes('-s'));
});

// --- purity ------------------------------------------------------------------

test('patternsFor is deterministic and hands back a fresh array', () => {
  const first = patternsFor('snake');
  const second = patternsFor('snake');
  assert.deepEqual(first, second);
  assert.notEqual(first, second, 'same array handed to two callers');

  first.length = 0;
  assert.ok(patternsFor('snake').length > 0, 'a caller mutated the rule table');
});

test('case and surrounding space do not change the answer', () => {
  assert.deepEqual(patternsFor('CAT'), patternsFor('cat'));
  assert.deepEqual(patternsFor(' cat '), patternsFor('cat'));
});
