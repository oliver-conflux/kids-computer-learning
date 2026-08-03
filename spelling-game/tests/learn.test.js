// Learn session construction — family selection and session shape.
//
// Four properties carry this mode's design, and all four would fail silently
// in the running game rather than throwing:
//
//   - a picked family NEVER has one word in it. A family of one teaches no
//     pattern, and the screen would look completely normal while doing it.
//   - the TARGET comes from the drill set and the SIBLINGS come from the whole
//     spine, marked-off words included. A lesson built only from words she is
//     failing has no scaffolding in it, and it looks identical on screen.
//   - the item count is CONSTANT across family sizes. A six-item session
//     because the family happened to be small is a shorter session for the
//     pattern with the fewest words to teach it with — exactly backwards.
//   - selection is DETERMINISTIC. This module takes no randomness and no clock,
//     so the same model must always yield the same family in the same order.
//
// Models are built here by hand rather than derived from a log. `deriveMastery`
// is a different module's contract; what this one consumes is `bucket`, `taught`
// and `item.word`, and constructing those directly lets a test place a word in
// an exact bucket without reverse-engineering thresholds.
//
// MOST TESTS BELOW PASS THE SAME WORD LIST AS BOTH DRILL SET AND SPINE. That is
// the shape the old window tests had, and keeping it is what lets them go on
// pinning exactly what they pinned: with no words outside the drill set, there
// are no siblings to find and family selection is the question. The sibling
// behaviour is exercised separately, against the real spine, further down.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pickLearnFamily, buildLearnSession, isIrregularSet } from '../js/learn.js';
import { patternsFor } from '../js/patterns.js';
// The REAL config, aliased: this file deliberately keeps its own minimal
// CONFIG for the picker tests, and the whole-game simulation needs the
// shipped values (drillCap, probeMargin, learnPasses, build).
import { CONFIG as GAME_CONFIG } from '../js/config.js';
import { SPINE } from '../js/spine.js';
import { spellingSpace } from '../js/space.js';
import { derivePlacement } from '../js/placement.js';
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

const drillOf = (entries) => entries.map(([word]) => `w:${word}`);
const spineOf = (entries) => entries.map(([word]) => ({ word, rank: 0, dolch: false }));

/**
 * Model, drill set and spine from one list, so the three can never drift apart.
 * Every word is in the drill set here — she has met all of them and finished
 * with none — so nothing in these fixtures is available as a sibling.
 */
function setup(entries) {
  return [modelOf(entries), drillOf(entries), spineOf(entries)];
}

/** A spine from bare words, for tests that care about siblings rather than stats. */
const spineWords = (words) => words.map((word) => ({ word, rank: 0, dolch: false }));

/**
 * Drill attempts, shaped the way main.js writes them, for the tests that build
 * their drill set through `derivePlacement` rather than by hand. `index` only
 * spaces the timestamps out: mastery orders events by `t` and a heap of
 * identical ones would make the order an accident of file position.
 */
const drillAttempt = (word, index, fields) => ({
  type: 'attempt', t: `2026-08-01T00:00:${String(index).padStart(2, '0')}.000Z`,
  build: GAME_CONFIG.build, session: 's0', mode: 'drill', word, ms: 3000, ...fields,
});

/** A miss — the only route into the drill set. */
const drillMiss = (word, index) =>
  drillAttempt(word, index, { stage: 'reveal', wrong: ['xxx'], revealed: 1 });

/** Right first time, before any hint: the route that marks a word off for good. */
const drillClean = (word, index) =>
  drillAttempt(word, index, { stage: 'clean', wrong: [], revealed: 0 });

const wordsOf = (family) => family.words.map((member) => member.word);

// --- a family of one is never taught -----------------------------------------

