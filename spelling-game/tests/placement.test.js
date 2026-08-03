// Placement: the cursor, the marking rule, admission and deferral.
//
// This is where the whole probe-and-release design lives, so these tests are the
// ones that matter. The module is pure — no clock, no randomness, no DOM — and
// several tests below exist only to pin that, because the property is what keeps
// tools/replay.js honest and it is easy to lose by accident.

import test from 'node:test';
import assert from 'node:assert/strict';

import { derivePlacement } from '../js/placement.js';
import { deriveMastery } from '../../core/mastery.js';

const CONFIG = {
  retain: 5,
  hotMs: 4000,
  maxPlausibleMs: 60_000,
  probeMargin: 60,
  drillCap: 20,
  cursorStepUp: 40,
  cursorStepDown: 180,
  markSpanSessions: 2,
};

/** A fixture spine of `size` words at known positions: w0, w1, w2 … */
function spineOf(size) {
  return Array.from({ length: size }, (_, index) => ({
    word: `w${index}`,
    rank: index,
    dolch: false,
  }));
}

/** The fixture item space. Mirrors spelling-game/js/space.js's id encoding. */
function spaceOf(spine) {
  return {
    allItems: () => spine,
    itemId: (item) => `w:${item.word}`,
    idFromEvent: (event) =>
      event !== null && typeof event === 'object' && typeof event.word === 'string' && event.word !== ''
        ? `w:${event.word}`
        : null,
    relatedIds: () => [],
    targetOf: (item) => item.word,
    isTypableChar: (char) => /^[a-z0-9]$/.test(char),
    coerceWrong: (typed) => typed,
    isValidWrong: (value) => typeof value === 'string' && value !== '',
    answerValue: (item) => item.word,
    eventFields: (item) => ({ word: item.word }),
  };
}

/** Position of `w<n>` in the fixture spine is simply n. */
const positionOf = (word) => Number(word.slice(1));

/** Nothing is a homophone unless a test says so. */
const noneNeedProof = () => false;

let clock = 0;
/** Monotonic ISO timestamps, so `t` ordering is unambiguous and readable. */
function nextT() {
  clock += 1;
  return `2026-08-${String(Math.floor(clock / 100) + 1).padStart(2, '0')}T${String(
    clock % 24,
  ).padStart(2, '0')}:00:00.000Z`;
}

function attempt(word, overrides = {}) {
  return {
    type: 'attempt',
    t: nextT(),
    word,
    ms: 1000,
    stage: 'clean',
    wrong: [],
    mode: 'drill',
    session: 's1',
    ...overrides,
  };
}

const miss = (word, overrides = {}) => attempt(word, { stage: 'r3', ...overrides });

/** Build a placement over a fixture spine of `size` from `events`. */
function placementOf(size, events, options = {}) {
  const spine = spineOf(size);
  const space = spaceOf(spine);
  const config = { ...CONFIG, ...(options.config ?? {}) };
  const model = deriveMastery(events, config, space);
  return derivePlacement(model, spine, config, options.needsFullProof ?? noneNeedProof);
}

const id = (n) => `w:w${n}`;

test('an empty log places her at the start with the whole spine to probe', () => {
  const placement = placementOf(50, []);

  assert.equal(placement.cursor, 0);
  assert.equal(placement.marked.size, 0);
  assert.equal(placement.deferred.size, 0);
  assert.deepEqual(placement.drill, []);
  assert.equal(placement.probePool.length, 50);
  assert.equal(placement.probePool[0], id(0), 'probe pool is in spine order');
});

test('one clean first sighting marks a word off for good', () => {
  const placement = placementOf(50, [attempt('w5')]);

  assert.ok(placement.marked.has(id(5)));
  assert.ok(!placement.drill.includes(id(5)));
  assert.ok(!placement.probePool.includes(id(5)), 'a marked word is never shown again');
});

test('a homophone is NOT marked on one clean first sighting', () => {
  // Drill flashes a homophone on screen before asking, because audio alone
  // cannot separate `sea` from `see`. A first-sight correct answer there is
  // partly copying, so it is not the retrieval evidence rule 1 assumes.
  const placement = placementOf(50, [attempt('w5')], {
    needsFullProof: (word) => word === 'w5',
  });

  assert.ok(!placement.marked.has(id(5)));
});

test('a homophone marks off by the three-correct path like anything else', () => {
  const events = [
    attempt('w5', { session: 's_a' }),
    attempt('w5', { session: 's_b' }),
    attempt('w5', { session: 's_c' }),
  ];
  const placement = placementOf(50, events, { needsFullProof: (word) => word === 'w5' });

  assert.ok(placement.marked.has(id(5)));
});

test('three corrects in ONE session do not mark a missed word', () => {
  // Three in four minutes measures short-term memory. Retention is the point.
  const events = [
    miss('w5', { session: 's_a' }),
    attempt('w5', { session: 's_a' }),
    attempt('w5', { session: 's_a' }),
    attempt('w5', { session: 's_a' }),
  ];
  const placement = placementOf(50, events);

  assert.ok(!placement.marked.has(id(5)));
  assert.ok(placement.drill.includes(id(5)), 'still being drilled');
});

