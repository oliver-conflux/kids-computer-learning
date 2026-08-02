// Learn session construction — family selection and session shape.
//
// Three properties carry this mode's design, and all three would fail silently
// in the running game rather than throwing:
//
//   - a picked family NEVER has one word in it. A family of one teaches no
//     pattern, and the screen would look completely normal while doing it.
//   - the item count is CONSTANT across family sizes. A six-item session
//     because the family happened to be small is a shorter session for the
//     pattern with the least support in the window — exactly backwards.
//   - selection is DETERMINISTIC. This module takes no randomness and no clock,
//     so the same model must always yield the same family in the same order.
//
// Models are built here by hand rather than derived from a log. `deriveMastery`
// is a different module's contract; what this one consumes is `bucket`, `taught`
// and `item.word`, and constructing those directly lets a test place a word in
// an exact bucket without reverse-engineering thresholds.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pickLearnFamily, buildLearnSession, isIrregularSet } from '../js/learn.js';
import { patternsFor } from '../js/patterns.js';
// The REAL config, aliased: this file deliberately keeps its own minimal
// CONFIG for the picker tests, and the whole-game simulation needs the
// shipped values (windowSize, learnPasses, build).
import { CONFIG as GAME_CONFIG } from '../js/config.js';
import { SPINE } from '../js/spine.js';
import { spellingSpace } from '../js/space.js';
import { activeWindow } from '../js/frontier.js';
import { deriveMastery } from '../../core/mastery.js';

// --- helpers -----------------------------------------------------------------

const CONFIG = { learnWords: 4, learnPasses: 3 };

/**
 * A mastery model over the given `[word, bucket, taught?]` triples, populated
 * only with the fields learn.js actually reads. Ids follow the plan's fixed
 * `w:${word}` encoding.
 */
function modelOf(entries) {
  const byId = new Map();
  for (const [word, bucket, taught = false] of entries) {
    const id = `w:${word}`;
    byId.set(id, {
      id,
      item: { word, rank: 0, dolch: false },
      bucket,
      attempts: [],
      cleanCount: 0,
      medianCleanMs: null,
      taught,
    });
  }
  return { byId, confusions: new Map() };
}

const windowOf = (entries) => entries.map(([word]) => `w:${word}`);

/** Model and window from one list, so the two can never drift apart. */
function setup(entries) {
  return [modelOf(entries), windowOf(entries)];
}

const wordsOf = (family) => family.words.map((member) => member.word);

// --- a family of one is never taught -----------------------------------------

test('a window with no shared pattern yields no family at all', () => {
  // `cat`, `dog` and `pig` are each the only member of their rime family and
  // share nothing else. There is no family of two here, so there is no session.
  const [model, window] = setup([['cat', 'cold'], ['dog', 'cold'], ['pig', 'cold']]);

  const family = pickLearnFamily(model, window, CONFIG);

  assert.equal(family.pattern, null);
  assert.deepEqual(family.words, []);
});

test('a colder family of one loses to a warmer family of two', () => {
  // `ship` is the coldest word in the window and the only member of both its
  // families. Teaching it alone would teach no pattern, so `-at` wins despite
  // being warmer. This is the rule the whole mode rests on.
  const [model, window] = setup([
    ['ship', 'cold'],
    ['cat', 'warm'],
    ['bat', 'warm'],
  ]);

  const family = pickLearnFamily(model, window, CONFIG);

  assert.equal(family.pattern, '-at');
  assert.deepEqual(wordsOf(family), ['cat', 'bat']);
});

test('every family a session is ever built on has at least two words', () => {
  // Exhaustive over the shapes that can reach this function: any window, any
  // buckets. A single-word family must never come back, whatever the input.
  const shapes = [
    [],
    [['cat', 'cold']],
    [['cat', 'cold'], ['dog', 'cold']],
    [['cat', 'hot'], ['bat', 'hot']],
    [['ship', 'cold'], ['shop', 'cold'], ['cat', 'hot']],
    [['said', 'cold'], ['one', 'cold']],
  ];

  for (const shape of shapes) {
    const [model, window] = setup(shape);
    const family = pickLearnFamily(model, window, CONFIG);
    assert.ok(
      family.words.length === 0 || family.words.length >= 2,
      `${JSON.stringify(shape)} → ${family.words.length} words`,
    );
    if (family.words.length === 0) {
      assert.equal(family.pattern, null, 'an empty family must name no pattern');
    }
  }
});

// --- the item count is constant ----------------------------------------------

test('the item count is the same whatever the family size', () => {
  const target = CONFIG.learnWords * CONFIG.learnPasses;

  const four = buildLearnSession(
    [{ id: 'w:cat' }, { id: 'w:bat' }, { id: 'w:hat' }, { id: 'w:sat' }],
    CONFIG,
  );
  const three = buildLearnSession(
    [{ id: 'w:cat' }, { id: 'w:bat' }, { id: 'w:hat' }],
    CONFIG,
  );
  const two = buildLearnSession([{ id: 'w:cat' }, { id: 'w:bat' }], CONFIG);

  assert.equal(four.length, target);
  assert.equal(three.length, target);
  assert.equal(two.length, target);
});