test('a drill set with no shared pattern yields no family at all', () => {
  // `cat`, `dog` and `pig` are each the only member of their rime family and
  // share nothing else. There is no family of two here, so there is no session.
  const [model, drill, spine] = setup([['cat', 'cold'], ['dog', 'cold'], ['pig', 'cold']]);

  const family = pickLearnFamily(model, drill, spine, CONFIG);

  assert.equal(family.pattern, null);
  assert.deepEqual(family.words, []);
});

test('a colder family of one loses to a warmer family of two', () => {
  // `ship` is the coldest word in the drill set and the only member of both its
  // families. Teaching it alone would teach no pattern, so `-at` wins despite
  // being warmer. This is the rule the whole mode rests on.
  const [model, drill, spine] = setup([
    ['ship', 'cold'],
    ['cat', 'warm'],
    ['bat', 'warm'],
  ]);

  const family = pickLearnFamily(model, drill, spine, CONFIG);

  assert.equal(family.pattern, '-at');
  assert.deepEqual(wordsOf(family), ['cat', 'bat']);
});

test('every family a session is ever built on has at least two words', () => {
  // Exhaustive over the shapes that can reach this function: any drill set, any
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
    const [model, drill, spine] = setup(shape);
    const family = pickLearnFamily(model, drill, spine, CONFIG);
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
  const [model, drill, spine] = setup([
    ['cat', 'hot'], ['bat', 'hot'],
    ['ship', 'cold'], ['shop', 'cold'],
  ]);

  assert.equal(pickLearnFamily(model, drill, spine, CONFIG).pattern, 'sh');
});

test('coldness is the family mean, not its count of cold words', () => {
  // `-at` has more cold words in absolute terms, but two thirds of it is
  // already hot — re-teaching it would spend a session on four words that did
  // not need it. `sh` is the family the kid actually has nothing on.
  const [model, drill, spine] = setup([
    ['cat', 'cold'], ['bat', 'cold'], ['hat', 'hot'], ['sat', 'hot'],
    ['mat', 'hot'], ['rat', 'hot'],
    ['ship', 'cold'], ['shop', 'cold'],
  ]);

  assert.equal(pickLearnFamily(model, drill, spine, CONFIG).pattern, 'sh');
});

test('an untaught family comes before an equally cold taught one', () => {
  // Learn attempts are excluded from mastery evidence, so a family taught
  // yesterday is still entirely cold today. Without the `taught` split, learn
  // mode hands back the identical family every session, forever.
  const [model, drill, spine] = setup([
    ['cat', 'cold', true], ['bat', 'cold', true],
    ['ship', 'cold', false], ['shop', 'cold', false],
  ]);

  assert.equal(pickLearnFamily(model, drill, spine, CONFIG).pattern, 'sh');
});

test('a cold taught family still comes back, ahead of a warm one', () => {
  const [model, drill, spine] = setup([
    ['cat', 'warm'], ['bat', 'warm'],
    ['ship', 'cold', true], ['shop', 'cold', true],
  ]);

  assert.equal(pickLearnFamily(model, drill, spine, CONFIG).pattern, 'sh');
});

test('a family bigger than learnWords gives up its warmest members', () => {
  const [model, drill, spine] = setup([
    ['cat', 'hot'], ['bat', 'cold'], ['hat', 'cold'],
    ['sat', 'cold'], ['mat', 'cold'], ['rat', 'hot'],
  ]);

  const family = pickLearnFamily(model, drill, spine, CONFIG);

  assert.equal(family.pattern, '-at');
  assert.equal(family.words.length, CONFIG.learnWords);
  assert.deepEqual(wordsOf(family), ['bat', 'hat', 'sat', 'mat']);
});

test('the words come back in spine order, not in the order they were chosen', () => {
  // Selection is by rank; presentation is spine order, so the family header
  // reads the way a kid would write it out.
  const [model, drill, spine] = setup([
    ['cat', 'warm'], ['bat', 'cold'], ['hat', 'warm'], ['sat', 'cold'],
  ]);

  assert.deepEqual(wordsOf(pickLearnFamily(model, drill, spine, CONFIG)), ['cat', 'bat', 'hat', 'sat']);
});

