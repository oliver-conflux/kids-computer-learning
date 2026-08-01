import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  startProblem,
  typeDigit,
  backspace,
  tick,
  toAttemptEvent,
} from '../js/engine.js';
import { CONFIG } from '../js/config.js';

const SIX_SEVEN = { op: '*', a: 6, b: 7 }; // 42, two digits
const TWO_TWO = { op: '*', a: 2, b: 2 }; //  4, one digit
const TEN_TEN = { op: '*', a: 10, b: 10 }; // 100, three digits
const ZERO_SEVEN = { op: '*', a: 0, b: 7 }; // 0, one digit

const FULL = ['clean', 'strategy', 'blocks', 'reveal'];
const TEN_YEAR_OLD = ['clean', 'strategy', 'reveal'];
const SHORT = ['clean', 'reveal'];

/**
 * Run `fn` and assert it did not touch the state handed to it. Every engine
 * function is a pure transition, so this guard wraps essentially every call in
 * the suite.
 */
function withoutMutating(state, fn) {
  const before = structuredClone(state);
  const result = fn(state);
  assert.deepEqual(state, before, 'input state was mutated');
  return result;
}

function type(state, digits, times) {
  let current = state;
  [...digits].forEach((digit, index) => {
    const now = times === undefined ? 0 : times[index];
    current = withoutMutating(current, (s) => typeDigit(s, digit, now));
  });
  return current;
}

// --- startProblem -----------------------------------------------------------

test('startProblem parks the ladder at its first stage with an empty entry', () => {
  const state = startProblem(SIX_SEVEN, TEN_YEAR_OLD, 1000);
  assert.deepEqual(state, {
    fact: SIX_SEVEN,
    ladder: TEN_YEAR_OLD,
    stage: 'clean',
    typed: '',
    history: [],
    wrong: [],
    startedAt: 1000,
    stageAt: 1000,
    resolvedAt: null,
    status: 'active',
    pulse: false,
  });
});

test('startProblem copies the ladder rather than aliasing the caller array', () => {
  const ladder = ['clean', 'reveal'];
  const state = startProblem(SIX_SEVEN, ladder, 0);
  ladder.push('nonsense');
  assert.deepEqual(state.ladder, ['clean', 'reveal']);
});

// --- the core mechanic: evaluate at full length ------------------------------

test("'4' alone does not evaluate at all for answer 42", () => {
  const state = type(startProblem(SIX_SEVEN, TEN_YEAR_OLD, 0), '4');
  assert.equal(state.status, 'active');
  assert.equal(state.typed, '4');
  assert.deepEqual(state.wrong, []);
  assert.equal(state.stage, 'clean');
  assert.equal(state.resolvedAt, null);
  assert.equal(state.pulse, false);
});

test("typing '4' then '2' for 42 resolves correct", () => {
  const state = type(startProblem(SIX_SEVEN, TEN_YEAR_OLD, 1000), '42', [1200, 1500]);
  assert.equal(state.status, 'correct');
  assert.equal(state.typed, '42');
  assert.equal(state.resolvedAt, 1500);
  assert.deepEqual(state.wrong, []);
  assert.equal(state.stage, 'clean');
  assert.equal(state.pulse, false);
});

test("'48' for answer 42 evaluates as wrong", () => {
  const state = type(startProblem(SIX_SEVEN, TEN_YEAR_OLD, 1000), '48', [1200, 1500]);
  assert.equal(state.status, 'active');
  assert.equal(state.resolvedAt, null);
  assert.deepEqual(state.wrong, [48]);
  assert.equal(state.typed, '', 'the entry clears itself');
  assert.equal(state.pulse, true);
});

test('a wrong answer is recorded as the whole number, not the first bad digit', () => {
  // 48 says 6x8 is bleeding across; 49 says 7x7 is. That distinction is the
  // point of evaluating at length (spec §4).
  const forty_eight = type(startProblem(SIX_SEVEN, TEN_YEAR_OLD, 0), '48');
  const forty_nine = type(startProblem(SIX_SEVEN, TEN_YEAR_OLD, 0), '49');
  const thirty_six = type(startProblem(SIX_SEVEN, TEN_YEAR_OLD, 0), '36');
  assert.deepEqual(forty_eight.wrong, [48]);
  assert.deepEqual(forty_nine.wrong, [49]);
  assert.deepEqual(thirty_six.wrong, [36]);
});