test('a short family raises its pass count rather than shortening the session', () => {
  const two = buildLearnSession([{ id: 'w:cat' }, { id: 'w:bat' }], CONFIG);
  const reps = two.filter((id) => id === 'w:cat').length;

  assert.equal(reps, 6, 'two words should cycle six times, not three');
  assert.equal(two.filter((id) => id === 'w:bat').length, reps, 'unequal reps');
});

test('every word in the session gets the same number of reps', () => {
  // A cycle cut short mid-pass would give the first word one more rep than the
  // last, which is the one thing a session blocked on a single family must not
  // have.
  for (const size of [2, 3, 4]) {
    const words = ['cat', 'bat', 'hat', 'sat'].slice(0, size).map((word) => ({ id: `w:${word}` }));
    const session = buildLearnSession(words, CONFIG);
    const counts = words.map((member) => session.filter((id) => id === member.id).length);
    assert.equal(new Set(counts).size, 1, `size ${size}: ${counts.join(',')}`);
  }
});

test('an empty family builds an empty session', () => {
  assert.deepEqual(buildLearnSession([], CONFIG), []);
});

// --- the session is cycled, not repeated -------------------------------------

test('the session cycles the family rather than repeating each word in a run', () => {
  // `A B C A B C ...`, not `A A A A B B B B`. Blocked at the SESSION level —
  // one family and nothing outside it — but cycled within, exactly as
  // math-game/js/learn.js does it. Repeating a word back to back lets the kid
  // echo the answer they just gave instead of retrieving it again.
  const words = [{ id: 'w:cat' }, { id: 'w:bat' }, { id: 'w:hat' }];
  const session = buildLearnSession(words, CONFIG);

  assert.deepEqual(session.slice(0, 6), ['w:cat', 'w:bat', 'w:hat', 'w:cat', 'w:bat', 'w:hat']);
  for (let index = 1; index < session.length; index += 1) {
    assert.notEqual(session[index], session[index - 1], `repeat at ${index}`);
  }
});

test('the session is ids, so the loop has something every module agrees on', () => {
  const session = buildLearnSession([{ id: 'w:cat' }, { id: 'w:bat' }], CONFIG);
  for (const id of session) {
    assert.equal(typeof id, 'string');
    assert.ok(id.startsWith('w:'));
  }
});

// --- selection order ---------------------------------------------------------

test('the coldest family wins', () => {
  const [model, window] = setup([
    ['cat', 'hot'], ['bat', 'hot'],
    ['ship', 'cold'], ['shop', 'cold'],
  ]);

  assert.equal(pickLearnFamily(model, window, CONFIG).pattern, 'sh');
});

test('coldness is the family mean, not its count of cold words', () => {
  // `-at` has more cold words in absolute terms, but two thirds of it is
  // already hot — re-teaching it would spend a session on four words that did
  // not need it. `sh` is the family the kid actually has nothing on.
  const [model, window] = setup([
    ['cat', 'cold'], ['bat', 'cold'], ['hat', 'hot'], ['sat', 'hot'],
    ['mat', 'hot'], ['rat', 'hot'],
    ['ship', 'cold'], ['shop', 'cold'],
  ]);

  assert.equal(pickLearnFamily(model, window, CONFIG).pattern, 'sh');
});

test('an untaught family comes before an equally cold taught one', () => {
  // Learn attempts are excluded from mastery evidence, so a family taught
  // yesterday is still entirely cold today. Without the `taught` split, learn
  // mode hands back the identical family every session, forever.
  const [model, window] = setup([
    ['cat', 'cold', true], ['bat', 'cold', true],
    ['ship', 'cold', false], ['shop', 'cold', false],
  ]);

  assert.equal(pickLearnFamily(model, window, CONFIG).pattern, 'sh');
});

test('a cold taught family still comes back, ahead of a warm one', () => {
  const [model, window] = setup([
    ['cat', 'warm'], ['bat', 'warm'],
    ['ship', 'cold', true], ['shop', 'cold', true],
  ]);

  assert.equal(pickLearnFamily(model, window, CONFIG).pattern, 'sh');
});

test('a family bigger than learnWords gives up its warmest members', () => {
  const [model, window] = setup([
    ['cat', 'hot'], ['bat', 'cold'], ['hat', 'cold'],
    ['sat', 'cold'], ['mat', 'cold'], ['rat', 'hot'],
  ]);

  const family = pickLearnFamily(model, window, CONFIG);

  assert.equal(family.pattern, '-at');
  assert.equal(family.words.length, CONFIG.learnWords);
  assert.deepEqual(wordsOf(family), ['bat', 'hat', 'sat', 'mat']);
});