test('three corrects across two sessions do mark a missed word', () => {
  const events = [
    miss('w5', { session: 's_a' }),
    attempt('w5', { session: 's_a' }),
    attempt('w5', { session: 's_a' }),
    attempt('w5', { session: 's_b' }),
  ];
  const placement = placementOf(50, events);

  assert.ok(placement.marked.has(id(5)));
  assert.ok(!placement.drill.includes(id(5)));
});

test('the cursor climbs on a clean probe by exactly cursorStepUp', () => {
  const placement = placementOf(500, [attempt('w200')]);

  assert.equal(placement.cursor, 160); // 200 - 40
});

test('the cursor never retreats on a clean probe below where it already is', () => {
  const placement = placementOf(500, [attempt('w300'), attempt('w100')]);

  assert.equal(placement.cursor, 260, 'a later easy word does not drag her back');
});

test('the cursor retreats on a miss by exactly cursorStepDown', () => {
  // Climb to 460 first, then miss at 200: min(460, 200+180) = 380.
  const placement = placementOf(500, [attempt('w499'), miss('w200')]);

  assert.equal(placement.cursor, 380);
});

test('a miss above the cursor does not drag the cursor up', () => {
  const placement = placementOf(500, [attempt('w100'), miss('w400')]);

  assert.equal(placement.cursor, 60, 'still 100 - 40; a miss can only lower');
});

test('the cursor depends on timestamp order, not file order', () => {
  const spine = spineOf(500);
  const space = spaceOf(spine);
  const events = [attempt('w300'), attempt('w100'), miss('w50')];
  const shuffled = [events[2], events[0], events[1]];

  const straight = derivePlacement(
    deriveMastery(events, CONFIG, space), spine, CONFIG, noneNeedProof,
  );
  const jumbled = derivePlacement(
    deriveMastery(shuffled, CONFIG, space), spine, CONFIG, noneNeedProof,
  );

  assert.equal(straight.cursor, jumbled.cursor);
  assert.deepEqual(straight.drill, jumbled.drill);
});

test('a miss exactly at cursor + probeMargin is admitted', () => {
  // Climb to 100, then miss at exactly 160.
  const placement = placementOf(500, [attempt('w140'), miss('w160')]);

  assert.equal(placement.cursor, 100);
  assert.ok(placement.drill.includes(id(160)), 'boundary is inclusive');
  assert.ok(!placement.deferred.has(id(160)));
});

test('a miss one past cursor + probeMargin is deferred, not drilled', () => {
  const placement = placementOf(500, [attempt('w140'), miss('w161')]);

  assert.ok(placement.deferred.has(id(161)));
  assert.ok(!placement.drill.includes(id(161)), 'she is not ready for it');
});

test('admission uses the cursor from BEFORE the miss is applied', () => {
  // Climb to 400. Miss at 100: pre-update cursor 400, so 100 <= 460 -> admitted.
  // The miss then drags the cursor to min(400, 280) = 280. Had admission used
  // the post-update cursor the answer would be the same here; this test exists
  // to pin the ORDER so a later refactor cannot quietly swap it.
  const placement = placementOf(500, [attempt('w440'), miss('w100')]);

  assert.equal(placement.cursor, 280);
  assert.ok(placement.drill.includes(id(100)));
});

test('a deferred word rejoins as a DRILL word once the cursor reaches it', () => {
  // Not as a probe. The miss stands (decided 2026-08-03), so the word already
  // needs three clean answers — re-probing would spend a problem asking
  // something already on file, and the first drill turn re-checks it for free.
  const early = placementOf(500, [miss('w300')]);
  assert.ok(early.deferred.has(id(300)));
  assert.ok(!early.probePool.includes(id(300)), 'out of reach, so not offered');
  assert.ok(!early.drill.includes(id(300)));

  const later = placementOf(500, [miss('w300'), attempt('w280'), attempt('w290')]);
  assert.ok(later.drill.includes(id(300)), 'back in reach, so drilled');
  assert.ok(!later.deferred.has(id(300)));
  assert.ok(!later.probePool.includes(id(300)));
});

test('the probe pool holds only words she has never met', () => {
  const placement = placementOf(500, [attempt('w10'), miss('w20'), miss('w400')]);

  for (const each of [id(10), id(20), id(400)]) {
    assert.ok(!placement.probePool.includes(each), `${each} has been seen`);
  }
  assert.ok(placement.probePool.includes(id(11)), 'unseen words are still offered');
});

test('a re-probed deferred word keeps its miss and takes the three-correct path', () => {
  // Decided 2026-08-03: deferral does NOT reset first sight. Answering cleanly
  // once after a deferred miss must not mark the word.
  const placement = placementOf(500, [miss('w300'), attempt('w290'), attempt('w300')]);

  assert.ok(!placement.marked.has(id(300)), 'one clean answer is not enough after a miss');
  assert.ok(placement.drill.includes(id(300)));
});

test('the drill set is capped and ordered by spine position', () => {
  const events = [];
  for (let n = 0; n < 40; n += 1) {
    events.push(miss(`w${n}`));
  }
  const placement = placementOf(500, events);

  assert.equal(placement.drill.length, CONFIG.drillCap);
  const positions = placement.drill.map((each) => positionOf(each.slice(2)));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'spine order');
});