test('a wrong first digit is not rejected — the keystroke takes', () => {
  const state = type(startProblem(SIX_SEVEN, TEN_YEAR_OLD, 0), '3');
  assert.equal(state.typed, '3');
  assert.equal(state.status, 'active');
  assert.deepEqual(state.wrong, []);
});

test('several wrong answers accumulate in order', () => {
  let state = startProblem(SIX_SEVEN, FULL, 0);
  state = type(state, '48');
  state = type(state, '49');
  state = type(state, '36');
  assert.deepEqual(state.wrong, [48, 49, 36]);
  assert.equal(state.typed, '');
});

test('a wrong answer then the right one still resolves correct', () => {
  let state = startProblem(SIX_SEVEN, TEN_YEAR_OLD, 1000);
  state = type(state, '48', [1200, 1400]);
  state = type(state, '42', [1600, 1800]);
  assert.equal(state.status, 'correct');
  assert.equal(state.resolvedAt, 1800);
  assert.deepEqual(state.wrong, [48]);
  assert.equal(state.stage, 'strategy', 'the ladder stays where the wrong answer put it');
});

// --- answer lengths ---------------------------------------------------------

test('the 1-digit case (2x2) evaluates after a single digit', () => {
  const correct = type(startProblem(TWO_TWO, TEN_YEAR_OLD, 0), '4', [500]);
  assert.equal(correct.status, 'correct');
  assert.equal(correct.resolvedAt, 500);

  const wrong = type(startProblem(TWO_TWO, TEN_YEAR_OLD, 0), '6', [500]);
  assert.equal(wrong.status, 'active');
  assert.deepEqual(wrong.wrong, [6]);
  assert.equal(wrong.typed, '');
});

test('a zero answer is one digit and 0 resolves it', () => {
  const state = type(startProblem(ZERO_SEVEN, SHORT, 0), '0', [300]);
  assert.equal(state.status, 'correct');
  assert.equal(state.typed, '0');
});

test('the 3-digit case (10x10) waits for all three digits', () => {
  let state = startProblem(TEN_TEN, SHORT, 0);
  state = type(state, '1', [100]);
  assert.equal(state.status, 'active');
  assert.deepEqual(state.wrong, []);
  state = type(state, '0', [200]);
  assert.equal(state.status, 'active', "'10' is short of three digits and never evaluates");
  assert.deepEqual(state.wrong, []);
  state = type(state, '0', [300]);
  assert.equal(state.status, 'correct');
  assert.equal(state.resolvedAt, 300);
});

test('a 3-digit non-match evaluates wrong only at the third digit', () => {
  let state = startProblem(TEN_TEN, SHORT, 0);
  state = type(state, '99');
  assert.deepEqual(state.wrong, [], "'99' is not yet full length for 100");
  state = type(state, '9');
  assert.deepEqual(state.wrong, [999]);
});

test('a leading zero is kept and evaluated at full length', () => {
  const state = type(startProblem(SIX_SEVEN, TEN_YEAR_OLD, 0), '04');
  assert.deepEqual(state.wrong, [4], "'04' reaches two digits and is wrong");
  assert.equal(state.typed, '');
});

// --- the ladder -------------------------------------------------------------

test('a wrong answer advances the ladder exactly one stage — not zero, not two', () => {
  const start = startProblem(SIX_SEVEN, FULL, 1000);
  assert.equal(start.stage, 'clean');

  const first = type(start, '48', [1100, 1200]);
  assert.equal(first.stage, 'strategy');
  assert.equal(first.stageAt, 1200, 'the new stage begins when the wrong answer landed');

  const second = type(first, '49', [1300, 1400]);
  assert.equal(second.stage, 'blocks');

  const third = type(second, '36', [1500, 1600]);
  assert.equal(third.stage, 'reveal');
});

test('a wrong answer at the final stage does not advance past the end', () => {
  let state = startProblem(SIX_SEVEN, SHORT, 0);
  state = type(state, '48', [100, 200]);
  assert.equal(state.stage, 'reveal', 'now at the last stage of the ladder');
  assert.equal(state.stageAt, 200);

  state = type(state, '49', [300, 400]);
  assert.equal(state.stage, 'reveal', 'still the last stage, not off the end');
  assert.equal(state.ladder.indexOf(state.stage), state.ladder.length - 1);
  assert.equal(state.stageAt, 200, 'stageAt is untouched when the stage did not change');
  assert.deepEqual(state.wrong, [48, 49], 'the wrong answer is still recorded');
  assert.equal(state.pulse, true, 'and it still pulses');
});