test('selection is deterministic', () => {
  const [model, drill, spine] = setup([
    ['cat', 'cold'], ['bat', 'cold'], ['ship', 'cold'], ['shop', 'cold'],
  ]);

  const first = pickLearnFamily(model, drill, spine, CONFIG);
  for (let run = 0; run < 5; run += 1) {
    const again = pickLearnFamily(model, drill, spine, CONFIG);
    assert.equal(again.pattern, first.pattern);
    assert.deepEqual(wordsOf(again), wordsOf(first));
  }
});

// --- irregulars are a set, not a rhyme ---------------------------------------

test('irregulars form a set without pretending to rhyme', () => {
  const [model, drill, spine] = setup([
    ['said', 'cold'], ['one', 'cold'], ['friend', 'cold'], ['could', 'cold'],
    ['cat', 'hot'], ['bat', 'hot'],
  ]);

  const family = pickLearnFamily(model, drill, spine, CONFIG);

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
  const [model, drill, spine] = setup([
    ['said', 'hot'], ['one', 'hot'], ['friend', 'hot'],
    ['cat', 'cold'], ['bat', 'cold'],
  ]);

  assert.equal(pickLearnFamily(model, drill, spine, CONFIG).pattern, '-at');
});

test('an irregular set still builds a full-length session', () => {
  const [model, drill, spine] = setup([
    ['said', 'cold'], ['one', 'cold'], ['friend', 'cold'], ['could', 'cold'],
  ]);

  const family = pickLearnFamily(model, drill, spine, CONFIG);
  const session = buildLearnSession(family.words, CONFIG);

  assert.equal(session.length, CONFIG.learnWords * CONFIG.learnPasses);
});

// --- the target and the siblings ---------------------------------------------
// The split this mode rests on: the TARGET is a word from the drill set — one
// she has met and missed — and the SIBLINGS come from the whole spine, marked-off
// words included. Measured before it was built (spec §7): the spine carries 34
// rime tags over 232 words, 56 of them in the opener, so a 20-word set of any
// shape holds four words of one rime about 1–2% of the time. Drawing siblings
// from the spine makes a rime lesson available whenever the target has a rime.

test('a target with a rime tag is taught alongside its whole rime family', () => {
  const model = modelOf([['hop', 'cold'], ['mop', 'hot'], ['top', 'hot'], ['stop', 'hot']]);
  const family = pickLearnFamily(model, ['w:hop'], SPINE, CONFIG);

  assert.equal(family.pattern, '-op');
  assert.deepEqual(wordsOf(family), ['hop', 'mop', 'top', 'stop']);
  assert.equal(
    buildLearnSession(family.words, CONFIG).length,
    CONFIG.learnWords * CONFIG.learnPasses,
    'a lesson built from one stuck word is still a full session',
  );
});

test('the siblings include words she is already finished with', () => {
  // The whole point, and the thing that looks like a bug from outside: `mop`,
  // `top` and `stop` she got right first time and will never be asked again in
  // drill. They are in the lesson anyway, because a word she owns is the analogy
  // that cracks the one she does not, and a lesson assembled only out of words
  // she is failing has nothing in it to reason FROM.
  //
  // Driven through `derivePlacement` rather than a hand-built drill set so this
  // pins the real seam: what main.js hands the picker is exactly this.
  const events = [
    drillMiss('hop', 0),
    drillClean('mop', 1),
    drillClean('top', 2),
    drillClean('stop', 3),
  ];
  const model = deriveMastery(events, GAME_CONFIG, spellingSpace);
  const placement = derivePlacement(model, SPINE, GAME_CONFIG, () => false);

  assert.deepEqual(placement.drill, ['w:hop'], 'only the missed word is drilled');
  for (const word of ['mop', 'top', 'stop']) {
    assert.ok(placement.marked.has(`w:${word}`), `${word} should be finished with`);
  }

  const family = pickLearnFamily(model, placement.drill, SPINE, GAME_CONFIG);

  assert.equal(family.pattern, '-op');
  assert.deepEqual(wordsOf(family), ['hop', 'mop', 'top', 'stop']);
});

