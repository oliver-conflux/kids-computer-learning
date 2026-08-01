// The wiring. This is the only place the whole system exists at once.
//
// THIS MODULE OWNS THE CLOCK AND THE RANDOMNESS. Every other module in
// math-game/js/ is pure precisely so that this one can be the single impure
// place (log.js is the other, and it owns the network). `Date.now` and
// `Math.random` appear here and in log.js and NOWHERE ELSE under math-game/js/ —
// there is a project check that greps for exactly those two strings.
//
// Everything below is arranged around five failure modes that are all SILENT.
// None of them throws, none of them fails a test, and every one of them was
// actually hit during this build. They are marked TRAP 1..5 at the line where
// they live. Read those five comments before editing anything here.
//
// The shape of the thing:
//
//   flushOutbox -> loadEvents -> deriveMastery -> 20 x (pick, run, re-derive)
//   -> SessionEvent -> results screen
//
// One problem at a time. `runProblem` returns a promise that settles when the
// correct answer lands, so the session is a plain `for` loop with an `await` in
// it rather than a state machine. Input and the tick loop both feed the same
// `apply`, which is the only function that ever replaces the current state.

import { CONFIG } from './config.js';
import { factId } from './facts.js';
import { deriveMastery } from './mastery.js';
import { pickNext } from './scheduler.js';
import { ladderFor, delayMsFor } from './hints.js';
import {
  startProblem,
  typeDigit,
  backspace,
  tick,
  toAttemptEvent,
} from './engine.js';
import { loadEvents, record, flushOutbox } from './log.js';
import { mountProblemScreen, renderProblem, renderProgress } from './ui/problem.js';
import { renderResults } from './ui/results.js';

/**
 * The live randomness source, injected into the scheduler. The scheduler takes
 * this as a parameter rather than reaching for it, which is what lets
 * tools/replay.js swap in a seeded generator and reproduce a session exactly.
 *
 * @returns {number} in [0, 1)
 */
const rng = () => Math.random();

/**
 * TRAP 2 — `now` IS EPOCH MILLISECONDS. NEVER performance.now().
 *
 * Every `now` fed into engine.js flows through this one function, so there is a
 * single place to get it wrong. `toAttemptEvent` builds the logged `t` from
 * `resolvedAt` as a real date: drive this with a monotonic high-resolution timer
 * and every logged `t` becomes a 1970 timestamp, while `ms` still looks perfectly
 * correct — because `ms` is a difference and the offset cancels. Nothing throws,
 * no test fails, and the log's primary time axis is garbage.
 *
 * @returns {number} epoch milliseconds
 */
function now() {
  return Date.now();
}

/** How long the finished problem stays on screen before the next one appears. */
const ADVANCE_HOLD_MS = 350;

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

/**
 * 's_' + 4 hex chars, per the Shared Contracts session id shape.
 *
 * @returns {string}
 */
function newSessionId() {
  return `s_${Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, '0')}`;
}

/**
 * @param {number[]} values
 * @returns {number} 0 for an empty list
 */
