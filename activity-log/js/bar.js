// The timer bar: one strip that says whether a clock is running, and offers the
// one button that matters right now. Rendered on games-menu.html and on every
// timer screen.
//
// It shows the START TIME, never a live elapsed counter, and there is no
// setInterval in this file. That is the whole feature, not a simplification: the
// machine must not take the measurement for her. A ticking number beside the
// button would answer the question she is here to work out for herself, so the
// bar deliberately reports only the fact she cannot be expected to remember —
// what the clock said when she started — and leaves the subtraction to her.
//
// Presentation only. This module imports nothing but `core/timeclock.js`: no
// config.js, no log.js, no network, no knowledge of either host page. That is
// what lets the games menu mount a bar without pulling in the timeclock app
// behind it. It holds no rules either — which clock is open is decided by
// `deriveOpenClocks` before anything gets here, and what the buttons do is the
// caller's business, handed in as `onStart` / `onStop`.
//
// Styles ship inside this module, injected once as a <style> element, rather
// than living in activity-log/css/style.css. The menu does not load that
// stylesheet and must not have to; a bar that silently renders unstyled on one
// of its two pages is the exact failure worth engineering away. A separate CSS
// file resolved from `import.meta.url` would also work, but it costs a second
// request that can arrive late and lets the bar flash unstyled, and it makes
// the module's correctness depend on a relative path holding for callers at two
// different directory depths. Inlining removes both risks and keeps the bar a
// single file that either works or does not exist.

import { localDate } from '../../core/timeclock.js';

const STYLE_ID = 'kct-timer-bar-styles';

// Every class is prefixed. The bar drops into two pages whose stylesheets it
// does not control — games-menu.html even applies a global `* { margin: 0 }` —
// so it names its own things distinctly and sets the properties it depends on
// rather than inheriting them and hoping.
const CSS = `
.kct-bar {
  box-sizing: border-box;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  max-width: 1200px;
  margin: 0 auto 24px;
  padding: 18px 24px;
  background: #fff;
  border-radius: 20px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  font-family: 'Comic Sans MS', 'Arial', sans-serif;
  color: #333;
}
.kct-bar *,
.kct-bar *::before,
.kct-bar *::after {
  box-sizing: border-box;
}
.kct-bar__icon {
  flex: none;
  font-size: 2.2em;
  line-height: 1;
}
.kct-bar__text {
  flex: 1 1 260px;
  margin: 0;
  padding: 0;
  font-size: 1.4em;
  line-height: 1.3;
  min-width: 0;
}
.kct-bar--idle .kct-bar__text {
  color: #666;
}
.kct-bar__activity {
  font-weight: bold;
}
.kct-bar__note {
  color: #666;
}
.kct-bar__started {
  color: #666;
  white-space: nowrap;
}
.kct-bar__sep {
  color: #b9bec8;
}
.kct-bar__button {
  flex: none;
  border: none;
  padding: 15px 40px;
  font-family: inherit;
  font-size: 1.2em;
  font-weight: bold;
  color: #fff;
  border-radius: 50px;
  cursor: pointer;
  transition: background 0.3s, transform 0.3s;
}
.kct-bar__button--start {
  background: #4caf50;
}
.kct-bar__button--start:hover {
  background: #45a049;
  transform: scale(1.06);
}
.kct-bar__button--stop {
  background: #e8534a;
}
.kct-bar__button--stop:hover {
  background: #d1443c;
  transform: scale(1.06);
}
.kct-bar__button:focus-visible {
  outline: 4px solid #ffd700;
  outline-offset: 3px;
}
@media (max-width: 768px) {
  .kct-bar {
    padding: 16px 18px;
  }
  .kct-bar__text {
    font-size: 1.2em;
  }
  .kct-bar__button {
    flex: 1 1 100%;
    padding: 15px 20px;
  }
  .kct-bar__started {
    white-space: normal;
  }
}
`;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Put the bar's styles in the document, once.
 *
 * Guarded by an id lookup rather than only a module-level flag so that a second
 * copy of this module — two pages' worth of relative import paths can resolve to
 * two module instances in some setups — still leaves one stylesheet behind.
 */
function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID) !== null) {
    return;
  }
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  (doc.head ?? doc.documentElement).append(style);
}

/**
 * An activity key as a word to show a child: 'typing' -> 'Typing'.
 *
 * The real labels live in `activity-log/js/config.js`, which this module must
 * not import — importing it would drag the timeclock app onto the games menu for
 * the sake of three capital letters. Capitalising the key is safe precisely
 * because of the spec's naming rule: the keys are already the plain English
 * words `typing`, `math`, `spelling`, deliberately identical to the log names.
 */
function activityLabel(activity) {
  if (typeof activity !== 'string' || activity === '') {
    return 'Timer';
  }
  return activity.charAt(0).toUpperCase() + activity.slice(1);
}

