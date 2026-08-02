// typing-game/js/ui.js
//
// Everything the kid sees except the keyboard and hands: the two text lines,
// the prompt, the progress bar, the guidance level, and the results screen.
//
// DOM-facing: verified by playing it, not by unit tests.

import { fingerFor, fingerName, needsShift, shiftSideFor } from './keymap.js';
import { setKeyboardVisibility, highlightKey } from './keyboard.js';
import { setHandsVisibility, highlightFinger } from './hands.js';
import { displayAccuracy } from './progress.js';

/**
 * A WRONG character, made visible (spec §6). A mistyped space renders as
 * nothing at all, so the kid sees the line shake with no idea what they typed.
 *
 * Applied only on the wrong path. A correctly-typed space stays a space, so the
 * typed line keeps matching the target line above it character for character —
 * dotting every space would render a clean line as "she·had·a·field" under a
 * target reading "she had a field", which undercuts the column alignment that
 * is the whole reason for showing two lines.
 */
function visibleWrong(ch) {
  return ch === ' ' ? '·' : ch;
}

function span(text, className) {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

/**
 * Draw both text lines. The target line is static; the typed line shows correct
 * characters, then the sticky wrong character if there is one, then the caret.
 *
 * @param {object} state engine state
 * @returns {void}
 */
export function renderLines(state) {
  document.getElementById('target').textContent = state.text;

  const typed = document.getElementById('typed');
  typed.textContent = '';
  for (const entry of state.entries) {
    typed.appendChild(
      span(entry.ok ? entry.actual : visibleWrong(entry.actual), entry.ok ? 'ok' : 'bad'),
    );
  }
  if (state.wrong !== null) {
    typed.appendChild(span(visibleWrong(state.wrong), 'bad'));
  } else {
    typed.appendChild(span('', 'caret'));
  }
}

/** Shake the typed line. Used on a wrong press in block mode. */
export function shakeLine() {
  const el = document.getElementById('typed');
  el.classList.remove('shake');
  void el.offsetWidth; // force reflow so the animation restarts
  el.classList.add('shake');
}

/**
 * The speech bubble. Names the finger for the next key, and coaches on shift
 * side without ever scolding — a wrong-side shift still produced the right
 * letter (spec §7).
 *
 * @param {object} state
 * @param {{name: string|null, hint: string}} opts
 * @returns {void}
 */
export function renderPrompt(state, opts) {
  const el = document.getElementById('prompt');
  const next = state.entries.length < state.text.length ? state.text[state.entries.length] : null;

  if (state.wrongShiftSide) {
    el.textContent = 'Nice! Try the other shift next time.';
    return;
  }
  if (next === null) {
    el.textContent = opts.name === null ? 'Done!' : `Done, ${opts.name}!`;
    return;
  }

  const greeting = opts.name === null ? '' : `Howdy ${opts.name}! `;
  const finger = fingerName(fingerFor(next) ?? '');
  if (finger === '') {
    el.textContent = `${greeting}${opts.hint}`;
    return;
  }
  const shiftNote = needsShift(next)
    ? ` with the ${shiftSideFor(next) === 'ShiftLeft' ? 'left' : 'right'} shift`
    : '';
  el.textContent = `${greeting}Use your ${finger} finger${shiftNote}.`;
}

/**
 * @param {number} index items completed so far
 * @param {number} total items in the round
 * @returns {void}
 */
export function renderProgress(index, total) {
  document.getElementById('progress-count').textContent = `${index} / ${total}`;
  document.getElementById('progress-bar').style.width = `${(index / total) * 100}%`;
}

/**
 * Apply a guidance level across keyboard and hands (spec §1).
 *
 * @param {number} level 0..3
 * @returns {void}
 */
export function applyGuidance(level) {
  setKeyboardVisibility(level);
  setHandsVisibility(level);
}

/** Highlight the next key on both the deck and the hands, honouring guidance. */
export function highlightNext(ch, level) {
  highlightKey(level >= 2 ? ch : null);
  highlightFinger(level >= 3 ? ch : null);
}

/**
 * The results screen. The step-down offer appears only after a 3-star round and
 * is framed as unlocking a harder challenge — never as losing a help (spec §1).
 *
 * @param {{stars: number, accuracy: number, wpm: number, bestStreak: number,
 *          canStepDown: boolean, hasNext: boolean, keepGoing: boolean}} summary
 * @param {{onAgain: Function, onMenu: Function, onNext: Function,
 *          onKeepGoing: Function, onStepDown: Function}} handlers
 * @returns {void}
 */
export function showResults(summary, handlers) {
  const el = document.getElementById('results');
  el.textContent = '';
  el.classList.remove('hidden');

  const card = document.createElement('div');
  card.className = 'results-card';

  card.appendChild(span('Lesson complete!', 'results-title'));
  // Always three glyphs: filled up to the stars earned, hollow after.
  const stars = '★'.repeat(summary.stars) + '☆'.repeat(3 - summary.stars);
  card.appendChild(span(stars, 'results-stars'));

  const rows = [
    ['Accuracy', `${displayAccuracy(summary.accuracy)}%`],
    ['Speed', `${Math.round(summary.wpm)} wpm`],
    ['Best streak', String(summary.bestStreak)],
  ];
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    row.className = 'results-row';
    row.appendChild(span(label, 'results-label'));
    row.appendChild(span(value, 'results-value'));
    card.appendChild(row);
  }

  if (summary.canStepDown) {
    const offer = document.createElement('button');
    offer.className = 'results-offer';
    offer.textContent = 'Nice! Want to try that again with the hands off?';
    offer.addEventListener('click', handlers.onStepDown);
    card.appendChild(offer);
  }

  const actions = document.createElement('div');
  actions.className = 'results-actions';

  // Always offered. Without it a kid who picked the wrong thing can only
  // replay it or reload the page, and a practice round has no "Next" at all.
  const menu = document.createElement('button');
  menu.textContent = 'Menu';
  menu.addEventListener('click', handlers.onMenu);
  actions.appendChild(menu);

  const again = document.createElement('button');
  again.textContent = 'Again';
  again.addEventListener('click', handlers.onAgain);
  actions.appendChild(again);
  // A keep-going run offers another keep-going pick INSTEAD of Next, not
  // alongside it. Two near-identical primary buttons is a choice a kid should
  // not have to parse mid-flow, and "Next" would break the run anyway by
  // stepping to the strict next rung rather than to what nextup.js chose.
  if (summary.keepGoing) {
    const keep = document.createElement('button');
    keep.textContent = 'Keep going →';
    keep.className = 'primary';
    keep.addEventListener('click', handlers.onKeepGoing);
    actions.appendChild(keep);
  } else if (summary.hasNext) {
    const next = document.createElement('button');
    next.textContent = 'Next →';
    next.className = 'primary';
    next.addEventListener('click', handlers.onNext);
    actions.appendChild(next);
  }
  card.appendChild(actions);
  el.appendChild(card);
}

/** @returns {void} */
export function hideResults() {
  document.getElementById('results').classList.add('hidden');
}