function median(values) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** @param {number} ms @returns {Promise<void>} */
function hold(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * `previousMedianMs` for the results screen: the `medianMs` of the most recent
 * SessionEvent in the LOADED tail. Everything loaded predates this session by
 * definition — the tail is read before the first problem is served — so "most
 * recent" is simply the latest `t`.
 *
 * TRAP 6's sibling: `t` values are compared as plain strings, which is
 * chronological only because every writer in this system emits `toISOString()`.
 *
 * Returns null on a first run, which the results screen renders as "first
 * session — this is your starting point" rather than as a comparison.
 *
 * @param {object[]} events
 * @returns {number | null}
 */
function previousSessionMedian(events) {
  let best = null;
  for (const event of events) {
    if (event === null || typeof event !== 'object') continue;
    if (event.type !== 'session' || !Number.isFinite(event.medianMs)) continue;
    if (best === null) {
      best = event;
      continue;
    }
    const bestT = typeof best.t === 'string' ? best.t : '';
    const eventT = typeof event.t === 'string' ? event.t : '';
    if (eventT >= bestT) best = event;
  }
  return best === null ? null : best.medianMs;
}

/**
 * Bucket for every fact, for the end-of-session diff.
 *
 * @param {{byId: Map<string, {bucket: string}>}} model
 * @returns {Map<string, string>}
 */
function bucketSnapshot(model) {
  const snapshot = new Map();
  for (const [id, stats] of model.byId) {
    snapshot.set(id, stats.bucket);
  }
  return snapshot;
}

/**
 * Facts whose bucket changed this session.
 *
 * TRAP 7 — BUCKET MOVEMENT IS NOT MONOTONIC. A fact drops back when its clean
 * attempts age out of the retain window, so hot -> cold is a real transition and
 * belongs in this list. `from` is never assumed to be the worse of the two; the
 * comparison is inequality, not ordering, and the results screen works out the
 * direction itself.
 *
 * @param {Map<string, string>} before
 * @param {{byId: Map<string, {bucket: string}>}} model
 * @returns {{id: string, from: string, to: string}[]}
 */
function bucketMoves(before, model) {
  const moved = [];
  for (const [id, stats] of model.byId) {
    const from = before.get(id);
    if (from !== undefined && from !== stats.bucket) {
      moved.push({ id, from, to: stats.bucket });
    }
  }
  return moved;
}

// ---------------------------------------------------------------------------
// the live problem
// ---------------------------------------------------------------------------

const stage = document.getElementById('stage');
const shell = document.getElementById('shell');
const resultsRegion = document.getElementById('results');

/**
 * The problem currently on screen, or null between problems. Holds the engine's
 * own state object by reference — see TRAP 4.
 *
 * @type {{state: object, delayMs: number, resolve: (state: object) => void} | null}
 */
let active = null;

/** @type {number | null} */
let rafHandle = null;

/**
 * Replace the current state and render it. The ONLY place `active.state` moves.
 *
 * TRAP 4 — NEVER CLONE OR RE-WRAP THE STATE BEFORE RENDERING IT. The engine
 * returns the SAME OBJECT BY REFERENCE when a transition is a no-op, and
 * ui/problem.js keys the wrong-answer flash on that object identity: it flashes
 * only for a state it has not rendered before. Writing
 * `renderProblem(stage, { ...state })` here, or rendering a fresh object every
 * animation frame, makes every frame look like a new state — and the amber pulse
 * strobes at the frame rate for as long as the kid sits there instead of firing
 * once. Nothing throws. The identity check below is the same guard from the other
 * side: an unchanged state is not re-rendered at all.
 *
 * @param {object} next ProblemState straight from engine.js
 * @returns {void}
 */
function apply(next) {
  const problem = active;
  if (problem === null || next === problem.state) {
    return;
  }
  problem.state = next;
  renderProblem(stage, next);

  if (next.status === 'correct') {
    // Clear `active` before resolving so a keystroke racing the resolution
    // cannot land on a finished problem.
    active = null;
    problem.resolve(next);
  }
}

/**
 * Input is live from the moment the problem appears and THERE IS NO SUBMIT KEY
 * (spec §3). Digits type, Backspace deletes, everything else is ignored —
 * including every modified chord, so the browser's own shortcuts still work.
 *
 * @param {KeyboardEvent} event
 * @returns {void}
 */
function onKeyDown(event) {
  if (active === null || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }
  const key = event.key;

  if (key.length === 1 && key >= '0' && key <= '9') {
    apply(typeDigit(active.state, key, now()));
    return;
  }
  if (key === 'Backspace') {
    event.preventDefault(); // otherwise the browser navigates back
    apply(backspace(active.state, now()));
  }
}

/**
 * The tick loop. One `tick` per animation frame drives the hint ladder on time
 * without the engine ever seeing a clock. `tick` returns the state unchanged by
 * reference when the delay has not elapsed, so `apply` no-ops and the DOM is not
 * touched on the overwhelming majority of frames.
 *
 * @returns {void}
 */
function frame() {
  if (active !== null) {
    apply(tick(active.state, now(), active.delayMs));
  }
  rafHandle = requestAnimationFrame(frame);
}

/**
 * Put one problem on screen and resolve when the correct answer lands.
 *
 * @param {{op: string, a: number, b: number}} fact
 * @param {string[]} ladder
 * @param {number} delayMs the hint delay for this fact's CURRENT bucket
 * @returns {Promise<object>} the resolved ProblemState
 */
function runProblem(fact, ladder, delayMs) {
  return new Promise((resolve) => {
    const state = startProblem(fact, ladder, now());
    active = { state, delayMs, resolve };
    renderProblem(stage, state);
  });
}

// ---------------------------------------------------------------------------
// the session
// ---------------------------------------------------------------------------

async function main() {
  // TRAP 5 — FLUSH BEFORE READING. A previous session that lost the server
  // queued its events to the localStorage outbox. Those events must land on disk
  // BEFORE the tail is read, or they arrive after it and this session's mastery
  // is derived from a history missing everything the last one recorded. Awaiting
  // in the other order fails silently: the log ends up complete on disk, so
  // nothing looks wrong afterwards.
  await flushOutbox();
  const loaded = await loadEvents(); // defaults to CONFIG.logTail

  let model = deriveMastery(loaded, CONFIG);

  const session = newSessionId();
  const startBuckets = bucketSnapshot(model);
  const previousMedianMs = previousSessionMedian(loaded);

  mountProblemScreen(stage);
  renderProgress(shell, 0, CONFIG.sessionLength);
  document.addEventListener('keydown', onKeyDown);
  rafHandle = requestAnimationFrame(frame);

  /** @type {string[]} FactIds served this session, most recent LAST. */
  const history = [];
  /** @type {object[]} This session's AttemptEvents, in order. */
  const attempts = [];

  for (let index = 0; index < CONFIG.sessionLength; index += 1) {
    const fact = pickNext(model, history, CONFIG, rng);
    const id = factId(fact);
    const ladder = ladderFor(fact, CONFIG);

    // The hint delay follows the fact's CURRENT bucket: a cold fact is rescued
    // in 2s, a hot one is made to wait 6s because by then the retrieval effort
    // is the exercise. The delay grows with mastery — that is not a typo.
    const delayMs = delayMsFor(model.byId.get(id).bucket, CONFIG);

    const resolved = await runProblem(fact, ladder, delayMs);

    // TRAP 3 — TWO DIFFERENT THINGS ARE CALLED `typed`. ProblemState.typed is a
    // STRING (the digits in the box right now); AttemptEvent.typed is a
    // STRING[] (every intermediate value, i.e. state.history). toAttemptEvent
    // does that translation. Never hand-build an event here: the server
    // validates only that `type` is a non-empty string, so a malformed line is
    // accepted, written, and only noticed weeks later when the log is analysed.
    const event = toAttemptEvent(resolved, CONFIG, session);

    // Fire and forget. The kid never waits on I/O between problems; log.js
    // queues to its outbox if the POST fails.
    record(event);
    attempts.push(event);

    // TRAP 1 — RE-DERIVE MASTERY AFTER EVERY COMPLETED PROBLEM, from the loaded
    // tail plus this session's attempts so far. Do NOT reuse the session-start
    // model.
    //
    // The scheduler's success governor recovers the recent clean rate from
    // `model.byId` attempts, because `history` carries fact ids and no outcomes.
    // With a stale model the governor is not merely blind — it is scored against
    // the WRONG evidence, reading yesterday's success on a fact as today's
    // outcome. Measured: eight facts aced yesterday and bombed today give a true
    // clean rate of 0.00 against a floor of 0.8; the stale model fires the
    // governor on 1% of picks, the re-derived one on 100%. Nothing throws. The
    // 80% floor silently ceases to exist and a struggling kid gets a run of
    // consecutive cold facts — the exact bad night the governor exists to stop.
    //
    // Re-deriving 121 facts from a 2000-line tail is cheap next to a kid typing
    // an answer.
    model = deriveMastery(loaded.concat(attempts), CONFIG);

    history.push(id);

    // `done` is the COUNT COMPLETED, not the 1-based index of the problem on
    // screen. It starts at 0 and reaches total only at session end.
    renderProgress(shell, history.length, CONFIG.sessionLength);

    if (index < CONFIG.sessionLength - 1) {
      // Let the finished answer sit in the slots for a beat. This is presentation
      // only — `resolvedAt` was stamped on the keystroke, so no logged number
      // moves because of it.
      await hold(ADVANCE_HOLD_MS);
    }
  }

  document.removeEventListener('keydown', onKeyDown);
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }

  const items = attempts.length;
  const cleanCount = attempts.filter((event) => event.stage === 'clean').length;
  const cleanRate = items === 0 ? 0 : cleanCount / items;
  const medianMs = median(attempts.map((event) => event.ms));

  // TRAP 6 — `t` MUST BE toISOString(). mastery.js orders events by comparing
  // `t` as a plain string, which is chronological only while every writer emits
  // the UTC Z-suffixed ISO format. A local offset like +05:00 makes
  // lexicographic order stop matching time order, silently and permanently, in a
  // file that is append-only.
  const sessionEvent = {
    type: 'session',
    t: new Date(now()).toISOString(),
    build: CONFIG.build,
    session,
    items,
    cleanRate,
    medianMs,
  };
  record(sessionEvent);

  // The SessionSummary is NOT the SessionEvent: it carries `moved` and
  // `previousMedianMs`, which are display-only and derivable, and so are never
  // written to the log.
  const summary = {
    session,
    items,
    cleanRate,
    medianMs,
    previousMedianMs,
    moved: bucketMoves(startBuckets, model),
  };

  stage.hidden = true;
  resultsRegion.hidden = false;
  renderResults(resultsRegion, model, summary);
}

main().catch((error) => {
  console.error('math-game: session failed', error);
});
