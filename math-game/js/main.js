// The wiring. This is the only place the whole system exists at once.
//
// THIS MODULE OWNS THE CLOCK AND THE RANDOMNESS. Every other module in
// math-game/js/ is pure precisely so that this one can be the single impure
// place (log.js is the other, and it owns the network). `Date.now` and
// `Math.random` appear here and in log.js and NOWHERE ELSE under math-game/js/ —
// there is a project check that greps for exactly those two strings.
//
// v2 shape: ONE game, TWO modes, and a results screen that is a hub rather than
// a terminus. The mode arrives on the URL (`?mode=learn`), falls back to
// CONFIG.mode, and can be changed by a button on the results screen without a
// page reload — so `runSession` is called many times per sitting and everything
// it touches has to be re-established each time.
//
//   flushOutbox -> loadEvents -> [ runSession(mode) -> results -> ... ]*
//
// Within one session:
//
//   deriveMastery -> N x (pick, run, re-derive) -> SessionEvent -> results
//
// where N and the pick differ by mode:
//
//   drill  N = CONFIG.sessionLength, picked one at a time by the scheduler,
//          a rAF tick loop driving the reveal timer.
//   learn  N = the length of the session buildLearnSession returned, decided
//          up front, and NO tick loop at all — the kid's button is the only
//          thing that ever advances a learn problem.
//
// One problem at a time. `runProblem` returns a promise that settles when the
// correct answer lands, so a session is a plain `for` loop with an `await` in it
// rather than a state machine. Keyboard input, the tick loop and the reveal
// button all feed the same `apply`, which is the only function that ever
// replaces the current state.
//
// Everything below is arranged around failure modes that are all SILENT. None of
// them throws, none of them fails a test, and every one of them was actually hit
// during this build. They are marked TRAP at the line where they live. Read
// those comments before editing anything here.

import { CONFIG } from './config.js';
import { allFacts, factId } from './facts.js';
import { deriveMastery } from './mastery.js';
import { pickNext } from './scheduler.js';
import { ladderFor, delayMsFor } from './hints.js';
import { pickLearnFacts, buildLearnSession, isLearnable } from './learn.js';
import {
  startProblem,
  typeDigit,
  backspace,
  tick,
  revealAnswer,
  toAttemptEvent,
} from './engine.js';
import { loadEvents, record, flushOutbox } from './log.js';
import {
  mountProblemScreen,
  renderProblem,
  renderProgress,
  onRevealClick,
} from './ui/problem.js';
import { renderResults, onResultsAction } from './ui/results.js';

/**
 * The live randomness source, injected into the scheduler. The scheduler takes
 * this as a parameter rather than reaching for it, which is what lets
 * tools/replay.js swap in a seeded generator and reproduce a session exactly.
 *
 * Learn mode never touches this — `pickLearnFacts` is fully deterministic, so
 * the same model always yields the same three facts.
 *
 * @returns {number} in [0, 1)
 */
const rng = () => Math.random();

/**
 * TRAP — `now` IS EPOCH MILLISECONDS. NEVER performance.now().
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

/** Where the Done button goes. Relative to math-game/index.html. */
const MENU_URL = '../games-menu.html';

/** The only two modes. Anything else on the URL is not a mode. */
const MODES = ['drill', 'learn'];

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

/**
 * Which mode this page was opened in.
 *
 * `?mode=` wins, `CONFIG.mode` is the fallback for someone opening index.html
 * directly, and anything unrecognised falls back rather than being passed on —
 * `ladderFor` throws on an unknown mode, and a typo in a bookmark should not be
 * a blank screen. The fallback itself is validated for the same reason: it is a
 * config value, and config values get edited.
 *
 * @returns {'drill' | 'learn'}
 */
function readMode() {
  const requested = new URLSearchParams(window.location.search).get('mode');
  if (MODES.includes(requested)) {
    return requested;
  }
  return MODES.includes(CONFIG.mode) ? CONFIG.mode : 'drill';
}

