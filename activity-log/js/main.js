// The wiring. Two impure modules live under activity-log/js/ — log.js, which
// owns the network and the outbox, and THIS one, which owns the clock, the
// randomness and the DOM. `Date.now` and `Math.random` appear here and in
// core/log.js and nowhere else in this app.
//
// THIS FILE HOLDS NO RULES. Every decision — which clocks are still running,
// whether she has come back on a later day, whether the time she typed is
// acceptable, how long a session lasted, how a duration is spelled — comes from
// core/timeclock.js. What lives here is the three things a pure module cannot
// have: the current time, a random id, and elements on a page. Plus the words:
// core returns reason codes, and the sentences a child reads are mapped to those
// codes down at the bottom of this file.
//
// The shape of a visit:
//
//   serverIsUp -> flushOutbox -> loadEvents -> render()
//
// and `render()` is the whole router. It re-derives the open clocks from the
// event array and lets that answer decide which screen is showing. Nothing about
// "which clock is running" is ever stored, so there is no second copy of that
// answer to drift out of step with the log — which is the same reason the bar's
// Start and Stop handlers are literally the same function. Neither button
// decides anything; both just ask the log again.
//
// TWO RULES THAT ARE NOT NEGOTIABLE, and the reason the feature exists:
//
//   1. The time input is NEVER prefilled. The machine's current time is shown
//      BESIDE it, in #clock-hint, as a reference she reads and types from.
//   2. There is NO ticking counter anywhere — not on the bar, not on a screen,
//      and not even on the hint, which is set once when a screen appears and
//      then left alone.
//
// Both exist because measuring the time is the exercise. A prefilled field or a
// live counter takes the measurement for her and there is nothing left to learn.

import { CONFIG } from './config.js';
import { serverIsUp, loadEvents, record, flushOutbox } from './log.js';
import { renderBar } from './bar.js';

import {
  localDate,
  toWallClock,
  wallParts,
  durationMinutes,
  elapsedMinutesSince,
  formatDuration,
  deriveOpenClocks,
  isStale,
  validateClockOut,
} from '../../core/timeclock.js';

/**
 * TRAP — `now` IS EPOCH MILLISECONDS. Never performance.now().
 *
 * Everything time-shaped in this app flows through this one function, so there
 * is a single place to get it wrong. `t` is built from it as a real date, and
 * `isStale` compares its calendar day against hers; a monotonic timer would make
 * every logged `t` a 1970 timestamp and make every clock look stale, and neither
 * would throw.
 *
 * @returns {number} epoch milliseconds
 */
const now = () => Date.now();

const rng = () => Math.random();

/**
 * 'a_' + 4 hex chars, matching the `s_37ce` session-id convention the other
 * games use. It is the only thing joining a clock-out or clock-void back to its
 * clock-in, so it is generated once per clock-in and never regenerated.
 *
 * @returns {string}
 */
function newClockId() {
  return `a_${Math.floor(rng() * 0x10000)
    .toString(16)
    .padStart(4, '0')}`;
}

const SCREENS = ['screen-start', 'screen-stop', 'screen-done'];

/**
 * Everything the log said at boot, plus everything this visit has appended.
 *
 * `record` is fire-and-forget, so the server's copy is not readable again until
 * a reload. Pushing the same object we just sent keeps the derivation honest
 * without a round trip — and it is still a derivation: this array is the event
 * log, not a cache of conclusions drawn from it.
 *
 * @type {object[]}
 */
let events = [];

/** Elements, resolved once after the server check passes. @type {object} */
let dom = null;

// ---------------------------------------------------------------------------
// presentation helpers
//
// Rendering only. None of these decides anything: they turn a value core has
// already blessed into something a seven-year-old can read. The 12-hour clock
// and the weekday names are spelled out here rather than taken from
// toLocaleString so the copy comes out exactly as the spec wrote it, on any
// machine, rather than shifting to a 24-hour clock under a different locale.
// ---------------------------------------------------------------------------

const DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