test('marked words never appear in drill or probePool', () => {
  const events = [attempt('w1'), attempt('w2'), miss('w3')];
  const placement = placementOf(50, events);

  for (const markedId of placement.marked) {
    assert.ok(!placement.drill.includes(markedId));
    assert.ok(!placement.probePool.includes(markedId));
  }
});

test('a homophone answered cleanly first time is drilled, not lost', () => {
  // THE BLACK HOLE. Found by running against the real log, where it swallowed
  // `there their so some would`. Such a word is not marked (the flash makes a
  // first-sight correct partly copying), was never missed so was never admitted,
  // and has a first sighting so is not a probe. Without an explicit catch it is
  // in no set at all: unreachable and unmarkable, for up to 64 spine words.
  const placement = placementOf(50, [attempt('w5')], {
    needsFullProof: (word) => word === 'w5',
  });

  assert.ok(!placement.marked.has(id(5)));
  assert.ok(placement.drill.includes(id(5)), 'it still needs two more clean answers');
});

test('admitted words past drillCap wait in pending rather than evaporating', () => {
  const events = [];
  for (let n = 0; n < 30; n += 1) {
    events.push(miss(`w${n}`));
  }
  const placement = placementOf(500, events, { config: { drillCap: 20 } });

  assert.equal(placement.drill.length, 20);
  assert.equal(placement.pending.length, 10);
  assert.ok(placement.drill.every((each) => !placement.pending.includes(each)));
});

test('every spine word lands in exactly one of the five sets', () => {
  const events = [
    attempt('w1'), attempt('w2'), miss('w3'), miss('w400'),
    attempt('w5'), miss('w6'),
  ];
  const placement = placementOf(500, events);
  const spine = spineOf(500);

  for (const entry of spine) {
    const each = `w:${entry.word}`;
    const memberships = [
      placement.marked.has(each),
      placement.drill.includes(each),
      placement.pending.includes(each),
      placement.deferred.has(each),
      placement.probePool.includes(each),
    ].filter(Boolean).length;
    // EXACTLY one, not at most one. "At most" was the original assertion and it
    // passed while five real words were in zero sets — a partition has to be
    // checked from both sides or the hole is invisible.
    assert.equal(memberships, 1, `${each} is in ${memberships} sets, expected 1`);
  }
});

test('the five sets partition the spine exactly, at every stage of play', () => {
  const size = 200;
  const histories = [
    [],
    [attempt('w1')],
    [miss('w1')],
    [miss('w150')],
    [attempt('w1'), miss('w2'), miss('w190'), attempt('w3'), attempt('w3')],
  ];

  for (const events of histories) {
    const placement = placementOf(size, events, { needsFullProof: (word) => word === 'w3' });
    const total =
      placement.marked.size +
      placement.drill.length +
      placement.pending.length +
      placement.deferred.size +
      placement.probePool.length;
    assert.equal(total, size, `partition broken for history of ${events.length} events`);
  }
});

test('a word missed and still not marked is never lost from the model', () => {
  // The failure this guards: a miss that is neither admitted nor deferred simply
  // vanishes, and the word is never offered again in any form.
  const placement = placementOf(500, [miss('w400')]);
  const everywhere =
    placement.marked.has(id(400)) ||
    placement.drill.includes(id(400)) ||
    placement.deferred.has(id(400)) ||
    placement.probePool.includes(id(400));

  assert.ok(everywhere, 'w400 fell out of the model entirely');
});

test('derivation is deterministic', () => {
  const spine = spineOf(200);
  const space = spaceOf(spine);
  const events = [attempt('w10'), miss('w150'), attempt('w20'), miss('w30')];
  const model = deriveMastery(events, CONFIG, space);

  const first = derivePlacement(model, spine, CONFIG, noneNeedProof);
  const second = derivePlacement(model, spine, CONFIG, noneNeedProof);

  assert.equal(first.cursor, second.cursor);
  assert.deepEqual(first.drill, second.drill);
  assert.deepEqual([...first.marked], [...second.marked]);
  assert.deepEqual([...first.deferred], [...second.deferred]);
  assert.deepEqual(first.probePool, second.probePool);
});

test('learn-mode attempts move nothing', () => {
  // Learn has the word on screen throughout. It is instruction, not evidence.
  const placement = placementOf(500, [
    attempt('w200', { mode: 'learn' }),
    miss('w300', { mode: 'learn' }),
  ]);

  assert.equal(placement.cursor, 0);
  assert.equal(placement.marked.size, 0);
  assert.deepEqual(placement.drill, []);
  assert.equal(placement.probePool.length, 500);
});

test('a corrupt log does not break placement', () => {
  const spine = spineOf(50);
  const space = spaceOf(spine);
  const events = [null, 'junk', { type: 'attempt' }, attempt('w5')];
  const model = deriveMastery(events, CONFIG, space);

  const placement = derivePlacement(model, spine, CONFIG, noneNeedProof);
  assert.ok(placement.marked.has(id(5)));
});