test('a target whose only tag is irregular still gets a runnable lesson', () => {
  // There is no route to teach `said` and this mode does not pretend otherwise —
  // it hands the tag over as a SET and the screen says so. Splitting that
  // 232-word bucket into Dolch sight words and genuine irregulars is a content
  // question (next-steps item 4), not this module's.
  const model = modelOf([['said', 'cold']]);
  const family = pickLearnFamily(model, ['w:said'], SPINE, CONFIG);

  assert.equal(family.pattern, 'irregular');
  assert.ok(isIrregularSet(family), 'the screen has to be able to tell');
  assert.equal(family.words.length, CONFIG.learnWords);
  assert.ok(wordsOf(family).includes('said'), 'the word she is stuck on must be in it');
  assert.equal(
    buildLearnSession(family.words, CONFIG).length,
    CONFIG.learnWords * CONFIG.learnPasses,
  );
});

test('a family the spine cannot fill out still runs a full-length session', () => {
  // Two words is all `-at` has here, and `learnPasses` is a FLOOR: the session
  // cycles them six times rather than three. A kid must not get a short session
  // because the pattern she is stuck on has few words to teach it with — that is
  // exactly backwards.
  const model = modelOf([['cat', 'cold'], ['bat', 'hot']]);
  const family = pickLearnFamily(model, ['w:cat'], spineWords(['cat', 'bat']), CONFIG);

  assert.deepEqual(wordsOf(family), ['cat', 'bat']);
  assert.equal(
    buildLearnSession(family.words, CONFIG).length,
    CONFIG.learnWords * CONFIG.learnPasses,
  );
});

test('siblings fill the lesson out but do not choose it', () => {
  // THE FAILURE THIS PINS, and it is silent: score the expanded family and the
  // pick stops being about her. Every word she has never met is cold and
  // untaught — the neediest thing the rank table knows — so a tag with a long
  // tail of unmet words in the spine scores near zero and wins every session,
  // while the word she is actually stuck on stops mattering.
  //
  // Here `ship` is cold and its only sibling is hot, so `sh` is the right answer
  // on the drill members alone (0 against `-at`'s warm 2). Counting siblings
  // inverts it: `sh` would score (0+3)/2 = 1.5 and `-at` (2+0+0+0)/4 = 0.5.
  const model = modelOf([
    ['ship', 'cold'], ['shop', 'hot'],
    ['cat', 'warm'], ['bat', 'cold'], ['hat', 'cold'], ['sat', 'cold'],
  ]);
  const spine = spineWords(['ship', 'shop', 'cat', 'bat', 'hat', 'sat']);

  const family = pickLearnFamily(model, ['w:ship', 'w:cat'], spine, CONFIG);

  assert.equal(family.pattern, 'sh', 'the sibling count decided the lesson');
  assert.deepEqual(wordsOf(family), ['ship', 'shop']);
});

test('a sibling never takes a slot from a word she is stuck on', () => {
  // Two drill words in one family and four slots: both must be taught. Ordering
  // siblings by spine position alone would hand the first two slots to `cat` and
  // `bat` — words she has already proved — and leave one of the two she cannot
  // spell waiting for another session.
  const model = modelOf([
    ['cat', 'hot'], ['bat', 'hot'], ['hat', 'hot'],
    ['sat', 'hot'], ['mat', 'cold'], ['rat', 'cold'],
  ]);
  const spine = spineOf([['cat'], ['bat'], ['hat'], ['sat'], ['mat'], ['rat']]);

  const family = pickLearnFamily(model, ['w:mat', 'w:rat'], spine, CONFIG);

  assert.equal(family.pattern, '-at');
  assert.equal(family.words.length, CONFIG.learnWords);
  for (const word of ['mat', 'rat']) {
    assert.ok(wordsOf(family).includes(word), `${word} was displaced by a sibling`);
  }
  // Presentation stays spine order, so the family reads the way a kid would
  // write it out rather than leading with whichever word she is worst at.
  assert.deepEqual(wordsOf(family), ['cat', 'bat', 'mat', 'rat']);
});