// `wallParts` comes from core. This file used to carry a byte-identical copy of
// core's pattern, which meant the wall-clock format was two facts that had to be
// kept equal by hand — and nothing would have failed at the moment they diverged.

/** 'Tuesday' */
function dayName(wall) {
  const parts = wallParts(wall);
  if (parts === null) {
    return '';
  }
  return DAY_NAMES[new Date(parts.year, parts.month - 1, parts.day).getDay()];
}

/** '10:00 AM' */
function clockTime(wall) {
  const parts = wallParts(wall);
  if (parts === null) {
    return '';
  }
  const suffix = parts.hour < 12 ? 'AM' : 'PM';
  const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  return `${hour12}:${String(parts.minute).padStart(2, '0')} ${suffix}`;
}

/** 'Tuesday at 10:00 AM' */
function dayAtTime(wall) {
  return `${dayName(wall)} at ${clockTime(wall)}`;
}

/** 'Wednesday, 11:00 AM' */
function dayCommaTime(wall) {
  return `${dayName(wall)}, ${clockTime(wall)}`;
}

/** The pretty name for an activity, falling back to the logged value itself. */
function activityLabel(value) {
  const found = CONFIG.activities.find((entry) => entry.value === value);
  return found === undefined ? value : found.label;
}

/**
 * Write a message into an element.
 *
 * innerHTML, because the spec's copy emphasises the times and the hour count.
 * That is only safe under one invariant, so it is stated here: NOTHING SHE TYPED
 * IS EVER INTERPOLATED INTO A MESSAGE. Her description reaches the page through
 * `textContent` on #stop-description and nowhere else; every value that appears
 * inside a message is generated by this file or by core.
 */
function setMessage(element, html) {
  if (element !== null && element !== undefined) {
    element.innerHTML = html;
  }
}

// ---------------------------------------------------------------------------
// startup refusal
// ---------------------------------------------------------------------------

/** The whole page, replaced. Nothing else has been wired when this is called. */
function showNotice(title, body) {
  document.body.innerHTML =
    `<div class="startup-notice"><h1>${title}</h1>${body
      .map((line) => `<p>${line}</p>`)
      .join('')}</div>`;
}

// ---------------------------------------------------------------------------
// screens
// ---------------------------------------------------------------------------

function showScreen(id) {
  for (const name of SCREENS) {
    const screen = document.getElementById(name);
    if (screen !== null) {
      screen.hidden = name !== id;
    }
  }
}

/**
 * The router, and the only thing that decides which screen is up.
 *
 * It asks the log, every time. No open clock means the start form; one or more
 * means the clock-out screen for the newest, which is what makes "you must close
 * the other timer first" an error that cannot happen — she is simply routed to
 * the screen that closes it. Closing that one reveals the next, with no special
 * case, which is why `deriveOpenClocks` returns a list.
 */
function render() {
  const open = deriveOpenClocks(events);
  const openClock = open.length === 0 ? null : open[0];

  if (dom.bar !== null) {
    // Both handlers are `render`. The bar is a view of derived state and holds
    // no opinion about what its own button means; pressing either one just asks
    // the log again, and the log answers.
    renderBar(dom.bar, openClock, { onStart: render, onStop: render });
  }

  if (openClock === null) {
    showStartScreen();
  } else {
    showStopScreen(openClock);
  }
}

function showStartScreen() {
  // Cleared on every entry so a second timer in one sitting does not inherit the
  // first one's description, and — the part that matters — so the time field is
  // empty. It is never given a value, here or anywhere else in this file.
  if (dom.description !== null) {
    dom.description.value = '';
  }
  if (dom.startTime !== null) {
    dom.startTime.value = '';
  }
  setMessage(dom.startMessage, '');

  refreshClockHint();

  showScreen('screen-start');
}