/**
 * A wall-clock reading as a phrase: '2026-08-04T10:00' -> 'started Tuesday at 10:00 AM'.
 *
 * The day name is always shown, never only when it differs from today, because
 * `renderBar` is not given the current time and must not go looking for it — a
 * bar that reads its own clock is one edit away from ticking. Naming the day
 * costs nothing when it is today and quietly surfaces a timer left running since
 * Tuesday when it is not.
 *
 * The reading is parsed as if it were UTC, which is the same trick
 * `core/timeclock.js` uses on these strings: `at` carries no zone, so reading it
 * on a fixed-offset scale returns the digits she typed rather than sliding them
 * by the ambient timezone. `localDate` is asked first, so nothing malformed gets
 * this far.
 *
 * @returns {string | null} null when `wall` is not a well-formed reading
 */
function formatStartedAt(wall) {
  if (localDate(wall) === null) {
    return null;
  }
  const year = Number(wall.slice(0, 4));
  const month = Number(wall.slice(5, 7));
  const day = Number(wall.slice(8, 10));
  const hour = Number(wall.slice(11, 13));
  const minute = wall.slice(14, 16);

  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const suffix = hour < 12 ? 'AM' : 'PM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;

  return `started ${weekday} at ${hour12}:${minute} ${suffix}`;
}

/** A button, wired only if the caller actually handed over a handler. */
function makeButton(doc, label, modifier, handler) {
  const button = doc.createElement('button');
  // Explicit, because the bar may be mounted inside a <form> on the timer page
  // and a defaulted submit button would reload the page out from under her.
  button.type = 'button';
  button.className = `kct-bar__button kct-bar__button--${modifier}`;
  button.textContent = label;
  if (typeof handler === 'function') {
    button.addEventListener('click', handler);
  }
  return button;
}

function makeSpan(doc, className, text) {
  const span = doc.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

/** ' · ' between the parts that are present, and nowhere else. */
function joinParts(doc, target, parts) {
  parts.forEach((part, index) => {
    if (index > 0) {
      target.append(makeSpan(doc, 'kct-bar__sep', ' · '));
    }
    target.append(part);
  });
}

/**
 * Render the timer bar into `mount`.
 *
 * Two states, and the caller picks between them simply by what it passes:
 * nothing running (an invitation to start) or one clock running (what she is
 * doing, when she started, and a way to stop). There is no third state and no
 * internal state at all — every call rebuilds the strip from its arguments, so
 * re-rendering after an event is written is a plain second call, and the old
 * listeners go out with the old nodes.
 *
 * @param {Element | null} mount the #timer-bar element
 * @param {import('../../core/timeclock.js').OpenClock | null} openClock
 *   the running clock, i.e. `deriveOpenClocks(events)[0] ?? null`
 * @param {{ onStart?: () => void, onStop?: () => void }} [options]
 * @returns {void}
 */
export function renderBar(mount, openClock, options = {}) {
  // A missing mount is not an error worth throwing over: on the games menu the
  // bar is a garnish, and taking the page down because a div was renamed would
  // cost a child her games to save her a timer.
  if (mount === null || typeof mount !== 'object' || typeof mount.ownerDocument !== 'object') {
    return;
  }
  const doc = mount.ownerDocument;
  if (doc === null) {
    return;
  }
  ensureStyles(doc);

  const running = openClock !== null && typeof openClock === 'object';

  const bar = doc.createElement('div');
  bar.className = `kct-bar ${running ? 'kct-bar--running' : 'kct-bar--idle'}`;

  const icon = makeSpan(doc, 'kct-bar__icon', '⏱');
  // Decorative. A screen reader announcing "stopwatch" before the sentence that
  // says the same thing in words is noise.
  icon.setAttribute('aria-hidden', 'true');
  bar.append(icon);

  const text = doc.createElement('p');
  text.className = 'kct-bar__text';

  if (running) {
    const parts = [makeSpan(doc, 'kct-bar__activity', activityLabel(openClock.activity))];
    // Always a string, '' when she left it blank — guaranteed by
    // `deriveOpenClocks`, so this tests for empty and not for absent.
    if (openClock.description !== '') {
      parts.push(makeSpan(doc, 'kct-bar__note', openClock.description));
    }
    // Unreachable via `deriveOpenClocks`, which rejects a clock-in whose `at`
    // will not parse. If it ever is reachable, the bar drops the phrase and
    // still shows the button: knowing a timer is running matters more than
    // knowing when it started, and there is nothing here worth guessing.
    const started = formatStartedAt(openClock.at);
    if (started !== null) {
      parts.push(makeSpan(doc, 'kct-bar__started', started));
    }
    joinParts(doc, text, parts);
    bar.append(text);
    bar.append(makeButton(doc, 'Stop timer!', 'stop', options.onStop));
  } else {
    text.textContent = 'no timer running';
    bar.append(text);
    bar.append(makeButton(doc, 'Start timer!', 'start', options.onStart));
  }

  mount.replaceChildren(bar);
}