// --- robustness and purity ---------------------------------------------------

test('an empty drill set yields no family and does not throw', () => {
  // The state of a fresh log, and the state main.js hands over on every learn
  // click before she has ever played drill. There is no word she is stuck on,
  // so there is nothing to teach — and a spine full of perfectly good families
  // must not tempt the picker into inventing a lesson she did not need.
  const family = pickLearnFamily(modelOf([]), [], spineWords(['cat', 'bat', 'hat']), CONFIG);
  assert.equal(family.pattern, null);
  assert.deepEqual(family.words, []);
});

test('an empty drill set against the real spine still yields no family', () => {
  const model = deriveMastery([], GAME_CONFIG, spellingSpace);
  const family = pickLearnFamily(model, [], SPINE, GAME_CONFIG);
  assert.equal(family.pattern, null);
  assert.deepEqual(family.words, []);
});

test('a drill id the model does not know is skipped, not thrown on', () => {
  // A stale drill set from an older spine must not break a session.
  const [model, drill, spine] = setup([['cat', 'cold'], ['bat', 'cold']]);
  const family = pickLearnFamily(model, [...drill, 'w:notaword'], spine, CONFIG);

  assert.equal(family.pattern, '-at');
  assert.deepEqual(wordsOf(family), ['cat', 'bat']);
});

test('a drill word missing from the spine is not taught', () => {
  // The spine the caller passes is the AUDIO-FILTERED list, so a word absent
  // from it has no recording. Teaching it would be a silent problem in the
  // middle of a lesson, which reads to a kid as the game being broken.
  const model = modelOf([['cat', 'cold'], ['bat', 'cold'], ['hat', 'cold']]);
  const family = pickLearnFamily(model, ['w:hat'], spineWords(['cat', 'bat']), CONFIG);

  assert.equal(family.pattern, null);
  assert.deepEqual(family.words, []);
});

test('a stats entry with an unrecognised bucket does not win the session', () => {
  // It scores as the least needy thing in the drill set rather than the most, so
  // a corrupt line can never be the reason a family gets picked.
  const [model, drill, spine] = setup([
    ['cat', 'nonsense'], ['bat', 'nonsense'],
    ['ship', 'warm'], ['shop', 'warm'],
  ]);

  assert.equal(pickLearnFamily(model, drill, spine, CONFIG).pattern, 'sh');
});

test('neither the model, the drill set, the spine nor the config is mutated', () => {
  const entries = [['cat', 'cold'], ['bat', 'cold'], ['hat', 'cold']];
  const [model, drill, spine] = setup(entries);
  const config = { ...CONFIG };
  const drillBefore = [...drill];
  const spineBefore = spine.map((entry) => ({ ...entry }));

  const family = pickLearnFamily(model, drill, spine, config);
  buildLearnSession(family.words, config);

  assert.deepEqual(drill, drillBefore);
  assert.deepEqual(spine, spineBefore);
  assert.deepEqual(config, CONFIG);
  assert.equal(model.byId.size, entries.length);
  for (const [word, bucket] of entries) {
    assert.equal(model.byId.get(`w:${word}`).bucket, bucket);
  }
});

test('the returned members are fresh objects a caller may not reach through', () => {
  const [model, drill, spine] = setup([['cat', 'cold'], ['bat', 'cold']]);

  const first = pickLearnFamily(model, drill, spine, CONFIG);
  first.words.length = 0;

  assert.equal(pickLearnFamily(model, drill, spine, CONFIG).words.length, 2);
});