/**
 * Re-read the machine clock into the hint beside the start-time field.
 *
 * Called on entry to the start screen and again whenever she moves into the
 * field — one reading per deliberate act, never on a timer. An interval here
 * would be the ticking counter the whole design forbids, and it would be the
 * wrong instrument besides: she is meant to read the clock on the wall, and this
 * is only so she can tell she is in the right hour.
 *
 * Refreshing on focus is not a nicety. Set once and left alone, the hint goes
 * quietly wrong: open the page at 10:00, get distracted, come back and start at
 * 11:30, and it still says 10:00 AM — disagreeing with the wall clock she is
 * being asked to read, at the exact moment she is deciding what to type. A
 * reference that is sometimes false is worse than no reference, because it can
 * talk her out of a correct measurement.
 */
function refreshClockHint() {
  if (dom.clockHint !== null) {
    dom.clockHint.textContent = clockTime(toWallClock(now()));
  }
}

function showStopScreen(openClock) {
  if (dom.stopActivity !== null) {
    dom.stopActivity.textContent = activityLabel(openClock.activity);
  }
  // textContent, not innerHTML: this is the one place something she typed
  // reaches the page. `description` is always a string, '' when she left it
  // blank, so there is nothing to guard except the empty case looking odd.
  if (dom.stopDescription !== null) {
    dom.stopDescription.textContent = openClock.description;
    dom.stopDescription.hidden = openClock.description === '';
  }
  if (dom.stopStarted !== null) {
    dom.stopStarted.textContent = dayAtTime(openClock.at);
  }
  if (dom.endTime !== null) {
    dom.endTime.value = '';
  }

  // Staleness is decided ONCE, here, on screen load, from the machine clock —
  // never from anything she types. Her answer is validated separately on submit,
  // as an ordinary session on the day she started. Two questions, two moments.
  setMessage(dom.stopMessage, isStale(openClock, now()) ? differentDayCopy(openClock) : '');

  showScreen('screen-stop');
}

function showDoneScreen(startWall, endWall, minutes) {
  if (dom.doneSummary !== null) {
    dom.doneSummary.textContent =
      `${clockTime(startWall)} → ${clockTime(endWall)} = ${formatDuration(minutes)}`;
  }
  showScreen('screen-done');
}

// ---------------------------------------------------------------------------
// the words
//
// Reason codes come out of core; the sentences live here. The different-day and
// over-maximum wordings are the spec's, verbatim — they were written for a child
// and are not mine to improve.
// ---------------------------------------------------------------------------

/**
 * The different-day path.
 *
 * The hour count is `elapsedMinutesSince` on the machine instant `t`, NOT
 * arithmetic on anything she typed and not arithmetic done here. That is the
 * point of it: it reports how long the timer really ran, so the forgetting is
 * named out loud rather than quietly absorbed.
 */
function differentDayCopy(openClock) {
  const startedText = dayAtTime(openClock.at);
  const nowText = dayCommaTime(toWallClock(now()));
  const ranMinutes = elapsedMinutesSince(openClock.t, now());
  const startedDay = dayName(openClock.at);

  if (ranMinutes === null || ranMinutes < 0) {
    // `null` means the log holds a clock-in whose `t` will not parse, which the
    // fold already rejects. Negative means `t` is ahead of the machine clock —
    // a backward clock correction, or a log someone edited by hand, which the
    // plan's own stale-path check instructs a verifier to do.
    //
    // `formatDuration` keeps the sign deliberately, because reporting a
    // backwards session as positive would be a lie. But this sentence pairs the
    // number with an accusation, and "your timer has been running -40 hours
    // 21 minutes. You probably forgot to clock out" tells a child something
    // false and something meaningless at once. Say the true part, drop the
    // number.
    return `You clocked in <strong>${startedText}</strong>. You probably forgot to `
      + `clock out. What time did you finish on ${startedDay}?`;
  }

  return `You clocked in <strong>${startedText}</strong>. It is now `
    + `<strong>${nowText}</strong> — your timer has been running `
    + `<strong>${formatDuration(ranMinutes)}</strong>. You probably forgot to `
    + `clock out. What time did you finish on ${startedDay}?`;
}