test('the words come back in window order, not in the order they were chosen', () => {
  // Selection is by rank; presentation is spine order, so the family header
  // reads the way a kid would write it out.
  const [model, window] = setup([
    ['cat', 'warm'], ['bat', 'cold'], ['hat', 'warm'], ['sat', 'cold'],
  ]);

  assert.deepEqual(wordsOf(pickLearnFamily(model, window, CONFIG)), ['cat', 'bat', 'hat', 'sat']);
});

test('selection is deterministic', () => {
  const [model, window] = setup([
    ['cat', 'cold'], ['bat', 'cold'], ['ship', 'cold'], ['shop', 'cold'],
  ]);

  const first = pickLearnFamily(model, window, CONFIG);
  for (let run = 0; run < 5; run += 1) {
    const again = pickLearnFamily(model, window, CONFIG);
    assert.equal(again.pattern, first.pattern);
    assert.deepEqual(wordsOf(again), wordsOf(first));
  }
});

// --- irregulars are a set, not a rhyme ---------------------------------------

test('irregulars form a set without pretending to rhyme', () => {
  const [model, window] = setup([
    ['said', 'cold'], ['one', 'cold'], ['friend', 'cold'], ['could', 'cold'],
    ['cat', 'hot'], ['bat', 'hot'],
  ]);

  const family = pickLearnFamily(model, window, CONFIG);

  assert.equal(family.pattern, 'irregular');
  assert.ok(isIrregularSet(family), 'the screen has to be able to tell');
  assert.deepEqual(wordsOf(family), ['said', 'one', 'friend', 'could']);

  // The point of the assertion: these share no route, only the absence of one.
  // Nothing here claims otherwise — no member carries a second, rhyming tag
  // that a screen could mistake for a pattern.
  for (const word of wordsOf(family)) {
    assert.deepEqual(patternsFor(word), ['irregular'], word);
  }
});

test('irregular competes on the same terms as any other tag', () => {
  // It is neither preferred nor penalised. Here the rhyming family is colder,
  // and it wins.
  const [model, window] = setup([
    ['said', 'hot'], ['one', 'hot'], ['friend', 'hot'],
    ['cat', 'cold'], ['bat', 'cold'],
  ]);

  assert.equal(pickLearnFamily(model, window, CONFIG).pattern, '-at');
});

test('an irregular set still builds a full-length session', () => {
  const [model, window] = setup([
    ['said', 'cold'], ['one', 'cold'], ['friend', 'cold'], ['could', 'cold'],
  ]);

  const family = pickLearnFamily(model, window, CONFIG);
  const session = buildLearnSession(family.words, CONFIG);

  assert.equal(session.length, CONFIG.learnWords * CONFIG.learnPasses);
});

// --- robustness and purity ---------------------------------------------------

test('an empty window yields no family', () => {
  const family = pickLearnFamily(modelOf([]), [], CONFIG);
  assert.equal(family.pattern, null);
  assert.deepEqual(family.words, []);
});

test('an id the model does not know is skipped, not thrown on', () => {
  // A stale window from an older spine must not break a session.
  const [model, window] = setup([['cat', 'cold'], ['bat', 'cold']]);
  const family = pickLearnFamily(model, [...window, 'w:notaword'], CONFIG);

  assert.equal(family.pattern, '-at');
  assert.deepEqual(wordsOf(family), ['cat', 'bat']);
});

test('a stats entry with an unrecognised bucket does not win the session', () => {
  // It scores as the least needy thing in the window rather than the most, so a
  // corrupt line can never be the reason a family gets picked.
  const [model, window] = setup([
    ['cat', 'nonsense'], ['bat', 'nonsense'],
    ['ship', 'warm'], ['shop', 'warm'],
  ]);

  assert.equal(pickLearnFamily(model, window, CONFIG).pattern, 'sh');
});

test('neither the model, the window nor the config is mutated', () => {
  const entries = [['cat', 'cold'], ['bat', 'cold'], ['hat', 'cold']];
  const [model, window] = setup(entries);
  const config = { ...CONFIG };
  const windowBefore = [...window];

  const family = pickLearnFamily(model, window, config);
  buildLearnSession(family.words, config);

  assert.deepEqual(window, windowBefore);
  assert.deepEqual(config, CONFIG);
  assert.equal(model.byId.size, entries.length);
  for (const [word, bucket] of entries) {
    assert.equal(model.byId.get(`w:${word}`).bucket, bucket);
  }
});

test('the returned members are fresh objects a caller may not reach through', () => {
  const [model, window] = setup([['cat', 'cold'], ['bat', 'cold']]);

  const first = pickLearnFamily(model, window, CONFIG);
  first.words.length = 0;

  assert.equal(pickLearnFamily(model, window, CONFIG).words.length, 2);
});

