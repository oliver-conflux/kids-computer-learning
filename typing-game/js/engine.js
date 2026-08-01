// typing-game/js/engine.js
//
// The typing state machine. Every exported function is pure and returns a NEW
// state; nothing here mutates, touches the DOM, or reads a clock. Time enters
// as an injected `at` timestamp on each press — that is what makes the WPM and
// streak logic testable without a browser.
//
// The two error models (spec §6) differ in exactly one place: whether a
// mismatch appends an entry or parks in `wrong`. Rendering reads `entries` plus
// `wrong` identically in both modes, so there is one rendering path, not two.
//
// Pure module: no DOM, no network, no clock, no randomness.

import { needsShift, shiftSideFor } from './keymap.js';

/**
 * @param {string} text the item to type
 * @param {{blockOnError: boolean}} opts
 * @returns {object} a fresh state
 */
export function start(text, opts) {
  return {
    text,
    entries: [],
    wrong: null,
    keystrokes: 0,
    errors: 0,
    streak: 0,
    bestStreak: 0,
    wrongShiftSide: false,
    startedAt: null,
    finishedAt: null,
    blockOnError: opts.blockOnError,
  };
}

/**
 * The character the kid must type next, or null when the item is done.
 *
 * @param {object} state
 * @returns {string | null}
 */
export function nextChar(state) {
  if (state.entries.length >= state.text.length) return null;
  return state.text[state.entries.length];
}

/**
 * @param {object} state
 * @returns {boolean}
 */
export function isComplete(state) {
  return state.entries.length >= state.text.length;
}

/**
 * Apply one keystroke.
 *
 * A wrong-side shift is deliberately NOT an error (spec §7): the character
 * counts as correct and the UI is told via `wrongShiftSide` so it can coach.
 * Punishing a kid for a capital that came out right teaches the wrong lesson.
 *
 * @param {object} state
 * @param {{key: string, shiftSide?: string|null, at: number}} input
 * @returns {object} a new state
 */
export function press(state, input) {
  if (isComplete(state)) return state;

  const expected = nextChar(state);
  const startedAt = state.startedAt === null ? input.at : state.startedAt;
  const keystrokes = state.keystrokes + 1;

  if (input.key !== expected) {
    const errors = state.errors + 1;
    if (state.blockOnError) {
      return {
        ...state,
        wrong: input.key,
        keystrokes,
        errors,
        streak: 0,
        startedAt,
      };
    }
    const entries = [...state.entries, { expected, actual: input.key, ok: false }];
    return {
      ...state,
      entries,
      wrong: null,
      keystrokes,
      errors,
      streak: 0,
      startedAt,
      finishedAt: entries.length >= state.text.length ? input.at : null,
    };
  }

  const wantedShift = needsShift(expected) ? shiftSideFor(expected) : null;
  const wrongShiftSide =
    wantedShift !== null &&
    input.shiftSide !== null &&
    input.shiftSide !== undefined &&
    input.shiftSide !== wantedShift;

  const entries = [...state.entries, { expected, actual: input.key, ok: true }];
  const streak = state.streak + 1;

  return {
    ...state,
    entries,
    wrong: null,
    keystrokes,
    streak,
    bestStreak: Math.max(state.bestStreak, streak),
    wrongShiftSide,
    startedAt,
    finishedAt: entries.length >= state.text.length ? input.at : null,
  };
}

/**
 * Backspace. In block mode it clears the sticky wrong character; in
 * pass-through it steps back over the last entry. A backspace is not a
 * keystroke and never counts against accuracy.
 *
 * @param {object} state
 * @returns {object} a new state
 */
export function backspace(state) {
  if (state.wrong !== null) return { ...state, wrong: null };
  if (state.entries.length === 0) return state;
  return { ...state, entries: state.entries.slice(0, -1), finishedAt: null };
}

/**
 * @param {object} state
 * @returns {{accuracy: number, wpm: number, bestStreak: number}}
 */
export function stats(state) {
  const accuracy =
    state.keystrokes === 0 ? 1 : (state.keystrokes - state.errors) / state.keystrokes;

  const endedAt = state.finishedAt ?? state.startedAt;
  const elapsedMs =
    state.startedAt === null || endedAt === null ? 0 : endedAt - state.startedAt;
  const minutes = elapsedMs / 60000;
  const correctChars = state.entries.filter((e) => e.ok).length;
  const wpm = minutes <= 0 ? 0 : correctChars / 5 / minutes;

  return { accuracy, wpm, bestStreak: state.bestStreak };
}