// --- the rotation ----------------------------------------------------------
// The bug these pin: `taught` is a boolean, so it demotes a family from
// "cold and untaught" to "cold and taught" exactly ONCE. After every cold family
// in the drill set has had its lesson they score identically, the tie falls to a
// fixed insertion order, and the same family comes back every session forever.
// Learn attempts are excluded from mastery on purpose, so nothing else moves.
// Found in real play: `in pin win tin` four sessions running.
//
// BOTH OF THESE USED TO DRIVE `activeWindow` WITH `CONFIG.windowSize`, which is
// how that key stayed alive after main.js stopped reading it. They now derive a
// real drill set instead — the same 20 words, reached the way the game reaches
// them — because that is what the picker is handed in play. Note that the miss
// events are what make the drill set exist at all: learn attempts are not
// mastery evidence, so a log of nothing but lessons leaves every word unmet, the
// drill set empty and the picker with nothing to choose between.

/** A learn attempt, shaped the way main.js writes them. */
function learnAttempt(word, session) {
  return {
    type: 'attempt', t: `2026-08-02T00:00:00.000Z`, build: GAME_CONFIG.build,
    session, mode: 'learn', word, ms: 3000, stage: 'reveal', wrong: [], revealed: 0,
  };
}

/**
 * Events putting the first `count` spine words into the drill set: one miss
 * each, all in one early session. They land inside `probeMargin` of a cursor
 * that starts at 0, so every one of them is admitted rather than released.
 */
const missedOpener = (count) => SPINE.slice(0, count).map((entry, index) => drillMiss(entry.word, index));

/**
 * The drill set for a log, derived rather than asserted so these tests go on
 * pinning what main.js actually hands the picker. `() => false` for homophones:
 * nothing here is answered cleanly, so nothing is a candidate for marking and
 * the exception has no work to do.
 */
const drillSetFor = (model) => derivePlacement(model, SPINE, GAME_CONFIG, () => false).drill;

test('pressing learn repeatedly rotates families instead of repeating one', () => {
  const events = missedOpener(GAME_CONFIG.drillCap);
  const picked = [];

  for (let session = 1; session <= 16; session += 1) {
    const model = deriveMastery(events, GAME_CONFIG, spellingSpace);
    const family = pickLearnFamily(model, drillSetFor(model), SPINE, CONFIG);
    picked.push(family.pattern);
    for (let pass = 0; pass < GAME_CONFIG.learnPasses; pass += 1) {
      for (const word of family.words) {
        events.push(learnAttempt(word.word, `s${session}`));
      }
    }
  }

  // The tail is what matters: the stall only began once EVERY WORD of every
  // family in the drill set had been taught, so the early sessions rotated even
  // before the fix and prove nothing. Sixteen sessions rather than the original
  // twelve because that point moved: `-at` and `-an` hold more words than one
  // lesson can teach, and the last of them is not saturated until session 7.
  // Measured against a picker with the lesson count taken back out of both the
  // score and the tie-break: the tail below goes to `-at` eight times running.
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
  const family = pickLearnFamily(model, ['w:at', 'w:cat', 'w:big', 'w:dig'], spineWords(['at', 'cat', 'big', 'dig']), CONFIG);
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
  const family = pickLearnFamily(model, ['w:at', 'w:cat', 'w:big', 'w:dig'], spineWords(['at', 'cat', 'big', 'dig']), CONFIG);
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
  const family = pickLearnFamily(model, ['w:at', 'w:cat'], spineWords(['at', 'cat']), CONFIG);
  assert.equal(family.pattern, '-at');
  assert.deepEqual(family.words.map((w) => w.word), ['at', 'cat']);
});