test('a wrong answer at the final stage of a one-stage ladder is safe', () => {
  const state = type(startProblem(TWO_TWO, ['clean'], 0), '9');
  assert.equal(state.stage, 'clean');
  assert.deepEqual(state.wrong, [9]);
});

// --- backspace --------------------------------------------------------------

test('backspace removes one digit and records history', () => {
  let state = startProblem(TEN_TEN, SHORT, 0);
  state = type(state, '19');
  assert.equal(state.typed, '19');

  state = withoutMutating(state, (s) => backspace(s, 500));
  assert.equal(state.typed, '1');
  assert.deepEqual(state.history, ['1', '19', '1']);

  state = withoutMutating(state, (s) => backspace(s, 600));
  assert.equal(state.typed, '');
  assert.deepEqual(state.history, ['1', '19', '1', '']);
});

test('backspace on an empty entry is a no-op and adds no history', () => {
  const state = startProblem(SIX_SEVEN, TEN_YEAR_OLD, 0);
  const after = withoutMutating(state, (s) => backspace(s, 500));
  assert.equal(after, state, 'returns the same state by reference');
  assert.deepEqual(after.history, []);
});

test('backspace does not reset the hint clock', () => {
  // The delay is measured from when the STAGE began, not from the last
  // keystroke. Correcting a typo must not buy more time before the next hint
  // fires, or a kid could hold off the ladder forever by typing and deleting.
  let state = startProblem(SIX_SEVEN, FULL, 1000);
  state = type(state, '3', [1500]);
  state = withoutMutating(state, (s) => backspace(s, 2500));
  assert.equal(state.stageAt, 1000, 'stageAt is untouched by a backspace');
  assert.equal(tick(state, 3000, 2000).stage, 'strategy', 'the hint still fires on time');
});

test('typing a digit does not reset the hint clock either', () => {
  let state = startProblem(SIX_SEVEN, FULL, 1000);
  state = type(state, '4', [2900]);
  assert.equal(state.stageAt, 1000);
  assert.equal(tick(state, 3000, 2000).stage, 'strategy');
});

test('backspacing away a bad digit avoids the wrong answer entirely', () => {
  let state = startProblem(SIX_SEVEN, FULL, 0);
  state = type(state, '3');
  state = withoutMutating(state, (s) => backspace(s, 400));
  state = type(state, '42', [500, 600]);
  assert.equal(state.status, 'correct');
  assert.deepEqual(state.wrong, []);
  assert.equal(state.stage, 'clean', 'nothing advanced the ladder');
});

// --- tick -------------------------------------------------------------------

test('tick is a no-op before the delay elapses', () => {
  const state = startProblem(SIX_SEVEN, FULL, 1000);
  const early = withoutMutating(state, (s) => tick(s, 2999, 2000));
  assert.equal(early, state, 'returns the same state by reference');
  assert.equal(early.stage, 'clean');
  assert.equal(early.stageAt, 1000);
});

test('tick advances exactly one stage once the delay has elapsed', () => {
  const state = startProblem(SIX_SEVEN, FULL, 1000);
  const fired = withoutMutating(state, (s) => tick(s, 3000, 2000));
  assert.equal(fired.stage, 'strategy');
  assert.equal(fired.stageAt, 3000, 'the dwell clock restarts on the new stage');
  assert.notEqual(fired, state);
});

test('tick fires exactly at the boundary (>= not >)', () => {
  const state = startProblem(SIX_SEVEN, FULL, 0);
  assert.equal(tick(state, 2000, 2000).stage, 'strategy');
  assert.equal(tick(state, 1999, 2000).stage, 'clean');
});

test('repeated ticks walk the ladder one stage at a time', () => {
  let state = startProblem(SIX_SEVEN, FULL, 0);
  const delay = CONFIG.delays.cold;
  state = withoutMutating(state, (s) => tick(s, delay, delay));
  assert.equal(state.stage, 'strategy');
  state = withoutMutating(state, (s) => tick(s, delay + 1, delay));
  assert.equal(state.stage, 'strategy', 'the dwell clock restarted, so this is early');
  state = withoutMutating(state, (s) => tick(s, delay * 2, delay));
  assert.equal(state.stage, 'blocks');
  state = withoutMutating(state, (s) => tick(s, delay * 3, delay));
  assert.equal(state.stage, 'reveal');
});

test('tick never advances past the final stage no matter how long it waits', () => {
  let state = startProblem(SIX_SEVEN, SHORT, 0);
  state = tick(state, 2000, 2000);
  assert.equal(state.stage, 'reveal');
  const parked = withoutMutating(state, (s) => tick(s, 999999, 2000));
  assert.equal(parked, state, 'a timer parked on the last stage is a permanent no-op');
  assert.equal(parked.stage, 'reveal');
});