/**
 * A rejection, in words.
 *
 * Note what is NOT here: any judgement about whether the entry is acceptable.
 * That already happened, in `validateClockOut`. This only spells out the answer
 * it gave, and it needs `endWall` for one reason — the over-maximum copy quotes
 * the duration, and that number comes from `durationMinutes` in core rather than
 * from a subtraction written here.
 */
function rejectionCopy(reason, openClock, endWall) {
  if (reason === 'too-long') {
    const minutes = durationMinutes(openClock.at, endWall);
    return `That's ${formatDuration(minutes)}. That's a really long time for one `
      + 'activity — if you really did work that long, split it into two timers.';
  }
  if (reason === 'end-before-start') {
    return `You started at <strong>${clockTime(openClock.at)}</strong>, so the time you `
      + 'finished has to come after that. What time did you stop?';
  }
  // 'wrong-day'. Unreachable from these screens — the date half of the reading
  // is taken from the clock being closed, not from her — but a reason code with
  // no sentence would render a blank box, so it gets one anyway.
  return `That time isn't on <strong>${dayName(openClock.at)}</strong>, the day you `
    + `clocked in. What time did you finish on ${dayName(openClock.at)}?`;
}

// ---------------------------------------------------------------------------
// reading the time she typed
// ---------------------------------------------------------------------------

/**
 * An `<input type="time">` value as 'HH:MM', or null when the field is empty.
 *
 * The widget hands back '' for an empty or half-finished entry, and 'HH:MM:SS'
 * if a step ever puts seconds on it. Impossible readings like 25:99 never get
 * this far — the widget refuses them itself, which is the reason the spec chose
 * a time input over free text.
 */
function readTimeField(input) {
  if (input === null) {
    return null;
  }
  const raw = typeof input.value === 'string' ? input.value.trim() : '';
  if (raw === '') {
    return null;
  }
  return raw.slice(0, 5);
}

/**
 * Her reading, plus the calendar day it belongs to: 'YYYY-MM-DDTHH:MM'.
 *
 * The date half is supplied rather than typed, because the field is a time field
 * with no date in it. Which date to supply is the caller's business and both
 * answers come from somewhere real: a clock-in is happening now, so it takes
 * today; a clock-out belongs to the day of the clock-in it closes, which is also
 * what the different-day screen explicitly asks her about.
 *
 * Using the clock-in's day rather than today's is the safer of the two even on
 * the ordinary path. She might open the stop screen at 11:58 PM and submit at
 * 12:01 AM; stamping today's date on that would turn a good session into a
 * wrong-day rejection.
 */
function toWallReading(datePart, hhmm) {
  return `${datePart}T${hhmm}`;
}

// ---------------------------------------------------------------------------
// writing events
// ---------------------------------------------------------------------------

/**
 * Append one event to the log and to this visit's copy of it.
 *
 * TRAP — `t` MUST be toISOString(). It is the log's primary time axis and the
 * other three logs are ordered by string-comparing it, which is chronological
 * only while every writer emits the UTC Z-suffixed form. A local-offset string
 * would make lexicographic order stop matching time order, silently and
 * permanently, in an append-only file.
 *
 * `at` never passes through here. It is her measurement, and it arrives already
 * built from what she typed.
 */
function append(event) {
  const line = { ...event, t: new Date(now()).toISOString(), build: CONFIG.build };
  record(line);
  events.push(line);
}

// ---------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------

function onClockIn() {
  const activity = dom.activity === null ? '' : dom.activity.value;
  if (activity === '') {
    setMessage(dom.startMessage, 'Pick what you are going to work on first.');
    return;
  }

  const hhmm = readTimeField(dom.startTime);
  if (hhmm === null) {
    // THE EMPTY-FIELD GUARD, start side. Same reasoning as the clock-out one
    // below: an unreadable field is a question she has not answered yet, not an
    // answer that is wrong.
    setMessage(dom.startMessage, 'What time are you starting? Read the clock and type it in the box.');
    return;
  }

  const today = localDate(toWallClock(now()));
  if (today === null) {
    setMessage(dom.startMessage, `Something is wrong with this computer's clock. Ask a grown-up.`);
    return;
  }

  const at = toWallReading(today, hhmm);
  if (localDate(at) === null) {
    setMessage(dom.startMessage, 'That time did not come out right. Try typing it again.');
    return;
  }

  append({
    type: 'clock-in',
    id: newClockId(),
    activity,
    description: dom.description === null ? '' : dom.description.value.trim(),
    at,
  });

  render();
}