test('two clicks of learn never teach the same family twice while another qualifies', () => {
  // The one shape that reaches an EXACT tie, and it is reachable on purpose.
  // A cold untaught family given one lesson scores rank 1 + 1 lesson = 2, landing
  // exactly on an untouched warm family at rank 2 + 0. The tie then went to
  // insertion order, which favours the EARLIER family — the one just taught — so
  // clicking "learn a word" twice taught -at both times.
  const stats = (word, bucket, taughtCount) => [
    `w:${word}`,
    { id: `w:${word}`, item: { word }, bucket, taught: taughtCount > 0, taughtCount,
      attempts: [], cleanCount: 0, medianCleanMs: null },
  ];
  const drill = ['w:cat', 'w:bat', 'w:big', 'w:dig'];
  const spine = spineWords(['cat', 'bat', 'big', 'dig']);
  const modelWith = (atLessons) => ({
    byId: new Map([
      stats('cat', 'cold', atLessons), stats('bat', 'cold', atLessons),
      stats('big', 'warm', 0), stats('dig', 'warm', 0),
    ]),
    confusions: new Map(),
  });

  const first = pickLearnFamily(modelWith(0), drill, spine, CONFIG).pattern;
  const second = pickLearnFamily(modelWith(1), drill, spine, CONFIG).pattern;

  assert.equal(first, '-at', 'the cold family is taught first');
  assert.notEqual(second, first, 'the same family came back on the very next click');
  assert.equal(second, '-ig');
});

test('clicking learn repeatedly never repeats a family back to back', () => {
  // The question Oliver asked: does pressing "learn a word" twice in a row show
  // the same lesson? Run against the REAL spine and config, because the two
  // shapes that broke this were both structural rather than contrived:
  //
  //   - a cold family given one lesson lands exactly on an untouched warm one,
  //     and the tie went to insertion order — which favours the family just
  //     taught.
  //   - a family bigger than learnWords was scored on members a session would
  //     not reach, so its mean moved a fraction of a step per lesson while every
  //     small family moved a whole one. `irregular` reached eight members
  //     against a limit of four and came up twice running.
  const events = missedOpener(GAME_CONFIG.drillCap);
  const picked = [];

  for (let session = 1; session <= 15; session += 1) {
    const model = deriveMastery(events, GAME_CONFIG, spellingSpace);
    const family = pickLearnFamily(model, drillSetFor(model), SPINE, GAME_CONFIG);
    picked.push(family.pattern);
    for (let pass = 0; pass < GAME_CONFIG.learnPasses; pass += 1) {
      for (const word of family.words) {
        events.push(learnAttempt(word.word, `s${session}`));
      }
    }
  }

  const repeats = picked.filter((pattern, index) => index > 0 && pattern === picked[index - 1]);
  assert.deepEqual(repeats, [], `taught the same family twice running: ${picked.join(' ')}`);
});

test('the words taught are exactly the members the score was computed on', () => {
  // Scoring and selection must not drift: if they use different member sets,
  // the picker optimises for a session it does not then run.
  const stats = (word, bucket) => [
    `w:${word}`,
    { id: `w:${word}`, item: { word }, bucket, taught: false, taughtCount: 0,
      attempts: [], cleanCount: 0, medianCleanMs: null },
  ];
  const model = {
    byId: new Map([
      stats('cat', 'hot'), stats('bat', 'cold'), stats('hat', 'cold'),
      stats('sat', 'cold'), stats('mat', 'cold'), stats('rat', 'hot'),
    ]),
    confusions: new Map(),
  };
  const family = pickLearnFamily(
    model,
    ['w:cat', 'w:bat', 'w:hat', 'w:sat', 'w:mat', 'w:rat'],
    spineWords(['cat', 'bat', 'hat', 'sat', 'mat', 'rat']),
    CONFIG,
  );
  assert.deepEqual(family.words.map((w) => w.word), ['bat', 'hat', 'sat', 'mat'],
    'the hot members should be the ones dropped');
});