test('tick is a no-op once the problem has resolved', () => {
  const resolved = type(startProblem(SIX_SEVEN, FULL, 0), '42', [100, 200]);
  const after = withoutMutating(resolved, (s) => tick(s, 999999, 2000));
  assert.equal(after, resolved);
  assert.equal(after.stage, 'clean');
});

test('a wrong answer resets the dwell clock so the next hint is a full delay away', () => {
  let state = startProblem(SIX_SEVEN, FULL, 0);
  state = type(state, '48', [500, 1000]);
  assert.equal(state.stage, 'strategy');
  assert.equal(tick(state, 2500, 2000).stage, 'strategy', 'measured from the wrong answer');
  assert.equal(tick(state, 3000, 2000).stage, 'blocks');
});

// --- history ----------------------------------------------------------------

test('history captures every intermediate string including ones later cleared', () => {
  let state = startProblem(SIX_SEVEN, FULL, 0);
  state = type(state, '48');
  state = type(state, '42');
  assert.deepEqual(state.history, ['4', '48', '', '4', '42']);
  assert.equal(state.status, 'correct');
});

test('history records the clear after a wrong answer', () => {
  const state = type(startProblem(TWO_TWO, SHORT, 0), '9');
  assert.deepEqual(state.history, ['9', '']);
});

test('history interleaves typing, backspacing and wrong answers in order', () => {
  let state = startProblem(SIX_SEVEN, FULL, 0);
  state = type(state, '3'); //            '3'
  state = backspace(state, 1); //         ''
  state = type(state, '49'); //           '4', '49', then cleared to ''
  state = type(state, '42'); //           '4', '42'
  assert.deepEqual(state.history, ['3', '', '4', '49', '', '4', '42']);
});

test('history is untouched by a keystroke that is not a digit', () => {
  const state = startProblem(SIX_SEVEN, FULL, 0);
  for (const key of ['a', 'Enter', '', '12', ' ', '-']) {
    const after = withoutMutating(state, (s) => typeDigit(s, key, 100));
    assert.equal(after, state, `"${key}" should be ignored`);
  }
});

test('keystrokes after the problem resolves are ignored', () => {
  const resolved = type(startProblem(SIX_SEVEN, FULL, 0), '42', [100, 200]);
  const typedAfter = withoutMutating(resolved, (s) => typeDigit(s, '7', 300));
  assert.equal(typedAfter, resolved);
  const backspacedAfter = withoutMutating(resolved, (s) => backspace(s, 300));
  assert.equal(backspacedAfter, resolved);
  assert.equal(resolved.resolvedAt, 200, 'the resolve time does not move');
});

// --- pulse ------------------------------------------------------------------

test('pulse is true for exactly one transition after a wrong answer', () => {
  let state = startProblem(SIX_SEVEN, FULL, 0);
  assert.equal(state.pulse, false);

  state = type(state, '48');
  assert.equal(state.pulse, true, 'set by the wrong answer');

  state = type(state, '4');
  assert.equal(state.pulse, false, 'cleared by the next transition');
});

test('pulse is cleared by a backspace and by a stage-advancing tick', () => {
  const wrong = type(startProblem(SIX_SEVEN, FULL, 0), '48', [100, 200]);
  assert.equal(wrong.pulse, true);

  const afterDigit = typeDigit(wrong, '4', 300);
  assert.equal(afterDigit.pulse, false);
  assert.equal(backspace(afterDigit, 400).pulse, false);
  assert.equal(tick(wrong, 2200, 2000).pulse, false);
});

test('pulse survives a no-op tick because the state is returned unchanged', () => {
  const wrong = type(startProblem(SIX_SEVEN, FULL, 0), '48', [100, 200]);
  const ticked = tick(wrong, 300, 2000);
  assert.equal(ticked, wrong);
  assert.equal(ticked.pulse, true);
});

test('a correct answer never pulses', () => {
  const state = type(startProblem(SIX_SEVEN, FULL, 0), '42');
  assert.equal(state.pulse, false);
});

// --- toAttemptEvent ---------------------------------------------------------

