// Seam tests — the places where two modules' assumptions meet.
//
// Every other test file checks one module against its own contract. These check
// modules against EACH OTHER, which is where the defects in this project have
// actually lived: each side was individually correct and they disagreed.
//
// engine.js deliberately does not import hints.js — it takes a ladder as a
// parameter and advances within it using a private helper. That keeps the engine
// pure and independently testable, but it means there are TWO implementations of
// "advance one stage" in the codebase. They agree today. Nothing structural stops
// a future edit to either side from diverging, and the divergence would be
// invisible: both modules' own suites would stay green while the running game
// showed the wrong hint.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { allFacts, answerOf, answerDigits } from '../js/facts.js';
import { ladderFor, nextStage } from '../js/hints.js';
import { startProblem, typeDigit, tick, toAttemptEvent } from '../js/engine.js';
import { deriveMastery } from '../js/mastery.js';
import { CONFIG } from '../js/config.js';

/** A wrong answer with the SAME digit count as the real one, so it evaluates. */
function wrongAnswerFor(fact) {
  const answer = String(answerOf(fact));
  const last = answer[answer.length - 1];
  const swapped = last === '9' ? '8' : String(Number(last) + 1);
  return answer.slice(0, -1) + swapped;
}

test('engine stage advance agrees with hints.nextStage for every fact', () => {
  for (const fact of allFacts()) {
    const ladder = ladderFor(fact, CONFIG);
    const wrong = wrongAnswerFor(fact);

    // Walk the whole ladder by feeding a wrong answer at each rung.
    let state = startProblem(fact, ladder, 0);
    for (let rung = 0; rung < ladder.length; rung += 1) {
      const before = state.stage;
      for (const digit of wrong) {
        state = typeDigit(state, digit, 100);
      }
      const expected = nextStage(ladder, before);
      if (expected === null) {
        // Terminal rung: both sides must HOLD rather than run off the end.
        assert.equal(state.stage, before, `${fact.a}x${fact.b} ran past the end`);
      } else {
        assert.equal(
          state.stage,
          expected,
          `${fact.a}x${fact.b}: engine went ${before}->${state.stage}, hints says ${expected}`,
        );
      }
    }
  }
});

test('engine stage advance by tick agrees with hints.nextStage', () => {
  for (const fact of allFacts()) {
    const ladder = ladderFor(fact, CONFIG);
    let state = startProblem(fact, ladder, 0);
    let now = 0;

    for (let rung = 0; rung < ladder.length; rung += 1) {
      const before = state.stage;
      now += 10_000;
      state = tick(state, now, 1000);
      const expected = nextStage(ladder, before);
      assert.equal(state.stage, expected === null ? before : expected);
    }
  }
});

test('engine never produces a stage outside its own ladder', () => {
  // hints.nextStage THROWS on a stage it does not recognise. If the engine could
  // ever reach one, wiring would crash at runtime rather than fail a test.
  for (const fact of allFacts()) {
    const ladder = ladderFor(fact, CONFIG);
    const wrong = wrongAnswerFor(fact);
    let state = startProblem(fact, ladder, 0);

    for (let rung = 0; rung <= ladder.length + 1; rung += 1) {
      assert.ok(
        ladder.includes(state.stage),
        `${fact.a}x${fact.b} reached ${state.stage}, not in ${ladder.join('>')}`,
      );
      assert.doesNotThrow(() => nextStage(ladder, state.stage));
      for (const digit of wrong) {
        state = typeDigit(state, digit, 100);
      }
    }
  }
});

test('every engine-produced event is consumable by mastery, for every fact', () => {
  // engine writes AttemptEvent; mastery reads it. Three agents wrote the two
  // ends and the validator between them without seeing each other.
  for (const fact of allFacts()) {
    const ladder = ladderFor(fact, CONFIG);
    let state = startProblem(fact, ladder, 1000);
    for (const digit of String(answerOf(fact))) {
      state = typeDigit(state, digit, 1400);
    }
    assert.equal(state.status, 'correct', `${fact.a}x${fact.b} did not resolve`);

    const event = toAttemptEvent(state, CONFIG, 's_seam');
    const stats = deriveMastery([event], CONFIG).byId.get(`*:${fact.a}x${fact.b}`);

    assert.equal(stats.cleanCount, 1, `${fact.a}x${fact.b} not counted as clean`);
    assert.ok(
      Number.isFinite(stats.medianCleanMs),
      `${fact.a}x${fact.b} produced a non-finite median`,
    );
  }
});

test('answer slot count matches what the engine requires to evaluate', () => {
  // The UI renders answerDigits(fact) slots; the engine evaluates when typed
  // length reaches that same count. If these ever disagree the kid gets a box
  // that never resolves — the exact dead-wait the slots exist to prevent.
  for (const fact of allFacts()) {
    const ladder = ladderFor(fact, CONFIG);
    const answer = String(answerOf(fact));
    assert.equal(answer.length, answerDigits(fact));

    let state = startProblem(fact, ladder, 0);
    for (let i = 0; i < answer.length - 1; i += 1) {
      state = typeDigit(state, answer[i], 10);
      assert.equal(state.status, 'active', `${fact.a}x${fact.b} resolved early`);
    }
    state = typeDigit(state, answer[answer.length - 1], 10);
    assert.equal(state.status, 'correct');
  }
});
