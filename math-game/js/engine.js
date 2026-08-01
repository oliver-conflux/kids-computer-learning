// The problem engine — one problem's worth of state, as pure transitions.
//
// There is NO submit key. The kid types digits into a fixed number of slots and
// the problem resolves on its own (spec §3):
//
//   - typed EQUALS the answer            -> correct
//   - typed REACHES answerDigits(fact)
//     without matching                   -> wrong (spec §4)
//   - typed shorter than answerDigits    -> nothing happens, keep waiting
//
// So for answer 42: '4' waits, '42' resolves, '48' is wrong. Evaluating at full
// length rather than rejecting the first bad digit is deliberate — '48' tells us
// 6x8 is bleeding across and '49' tells us 7x7 is, which is the most valuable
// signal in the log. A lone leading '4' tells us nothing.
//
// A wrong answer BUYS HELP: it records the value, clears the entry, pulses, and
// advances the hint ladder exactly one stage. Nothing is ever marked failed and
// no score is lost.
//
// Pure module: no DOM, no network, no clock, no randomness. Every function is a
// transition that returns a NEW state object and never mutates its input. Time
// always arrives as the `now` parameter so a session can be replayed offline.
//
// The hint ladder arrives as a parameter — this module does not know how it was
// built and never imports hints.js.

import { answerOf, answerDigits } from './facts.js';

const DIGIT_PATTERN = /^[0-9]$/;

/**
 * The stage after `current` in `ladder`, or null when `current` is the last one
 * (or is not in the ladder at all). Advancing is always exactly one step.
 *
 * @param {string[]} ladder
 * @param {string} current
 * @returns {string | null}
 */
function stageAfter(ladder, current) {
  const index = ladder.indexOf(current);
  if (index === -1 || index === ladder.length - 1) {
    return null;
  }
  return ladder[index + 1];
}

/**
 * A fresh state with `typed` and `history` cleared and the ladder parked at its
 * first stage.
 *
 * `history` starts empty: the opening '' is the initial value of `typed`, not an
 * intermediate one. From then on, every transition that changes `typed` pushes
 * the new value — including the '' that a backspace or a wrong answer leaves
 * behind — so `history` replays the entry field exactly.
 *
 * @param {{op: string, a: number, b: number}} fact
 * @param {string[]} ladder — stages in order, always starting 'clean'
 * @param {number} now
 * @returns {object} ProblemState
 */
export function startProblem(fact, ladder, now) {
  return {
    fact,
    ladder: ladder.slice(),
    stage: ladder[0],
    typed: '',
    history: [],
    wrong: [],
    startedAt: now,
    stageAt: now,
    resolvedAt: null,
    status: 'active',
    pulse: false,
  };
}

/**
 * Append one digit and evaluate if the entry has reached full length.
 *
 * Ignores anything that is not a single character '0'..'9', and ignores every
 * keystroke once the problem has resolved — both return the state by reference.
 *
 * @param {object} state ProblemState
 * @param {string} digit a character '0'..'9'
 * @param {number} now
 * @returns {object} ProblemState
 */
export function typeDigit(state, digit, now) {
  if (state.status !== 'active' || !DIGIT_PATTERN.test(digit)) {
    return state;
  }

  const typed = state.typed + digit;
  const history = state.history.concat(typed);

  if (typed.length < answerDigits(state.fact)) {
    // Short of full length. Nothing is evaluated and nothing is an error.
    return { ...state, typed, history, pulse: false };
  }

  if (typed === String(answerOf(state.fact))) {
    return {
      ...state,
      typed,
      history,
      resolvedAt: now,
      status: 'correct',
      pulse: false,
    };
  }

  // Wrong. Record the whole value, clear the entry, pulse once, and advance the
  // ladder exactly one step — never two, and never past the end.
  const next = stageAfter(state.ladder, state.stage);
  return {
    ...state,
    typed: '',
    history: history.concat(''),
    wrong: state.wrong.concat(Number(typed)),
    stage: next === null ? state.stage : next,
    stageAt: next === null ? state.stageAt : now,
    pulse: true,
  };
}

/**
 * Remove the last digit. A no-op on an empty entry or a resolved problem, both
 * of which return the state by reference.
 *
 * `now` is DELIBERATELY UNUSED — do not remove it. It is part of the uniform
 * (state, ..., now) signature the five transitions share, and callers pass it.
 * Backspace must not touch `stageAt`: the hint delay is measured from when the
 * stage began, not from the last keystroke, so a kid fixing a typo does not buy
 * themselves more time before the next hint fires (spec §5). There is a test
 * pinning that.
 *
 * @param {object} state ProblemState
 * @param {number} now unused; see above
 * @returns {object} ProblemState
 */
export function backspace(state, now) {
  if (state.status !== 'active' || state.typed === '') {
    return state;
  }
  const typed = state.typed.slice(0, -1);
  return {
    ...state,
    typed,
    history: state.history.concat(typed),
    pulse: false,
  };
}

/**
 * Advance one hint stage when the current stage has been dwelt on for at least
 * `delayMs`. Otherwise returns the state BY REFERENCE, unchanged — callers may
 * rely on `tick(s, ...) === s` to detect that nothing happened.
 *
 * At the final stage it never advances further, so a ticking timer parked on
 * 'reveal' is a permanent no-op.
 *
 * @param {object} state ProblemState
 * @param {number} now
 * @param {number} delayMs from the fact's mastery bucket
 * @returns {object} ProblemState
 */
export function tick(state, now, delayMs) {
  if (state.status !== 'active' || now - state.stageAt < delayMs) {
    return state;
  }
  const next = stageAfter(state.ladder, state.stage);
  if (next === null) {
    return state;
  }
  return { ...state, stage: next, stageAt: now, pulse: false };
}

/**
 * Build the log line for a resolved problem.
 *
 * `ms` is the whole problem — shown until the correct answer landed, wrong
 * answers and all. `stage` is the furthest stage reached, which is simply the
 * current one because the ladder only ever moves forward.
 *
 * `t` is derived from `resolvedAt` rather than read from a clock, so replaying a
 * session offline reproduces the same line byte for byte.
 *
 * REQUIRED OF CALLERS: the `now` values fed to every function in this module must
 * be EPOCH MILLISECONDS. This is the one place that requirement becomes visible,
 * because `t` is built from `resolvedAt` as a real date. Drive the game loop with
 * a monotonic high-resolution timer instead and every logged `t` becomes a 1970
 * timestamp — while `ms` still looks perfectly correct, because it is a
 * difference and the offset cancels. Nothing throws and no test fails; the log's
 * primary time axis is simply garbage, and mastery's chronological sort silently
 * stops meaning anything. Pass epoch milliseconds.
 *
 * @param {object} state ProblemState with status 'correct'
 * @param {object} config the CONFIG table
 * @param {string} session session id, 's_' + 4 hex chars
 * @returns {object} AttemptEvent
 */
export function toAttemptEvent(state, config, session) {
  if (state.resolvedAt === null) {
    throw new Error('toAttemptEvent called on an unresolved problem');
  }
  return {
    type: 'attempt',
    t: new Date(state.resolvedAt).toISOString(),
    build: config.build,
    session,
    op: state.fact.op,
    a: state.fact.a,
    b: state.fact.b,
    ms: state.resolvedAt - state.startedAt,
    stage: state.stage,
    typed: state.history.slice(),
    wrong: state.wrong.slice(),
  };
}