test('toAttemptEvent builds the full AttemptEvent for a clean solve', () => {
  let state = startProblem(SIX_SEVEN, TEN_YEAR_OLD, 1_700_000_000_000);
  state = type(state, '42', [1_700_000_000_400, 1_700_000_001_100]);
  const event = withoutMutating(state, (s) => toAttemptEvent(s, CONFIG, 's_1a2b'));

  assert.deepEqual(event, {
    type: 'attempt',
    t: '2023-11-14T22:13:21.100Z',
    build: CONFIG.build,
    session: 's_1a2b',
    op: '*',
    a: 6,
    b: 7,
    ms: 1100,
    stage: 'clean',
    typed: ['4', '42'],
    wrong: [],
  });
});

test('toAttemptEvent ms spans the whole problem, wrong answers and all', () => {
  let state = startProblem(SIX_SEVEN, FULL, 1000);
  state = type(state, '48', [1400, 2000]);
  state = type(state, '42', [4000, 5500]);
  const event = toAttemptEvent(state, CONFIG, 's_00ff');
  assert.equal(event.ms, 4500);
  assert.deepEqual(event.wrong, [48]);
  assert.deepEqual(event.typed, ['4', '48', '', '4', '42']);
});

test('toAttemptEvent stage is the furthest stage reached', () => {
  let state = startProblem(SIX_SEVEN, FULL, 0);
  state = tick(state, 2000, 2000); //      clean -> strategy
  state = type(state, '48', [2100, 2200]); // strategy -> blocks
  state = type(state, '42', [2300, 2400]);
  assert.equal(toAttemptEvent(state, CONFIG, 's_abcd').stage, 'blocks');
});

test('toAttemptEvent copies the arrays so the event cannot alias the state', () => {
  const state = type(startProblem(TWO_TWO, SHORT, 0), '4', [200]);
  const event = toAttemptEvent(state, CONFIG, 's_dead');
  event.typed.push('mutated');
  event.wrong.push(99);
  assert.deepEqual(state.history, ['4']);
  assert.deepEqual(state.wrong, []);
});

test('toAttemptEvent takes build from the config table it is handed', () => {
  const state = type(startProblem(TWO_TWO, SHORT, 0), '4', [200]);
  const event = toAttemptEvent(state, { ...CONFIG, build: 'm9' }, 's_beef');
  assert.equal(event.build, 'm9');
});

test('toAttemptEvent throws on an unresolved problem', () => {
  const state = type(startProblem(SIX_SEVEN, FULL, 0), '4');
  assert.throws(() => toAttemptEvent(state, CONFIG, 's_0000'));
});

// --- purity -----------------------------------------------------------------

test('no engine function mutates the state passed to it', () => {
  // One long realistic run, with every call guarded by a deep before/after
  // comparison of the input object.
  let state = startProblem(SIX_SEVEN, FULL, 1000);
  const original = structuredClone(state);

  const calls = [
    (s) => typeDigit(s, '4', 1200),
    (s) => backspace(s, 1300),
    (s) => typeDigit(s, '4', 1400),
    (s) => typeDigit(s, '9', 1500),
    (s) => tick(s, 1600, 2000),
    (s) => tick(s, 3600, 2000),
    (s) => typeDigit(s, 'x', 3700),
    (s) => typeDigit(s, '3', 3800),
    (s) => typeDigit(s, '6', 3900),
    (s) => typeDigit(s, '4', 4000),
    (s) => typeDigit(s, '2', 4100),
    (s) => typeDigit(s, '7', 4200),
    (s) => backspace(s, 4300),
  ];

  for (const call of calls) {
    state = withoutMutating(state, call);
  }

  assert.equal(state.status, 'correct');
  assert.deepEqual(state.wrong, [49, 36]);
  assert.equal(state.stage, 'reveal');

  // The very first state object is still exactly as it was created.
  assert.deepEqual(startProblem(SIX_SEVEN, FULL, 1000), original);
});

test('nested arrays are copied, not shared, between successive states', () => {
  const first = startProblem(SIX_SEVEN, FULL, 0);
  const second = typeDigit(first, '4', 100);
  const third = typeDigit(second, '9', 200);

  assert.notEqual(second.history, first.history);
  assert.notEqual(third.history, second.history);
  assert.notEqual(third.wrong, second.wrong);
  assert.deepEqual(first.history, []);
  assert.deepEqual(second.history, ['4']);
  assert.deepEqual(second.wrong, []);
});

test('the fact and ladder are carried through every transition unchanged', () => {
  let state = startProblem(SIX_SEVEN, FULL, 0);
  state = type(state, '48');
  state = tick(state, 5000, 2000);
  state = backspace(state, 5100);
  assert.deepEqual(state.fact, SIX_SEVEN);
  assert.deepEqual(state.ladder, FULL);
  assert.deepEqual(state.startedAt, 0);
});
