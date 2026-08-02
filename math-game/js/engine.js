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
// In DRILL, a wrong answer BUYS HELP: it records the value, clears the entry,
// pulses, and advances the hint ladder exactly one stage. Nothing is ever marked
// failed and no score is lost.
//
// In LEARN, a wrong answer records, clears and pulses but does NOT advance the
// stage. The strategy is already fully on screen and the answer sits behind a
// button the kid presses when they choose to; advancing on a mistake would take
// that choice away, which is the whole point of the button (spec §1).
//
// The engine reads which case it is in FROM THE LADDER — `ladder[0] ===
// 'strategy'` means a learn problem — rather than carrying a `mode` field on the
// state. One source of truth cannot disagree with itself.
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
 * True when `ladder` belongs to a learn problem.
 *
 * The two v2 ladders are `['clean','reveal']` for drill and
 * `['strategy','reveal']` for learn, so the first rung identifies the mode with
 * no ambiguity — a learn attempt never has stage 'clean' (plan, Shared
 * Contracts). Reading it off the ladder rather than off a `mode` field on the
 * state means there is no second copy of the fact to drift out of sync.
 *
 * @param {string[]} ladder
 * @returns {boolean}
 */
function isLearnLadder(ladder) {
  return ladder[0] === 'strategy';
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
 * @param {string[]} ladder — stages in order, starting 'clean' (drill) or
 *   'strategy' (learn)
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
    revealed: false,
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

  // Wrong. Record the whole value, clear the entry, pulse once, and — in drill
  // only — advance the ladder exactly one step, never two and never past the
  // end. In learn the stage is frozen: the strategy is already on screen and the
  // answer is the kid's button to press.
  const next = isLearnLadder(state.ladder) ? null : stageAfter(state.ladder, state.stage);
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
 * Jump straight to the ladder's FINAL stage and mark the problem `revealed`.
 *
 * This is learn mode's "show me the answer" button (spec §1). It is the only way
 * a learn problem ever changes stage — learn runs no tick loop and its wrong
 * answers do not advance — so the kid, not a clock and not a mistake, decides
 * when the answer appears.
 *
 * It jumps to the LAST rung rather than stepping one, because the button's
 * promise is the answer, not the next hint. On the two-rung v2 ladders those are
 * the same move; on any longer ladder they are not, and the promise wins.
 *
 * Already at the final stage: returns the state BY REFERENCE, unchanged — the
 * same identity no-op that `tick`, `typeDigit` and `backspace` use, which the
 * renderer's pulse guard (`next !== last && next.pulse`) depends on. That means a
 * second press does not set `revealed` on a state that reached the last rung some
 * other way; nothing did, in learn mode, but the reference contract comes first.
 *
 * @param {object} state ProblemState
 * @param {number} now
 * @returns {object} ProblemState
 */
export function revealAnswer(state, now) {
  const last = state.ladder[state.ladder.length - 1];
  if (last === undefined || state.stage === last) {
    return state;
  }
  return { ...state, stage: last, stageAt: now, pulse: false, revealed: true };
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
 * `mode` is written on every event. `revealed` is written ONLY for learn
 * attempts: in drill there is no button to press, so a `revealed: false` on every
 * drill line would be a column of noise that reads as a real signal. Absent means
 * "not applicable", not "false".
 *
 * `mode` defaults to `'drill'` because that is exactly what the log's own rule
 * says an absent `mode` means (spec §5) — every v1 line predates the field and
 * was a drill attempt. The default is for old callers, not new ones: pass it.
 *
 * @param {object} state ProblemState with status 'correct'
 * @param {object} config the CONFIG table
 * @param {string} session session id, 's_' + 4 hex chars
 * @param {'drill' | 'learn'} [mode] which mode produced this attempt
 * @returns {object} AttemptEvent
 */
export function toAttemptEvent(state, config, session, mode = 'drill') {
  if (state.resolvedAt === null) {
    throw new Error('toAttemptEvent called on an unresolved problem');
  }
  const event = {
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
    mode,
  };
  if (mode === 'learn') {
    event.revealed = state.revealed;
  }
  return event;
}