function onClockOut(openClock) {
  const hhmm = readTimeField(dom.endTime);
  if (hhmm === null) {
    // THE EMPTY-FIELD GUARD, and it must stay in front of validateClockOut.
    //
    // core has three reason codes and none of them means "blank". The wrong-day
    // check runs first and an empty reading yields no day, so an unanswered form
    // comes back as 'wrong-day' — and a child who has typed nothing at all would
    // be told, confidently and falsely, that she typed the wrong date. Catching
    // it here is the difference between a nudge and an accusation.
    setMessage(dom.stopMessage, 'What time did you finish? Read the clock and type it in the box.');
    return;
  }

  const startedOn = localDate(openClock.at);
  if (startedOn === null) {
    setMessage(dom.stopMessage, `This timer's start time cannot be read. Throw it away and start a new one.`);
    return;
  }

  const endWall = toWallReading(startedOn, hhmm);
  const result = validateClockOut(openClock, endWall, CONFIG);

  if (!result.ok) {
    // Nothing is written on a rejection. The screen stays put with her entry
    // still in the field, so a mistyped digit is a correction rather than a
    // re-entry.
    setMessage(dom.stopMessage, rejectionCopy(result.reason, openClock, endWall));
    return;
  }

  append({ type: 'clock-out', id: openClock.id, at: endWall });

  // The done screen first, then the router. Re-deriving here would find no open
  // clock and route straight back to the start form, and she would never see
  // what her measurement came to — which is the only part of this she is here
  // for. "New timer?" is what hands control back to `render`.
  showDoneScreen(openClock.at, endWall, result.minutes);
  if (dom.bar !== null) {
    renderBar(dom.bar, null, { onStart: render, onStop: render });
  }
}

function onVoid(openClock) {
  // Not a delete. A discarded measurement stays in the record as a discarded
  // measurement — the log is append-only and this is the line that says so. The
  // reason code comes from `isStale` rather than from a guess, so "she forgot to
  // clock out" and "she changed her mind" stay distinguishable later.
  append({
    type: 'clock-void',
    id: openClock.id,
    reason: isStale(openClock, now()) ? 'stale' : 'discarded',
  });
  render();
}

// ---------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------

function populateActivities() {
  if (dom.activity === null) {
    return;
  }
  // 1A ships the <select> empty; the options are CONFIG's to name. The `value`
  // written here is the log key, never the label — that identity is the whole
  // preparation for checking her claim against what the game logs recorded.
  dom.activity.replaceChildren();
  for (const entry of CONFIG.activities) {
    const option = document.createElement('option');
    option.value = entry.value;
    option.textContent = entry.label;
    dom.activity.append(option);
  }
}

/**
 * Where the clock-in guard speaks.
 *
 * index.html declares `#start-message`, so the fallback below never runs today.
 * It stays because the guard must never be the thing that fails: an empty form
 * answered by silence is indistinguishable to a child from a form that was
 * accepted, and she would go on believing a timer was running when none was.
 * If the element is ever dropped from the markup, this keeps the words on the
 * screen — unstyled and out of reading order, but present.
 */
function ensureStartMessage() {
  const existing = document.getElementById('start-message');
  if (existing !== null) {
    return existing;
  }
  const anchor = document.getElementById('btn-clock-in');
  if (anchor === null) {
    return null;
  }
  const created = document.createElement('p');
  created.id = 'start-message';
  created.className = 'message';
  created.setAttribute('role', 'status');
  created.setAttribute('aria-live', 'polite');
  anchor.insertAdjacentElement('beforebegin', created);
  return created;
}