/**
 * 's_' + 4 hex chars, per the Shared Contracts session id shape. A fresh one per
 * session, so two chained sessions in one sitting are two rows in the log.
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
 * SessionEvent that PRECEDES the session about to start.
 *
 * Called with the loaded tail plus everything this sitting has recorded, so a
 * kid who chains three drill sessions is compared against the one they just
 * finished rather than against whatever the log ended with an hour ago. On a
 * first run there is nothing to compare and this returns null, which the results
 * screen renders as "first session — this is your starting point".
 *
 * TRAP's sibling: `t` values are compared as plain strings, which is
 * chronological only because every writer in this system emits `toISOString()`.
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
 * TRAP — BUCKET MOVEMENT IS NOT MONOTONIC. A fact drops back when its clean
 * attempts age out of the retain window, so hot -> cold is a real transition and
 * belongs in this list. `from` is never assumed to be the worse of the two; the
 * comparison is inequality, not ordering, and the results screen works out the
 * direction itself.
 *
 * After a learn session this is normally empty, and correctly so: learn attempts
 * are excluded from mastery by construction, so nothing they do can move a
 * bucket. The results screen has its own sentence for that case.
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

/**
 * Is there anything left for learn mode to teach?
 *
 * True when some fact learn mode CAN teach is not yet `hot`. Eligibility is
 * asked of learn.js — `isLearnable` is the single copy of that predicate, and
 * re-deriving it here with `strategyFor` would be a second copy free to drift
 * from the one `pickLearnFacts` selects on. If those two ever disagreed the
 * results screen would offer a Learn button that starts a session with nothing
 * in it, or hide one while facts remain untaught.
 *
 * `false` hides the button entirely, so this is the only thing standing between
 * a kid and a session that leads nowhere.
 *
 * @param {{byId: Map<string, {bucket: string}>}} model
 * @returns {boolean}
 */