// --- the rotation ----------------------------------------------------------
// The bug these pin: `taught` is a boolean, so it demotes a family from
// "cold and untaught" to "cold and taught" exactly ONCE. After every cold family
// in the window has had its lesson they score identically, the tie falls to a
// fixed insertion order, and the same family comes back every session forever.
// Learn attempts are excluded from mastery on purpose, so nothing else moves.
// Found in real play: `in pin win tin` four sessions running.

/** A learn attempt, shaped the way main.js writes them. */
function learnAttempt(word, session) {
  return {
    type: 'attempt', t: `2026-08-02T00:00:00.000Z`, build: GAME_CONFIG.build,
    session, mode: 'learn', word, ms: 3000, stage: 'reveal', wrong: [], revealed: 0,
  };
}

test('pressing learn repeatedly rotates families instead of repeating one', () => {
  const events = [];
  const picked = [];

  for (let session = 1; session <= 12; session += 1) {
    const model = deriveMastery(events, CONFIG, spellingSpace);
    const family = pickLearnFamily(model, activeWindow(SPINE, model, GAME_CONFIG.windowSize), CONFIG);
    picked.push(family.pattern);
    for (let pass = 0; pass < GAME_CONFIG.learnPasses; pass += 1) {
      for (const word of family.words) {
        events.push(learnAttempt(word.word, `s${session}`));
      }
    }
  }

  // The tail is what matters: the stall only began once every family in the
  // window had been taught once, so the first few sessions rotated even before
  // the fix and prove nothing.
  const tail = picked.slice(-8);
  assert.ok(
    new Set(tail).size >= 3,
    `learn mode stalled: last 8 sessions taught ${new Set(tail).size} distinct family/families (${tail.join(' ')})`,
  );
  assert.ok(!tail.every((p) => p === tail[0]), 'the same family came back every session');
});

test('a colder family still beats a less-taught warmer one', () => {
  // The rotation is a TIE-BREAK, not a reordering. Temperature must still lead,
  // or a family the kid has never met would wait behind one she nearly knows.
  const model = {
    byId: new Map([
      // -at: never taught, still cold -> must win
      ['w:at', { id: 'w:at', item: { word: 'at' }, bucket: 'cold', taught: false, taughtCount: 0, attempts: [], cleanCount: 0, medianCleanMs: null }],
      ['w:cat', { id: 'w:cat', item: { word: 'cat' }, bucket: 'cold', taught: false, taughtCount: 0, attempts: [], cleanCount: 0, medianCleanMs: null }],
      // -ig: warm, and taught fewer times than nothing can be
      ['w:big', { id: 'w:big', item: { word: 'big' }, bucket: 'warm', taught: false, taughtCount: 0, attempts: [], cleanCount: 0, medianCleanMs: null }],
      ['w:dig', { id: 'w:dig', item: { word: 'dig' }, bucket: 'warm', taught: false, taughtCount: 0, attempts: [], cleanCount: 0, medianCleanMs: null }],
    ]),
    confusions: new Map(),
  };
  const family = pickLearnFamily(model, ['w:at', 'w:cat', 'w:big', 'w:dig'], CONFIG);
  assert.equal(family.pattern, '-at');
});

test('between equally cold families, the less-taught one wins', () => {
  const stats = (word, taughtCount) => [
    `w:${word}`,
    { id: `w:${word}`, item: { word }, bucket: 'cold', taught: taughtCount > 0, taughtCount,
      attempts: [], cleanCount: 0, medianCleanMs: null },
  ];
  const model = {
    // -at appears FIRST, so insertion order would hand it the tie. It has had
    // three lessons; -ig has had one and must win anyway.
    byId: new Map([stats('at', 3), stats('cat', 3), stats('big', 1), stats('dig', 1)]),
    confusions: new Map(),
  };
  const family = pickLearnFamily(model, ['w:at', 'w:cat', 'w:big', 'w:dig'], CONFIG);
  assert.equal(family.pattern, '-ig', 'insertion order beat the lesson count');
});

test('a model with no taughtCount field at all still picks a family', () => {
  // An older log, or a hand-built model. Missing must read as "never taught"
  // rather than NaN, which would poison the mean and disable the rotation.
  const stats = (word) => [
    `w:${word}`,
    { id: `w:${word}`, item: { word }, bucket: 'cold', taught: false,
      attempts: [], cleanCount: 0, medianCleanMs: null },
  ];
  const model = { byId: new Map([stats('at'), stats('cat')]), confusions: new Map() };
  const family = pickLearnFamily(model, ['w:at', 'w:cat'], CONFIG);
  assert.equal(family.pattern, '-at');
  assert.deepEqual(family.words.map((w) => w.word), ['at', 'cat']);
});