function collectDom() {
  return {
    bar: document.getElementById('timer-bar'),

    activity: document.getElementById('activity-select'),
    description: document.getElementById('description-input'),
    startTime: document.getElementById('start-time-input'),
    clockHint: document.getElementById('clock-hint'),
    clockInBtn: document.getElementById('btn-clock-in'),
    startMessage: ensureStartMessage(),

    stopActivity: document.getElementById('stop-activity'),
    stopDescription: document.getElementById('stop-description'),
    stopStarted: document.getElementById('stop-started'),
    endTime: document.getElementById('end-time-input'),
    stopMessage: document.getElementById('stop-message'),
    clockOutBtn: document.getElementById('btn-clock-out'),
    voidBtn: document.getElementById('btn-void'),

    doneSummary: document.getElementById('done-summary'),
    newTimerBtn: document.getElementById('btn-new-timer'),
  };
}

/**
 * Wired once, at boot, on elements that outlive every screen.
 *
 * The two stop-screen buttons re-derive the open clock at click time rather than
 * closing over the one that was on screen when they were wired. A second tab
 * could have closed it in between, and acting on a stale capture would write a
 * clock-out for a clock that is no longer running.
 */
function wire() {
  if (dom.startTime !== null) {
    // Not a tick: `focus` fires when she deliberately moves into the field,
    // which is the moment the reading beside it has to be true. It never fires
    // on its own, so this cannot become a counter.
    dom.startTime.addEventListener('focus', refreshClockHint);
  }
  if (dom.clockInBtn !== null) {
    dom.clockInBtn.addEventListener('click', onClockIn);
  }
  if (dom.clockOutBtn !== null) {
    dom.clockOutBtn.addEventListener('click', () => {
      const open = deriveOpenClocks(events);
      if (open.length === 0) {
        render();
        return;
      }
      onClockOut(open[0]);
    });
  }
  if (dom.voidBtn !== null) {
    dom.voidBtn.addEventListener('click', () => {
      const open = deriveOpenClocks(events);
      if (open.length === 0) {
        render();
        return;
      }
      onVoid(open[0]);
    });
  }
  if (dom.newTimerBtn !== null) {
    // "New timer?" is a route, not a state change. There is no clock to close by
    // the time this is reachable, so `render` lands on the start form.
    dom.newTimerBtn.addEventListener('click', render);
  }
}

// ---------------------------------------------------------------------------
// startup
// ---------------------------------------------------------------------------

async function main() {
  // REFUSE TO START RATHER THAN CLOCK IN WITH NOWHERE TO SAVE. `loadEvents`
  // cannot answer this — it returns [] both for "server down" and for "nothing
  // logged yet", which is right for it and wrong here. And the stakes are worse
  // than in the games: a game with a dead server still teaches the round it just
  // played, but a clock-in that never lands is worse than no clock at all. She
  // would clock in, walk away for an hour, come back to a start form with no
  // memory of it, and the measurement she was here to take would be gone. The
  // outbox cannot save this either, because the clock-out reads state the
  // clock-in never wrote.
  if (!(await serverIsUp())) {
    showNotice('Start the games first', [
      'This timer needs its little server running so it can remember when you start and stop.',
      'Double-click <code>play.command</code> in the games folder, then pick the timer from the menu that opens.',
    ]);
    return;
  }

  // TRAP — FLUSH BEFORE READING. A previous visit that lost the server queued
  // its events to the outbox. They must land on disk BEFORE the tail is read, or
  // they arrive after it and this visit derives its open clocks from a history
  // missing everything the last one recorded — a clock-in queued offline would
  // not be found, she would be shown the start form, and she would clock in
  // twice. The wrong order fails silently: the file ends up complete afterwards,
  // so nothing looks wrong later.
  await flushOutbox();
  events = await loadEvents(); // defaults to CONFIG.logTail

  dom = collectDom();
  populateActivities();
  wire();

  render();
}

main().catch((error) => {
  console.error('activity-log: startup failed', error);
});