function canLearnFrom(model) {
  for (const fact of allFacts()) {
    if (!isLearnable(fact)) {
      continue;
    }
    if (model.byId.get(factId(fact)).bucket !== 'hot') {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// live state
// ---------------------------------------------------------------------------

const stage = document.getElementById('stage');
const shell = document.getElementById('shell');
const resultsRegion = document.getElementById('results');

/**
 * The log tail, read ONCE at startup. Never re-read: the server appends
 * everything this sitting records, so re-reading would double-count it.
 *
 * @type {object[]}
 */
let loadedEvents = [];

/**
 * Everything this sitting has recorded, in order — attempts and session events
 * both.
 *
 * TRAP — THIS IS WHAT MAKES A SECOND LEARN SESSION DIFFERENT FROM THE FIRST.
 * `pickLearnFacts` prefers untaught facts, and `taught` is derived from learn
 * attempts in the event list. Re-deriving from `loadedEvents` alone — which was
 * read before the kid played anything — means the session that just finished is
 * invisible, every fact still looks untaught, and the "Learn 3 facts" button
 * hands back THE SAME THREE FACTS forever. The selector was built to avoid
 * exactly that; it can only do so if the wiring shows it the attempts.
 *
 * @type {object[]}
 */
const sittingEvents = [];

/** The mastery model, re-derived after every completed problem. */
let model = null;

/** True while a session is running, so a double-click cannot start two. */
let running = false;

/**
 * The problem currently on screen, or null between problems. Holds the engine's
 * own state object by reference — see the identity trap on `apply`.
 *
 * `mode` rides along because `renderProblem` needs it and ProblemState
 * deliberately has no mode field: what mode a problem is in is a property of the
 * SESSION, and this module is the only thing that knows it. `delayMs` is null in
 * learn mode, where there is no timer to have a delay for.
 *
 * @type {{
 *   state: object,
 *   delayMs: number | null,
 *   mode: 'drill' | 'learn',
 *   resolve: (state: object) => void,
 * } | null}
 */
let active = null;

/** @type {number | null} */
let rafHandle = null;

// ---------------------------------------------------------------------------
// the live problem
// ---------------------------------------------------------------------------

/**
 * Replace the current state and render it. The ONLY place `active.state` moves.
 *
 * Every input route funnels through here — keystrokes, the tick loop, and the
 * reveal button — so the game has exactly one writer. That matters most for the
 * button: ui/problem.js is handed a zero-argument callback precisely so it
 * cannot hold or transition a ProblemState of its own. Two writers would
 * disagree about which object is current, and the identity guard below would
 * start firing on the wrong transitions.
 *
 * TRAP — NEVER CLONE OR RE-WRAP THE STATE BEFORE RENDERING IT. The engine
 * returns the SAME OBJECT BY REFERENCE when a transition is a no-op, and
 * ui/problem.js keys the wrong-answer flash on that object identity: it flashes
 * only for a state it has not rendered before. Writing
 * `renderProblem(stage, { ...state }, mode)` here, or rendering a fresh object
 * every animation frame, makes every frame look like a new state — and the amber
 * pulse strobes at the frame rate for as long as the kid sits there instead of
 * firing once. Nothing throws. The identity check below is the same guard from
 * the other side: an unchanged state is not re-rendered at all.
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
  renderProblem(stage, next, problem.mode);

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
 * Registered once at startup and never removed. Between problems and on the
 * results screen `active` is null, so every key is a no-op.
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
 * The kid pressed "show me the answer". Learn mode's only stage transition.
 *
 * Registered once at startup, NOT per problem: `onRevealClick` delegates on the
 * container, so one registration survives every remount of the screen, and
 * re-registering per problem would be doing the same work N times for no gain.
 *
 * It takes no arguments and reads the current state from `active`, which is the
 * whole point — see `apply`.
 *
 * @returns {void}
 */
function onReveal() {
  if (active === null) {
    return;
  }
  apply(revealAnswer(active.state, now()));
}

/**
 * The tick loop. DRILL ONLY. One `tick` per animation frame drives the reveal on
 * time without the engine ever seeing a clock. `tick` returns the state
 * unchanged by reference when the delay has not elapsed, so `apply` no-ops and
 * the DOM is not touched on the overwhelming majority of frames.
 *
 * Learn mode never starts this loop, and the `delayMs === null` guard means that
 * even if it somehow ran it could not advance a learn problem. `tick` itself
 * refuses a learn ladder too. Three independent guards for one rule, because
 * "no clock" is the defining property of the mode and a timer sneaking in would
 * show up only as an answer appearing on its own — which reads as a bug in the
 * kid's own memory of what they pressed.
 *
 * @returns {void}
 */
function frame() {
  if (active !== null && active.delayMs !== null) {
    apply(tick(active.state, now(), active.delayMs));
  }
  rafHandle = requestAnimationFrame(frame);
}

/** @returns {void} */
function startTickLoop() {
  if (rafHandle === null) {
    rafHandle = requestAnimationFrame(frame);
  }
}

/** @returns {void} */
function stopTickLoop() {
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
}

/**
 * Put one problem on screen and resolve when the correct answer lands.
 *
 * @param {{op: string, a: number, b: number}} fact
 * @param {string[]} ladder
 * @param {number | null} delayMs the reveal delay for this fact's CURRENT
 *   bucket in drill; null in learn, which has no timer
 * @param {'drill' | 'learn'} mode
 * @returns {Promise<object>} the resolved ProblemState
 */
function runProblem(fact, ladder, delayMs, mode) {
  return new Promise((resolve) => {
    const state = startProblem(fact, ladder, now());
    active = { state, delayMs, mode, resolve };
    renderProblem(stage, state, mode);
  });
}

// ---------------------------------------------------------------------------
// a session
// ---------------------------------------------------------------------------

/**
 * Everything the mastery model is allowed to see: the tail read at startup plus
 * everything this sitting has recorded since.
 *
 * @returns {object[]}
 */
function knownEvents() {
  return loadedEvents.concat(sittingEvents);
}

/**
 * Run one session end to end, then show the results screen.
 *
 * Called once at startup and again for every continuation button, WITHOUT a page
 * reload — so it must re-establish everything a session needs rather than
 * assuming a fresh page: a fresh model, a fresh session id, a fresh problem
 * screen, a progress bar reset to zero, and the stage swapped back in front of
 * the results.
 *
 * @param {'drill' | 'learn'} mode
 * @returns {Promise<void>}
 */
async function runSession(mode) {
  running = true;

  // Fresh model, from the log plus everything this sitting has already played.
  // In drill this feeds the scheduler; in learn it decides which facts get
  // taught, and including `sittingEvents` is the difference between a second
  // learn session teaching three new facts and repeating the last three.
  model = deriveMastery(knownEvents(), CONFIG);

  const session = newSessionId();
  const startBuckets = bucketSnapshot(model);
  const previousMedianMs = previousSessionMedian(knownEvents());

  // The item list. Drill picks one at a time, because each pick depends on the
  // outcome of the last. Learn decides the whole thing up front, because its
  // shape is fixed before the kid answers anything.
  //
  // Progress totals come from `plan.length`, NEVER from learnFacts * learnPasses:
  // `pickLearnFacts` returns FEWER than learnFacts when eligibility runs out, and
  // a hard-coded 12 against a 8-item session would leave the bar stuck at 8/12
  // on a screen that has already moved on.
  const plan = mode === 'learn' ? buildLearnSession(pickLearnFacts(model, CONFIG), CONFIG) : null;
  const total = plan === null ? CONFIG.sessionLength : plan.length;

  resultsRegion.hidden = true;
  stage.hidden = false;
  mountProblemScreen(stage);
  renderProgress(shell, 0, total);

  if (mode === 'drill') {
    startTickLoop();
  }

  /** @type {string[]} FactIds served this session, most recent LAST. */
  const history = [];
  /** @type {object[]} This session's AttemptEvents, in order. */
  const attempts = [];

  for (let index = 0; index < total; index += 1) {
    // The learn plan holds REPEATED REFERENCES to the same fact objects — the
    // same `A` object appears at index 0, 3, 6 and 9. Passes are told apart by
    // INDEX, never by object identity, and nothing here writes to a fact.
    const fact = plan === null ? pickNext(model, history, CONFIG, rng) : plan[index];
    const id = factId(fact);

    // TRAP — PASS `mode` EXPLICITLY. `ladderFor`'s third parameter defaults to
    // `config.mode`, which is the FALLBACK for a URL with no query string, not
    // the mode this session is running in. `ladderFor(fact, CONFIG)` inside a
    // learn session started from `?mode=learn` therefore returns the DRILL
    // ladder: the kid gets a hint-free screen with no strategy and no button,
    // the log records `stage: 'clean'` on learn attempts, and mastery's "clean
    // means retrieval" rule quietly starts counting instruction as fluency.
    // Nothing throws.
    const ladder = ladderFor(fact, CONFIG, mode);

    // Drill's reveal delay follows the fact's CURRENT bucket: a cold fact is
    // rescued in 4s, a hot one is made to wait 8s because by then the retrieval
    // effort is the exercise. The delay grows with mastery — that is not a typo.
    // Learn has no delay at all; null, not a large number, so nothing downstream
    // can mistake it for a very patient timer.
    const delayMs = mode === 'drill' ? delayMsFor(model.byId.get(id).bucket, CONFIG) : null;

    const resolved = await runProblem(fact, ladder, delayMs, mode);

    // TRAP — TWO DIFFERENT THINGS ARE CALLED `typed`. ProblemState.typed is a
    // STRING (the digits in the box right now); AttemptEvent.typed is a
    // STRING[] (every intermediate value, i.e. state.history). `toAttemptEvent`
    // does that translation, and also decides that `revealed` is written for
    // learn attempts and omitted for drill. Never hand-build an event here: the
    // server validates only that `type` is a non-empty string, so a malformed
    // line is accepted, written, and only noticed weeks later when the log is
    // analysed.
    const event = toAttemptEvent(resolved, CONFIG, session, mode);

    // Fire and forget. The kid never waits on I/O between problems; log.js
    // queues to its outbox if the POST fails.
    record(event);
    attempts.push(event);
    sittingEvents.push(event);

    // TRAP — RE-DERIVE MASTERY AFTER EVERY COMPLETED PROBLEM, from the loaded
    // tail plus this sitting's attempts so far. Do NOT reuse the session-start
    // model.
    //
    // In drill, the scheduler's success governor recovers the recent clean rate
    // from `model.byId` attempts, because `history` carries fact ids and no
    // outcomes. With a stale model the governor is not merely blind — it is
    // scored against the WRONG evidence, reading yesterday's success on a fact
    // as today's outcome. Measured: eight facts aced yesterday and bombed today
    // give a true clean rate of 0.00 against a floor of 0.8; the stale model
    // fires the governor on 1% of picks, the re-derived one on 100%. Nothing
    // throws. The 80% floor silently ceases to exist and a struggling kid gets a
    // run of consecutive cold facts — the exact bad night the governor exists to
    // stop.
    //
    // In learn it costs nothing and keeps the `taught` flags — and so the
    // results grid's "shown how" count — honest as the session runs.
    //
    // Re-deriving 121 facts from a 2000-line tail is cheap next to a kid typing
    // an answer.
    model = deriveMastery(knownEvents(), CONFIG);

    history.push(id);

    // `done` is the COUNT COMPLETED, not the 1-based index of the problem on
    // screen. It starts at 0 and reaches total only at session end.
    renderProgress(shell, history.length, total);

    if (index < total - 1) {
      // Let the finished answer sit in the slots for a beat. This is presentation
      // only — `resolvedAt` was stamped on the keystroke, so no logged number
      // moves because of it.
      await hold(ADVANCE_HOLD_MS);
    }
  }

  stopTickLoop();
  active = null;

  const items = attempts.length;
  const cleanCount = attempts.filter((event) => event.stage === 'clean').length;
  const cleanRate = items === 0 ? 0 : cleanCount / items;
  const medianMs = median(attempts.map((event) => event.ms));

  // TRAP — `t` MUST BE toISOString(). mastery.js orders events by comparing `t`
  // as a plain string, which is chronological only while every writer emits the
  // UTC Z-suffixed ISO format. A local offset like +05:00 makes lexicographic
  // order stop matching time order, silently and permanently, in a file that is
  // append-only.
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
  // Kept in the sitting's list so the NEXT session compares itself against this
  // one rather than against whatever the log ended with before the kid sat down.
  sittingEvents.push(sessionEvent);

  // The SessionSummary is NOT the SessionEvent: it carries `moved`,
  // `previousMedianMs`, `mode` and `canLearn`, which are display-only and
  // derivable, and so are never written to the log.
  //
  // `mode` is not decoration — the results screen renders a DIFFERENT stats
  // strip for learn. A learn session has no `clean` rung by construction, so its
  // clean rate is always exactly 0, and the drill strip would render that as
  // "0% from memory": a failure grade for a session that cannot produce anything
  // else. Omit `mode` and every learn session ends by telling the kid they got
  // nothing right.
  const summary = {
    session,
    items,
    cleanRate,
    medianMs,
    previousMedianMs,
    moved: bucketMoves(startBuckets, model),
    mode,
    canLearn: canLearnFrom(model),
  };

  stage.hidden = true;
  resultsRegion.hidden = false;
  renderResults(resultsRegion, model, summary);

  running = false;
}

/**
 * A continuation button on the results screen. Registered once at startup; the
 * listener is delegated on the container, so it survives every re-render.
 *
 * 'learn' and 'drill' start a new session in that mode with NO page reload —
 * which is why `runSession` re-derives everything rather than trusting module
 * state left over from the session that just ended.
 *
 * @param {'learn' | 'drill' | 'done'} action
 * @returns {void}
 */
function onAction(action) {
  if (action === 'done') {
    window.location.href = MENU_URL;
    return;
  }
  if (!MODES.includes(action) || running) {
    return;
  }
  runSession(action).catch((error) => {
    console.error('math-game: session failed', error);
  });
}

// ---------------------------------------------------------------------------
// startup
// ---------------------------------------------------------------------------

async function main() {
  // TRAP — FLUSH BEFORE READING. A previous session that lost the server queued
  // its events to the localStorage outbox. Those events must land on disk BEFORE
  // the tail is read, or they arrive after it and this session's mastery is
  // derived from a history missing everything the last one recorded. Awaiting in
  // the other order fails silently: the log ends up complete on disk, so nothing
  // looks wrong afterwards.
  await flushOutbox();
  loadedEvents = await loadEvents(); // defaults to CONFIG.logTail

  // All three input routes are wired ONCE, before the first mount. Each is
  // delegated on a container that outlives every screen inside it, so remounting
  // cannot lose the wiring — and registering them per session would stack
  // duplicate listeners on the second one.
  document.addEventListener('keydown', onKeyDown);
  onRevealClick(stage, onReveal);
  onResultsAction(resultsRegion, onAction);

  await runSession(readMode());
}

main().catch((error) => {
  console.error('math-game: session failed', error);
});
