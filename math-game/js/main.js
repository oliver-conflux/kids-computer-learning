// The wiring. This is the only place the whole system exists at once.
//
// THIS MODULE OWNS THE CLOCK AND THE RANDOMNESS. Every other module in
// math-game/js/ is pure precisely so that this one can be the single impure
// place (log.js is the other, and it owns the network). `Date.now` and
// `Math.random` appear here and in log.js and NOWHERE ELSE under math-game/js/ —
// there is a project check that greps for exactly those two strings.
//
// v3 shape: ONE game, THREE modes, and a results screen that is a hub rather
// than a terminus. The mode arrives on the URL (`?mode=learn`), and can be
// changed by a button on the results screen without a page reload — so
// `runSession` is called many times per sitting and everything it touches has to
// be re-established each time. There is NO fallback mode: a URL with no
// recognised `?mode=` is a kid who has not chosen one.
//
//   flushOutbox -> loadEvents -> menu -> [ runSession(mode, table) -> results ]*
//
// where every arrow after the first two is a screen swap and NOT a navigation.
// Three regions live in index.html — #stage, #results and #menu — exactly one is
// visible, and `MENU_URL` is now reached only from the menu's own "Back to all
// games". A kid arriving with no `?mode=` starts at the menu.
//
// Within one session:
//
//   deriveMastery -> N x (pick, run, re-derive) -> SessionEvent -> results
//
// where N and the pick differ by mode:
//
//   drill    N = CONFIG.sessionLength, picked one at a time by the scheduler,
//            a rAF tick loop driving the reveal timer.
//   learn    N = the length of the session buildLearnSession returned, decided
//            up front, and NO tick loop at all — the kid's button is the only
//            thing that ever advances a learn problem.
//   ordered  N = the length of the run runFor returned for `?table=`, decided up
//            front, and no tick loop either. The scheduler is not called at all.
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
import { deriveMastery, previousSessionMedian } from './mastery.js';
import { pickNext } from './scheduler.js';
import { ladderFor, delayMsFor } from './hints.js';
import { pickLearnFacts, buildLearnSession, isLearnable } from './learn.js';
import { runFor, isTable } from './ordered.js';
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
import { renderMenu, onMenuAction } from './ui/menu.js';

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

/** The only three modes. Anything else on the URL is not a mode. */
const MODES = ['drill', 'learn', 'ordered'];

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

/**
 * Which mode this page was opened in, or null for "the kid has not said".
 *
 * NULL IS A REAL ANSWER AND NOT A FAILURE. There is no fallback mode any more:
 * `CONFIG.mode` is retired, because the three modes are different activities
 * rather than difficulty levels and choosing one for a kid who arrived with no
 * `?mode=` was always a guess — and the guess was `drill`, which teaches
 * nothing. Null means show the game's own menu and let her pick.
 *
 * Anything unrecognised is null for the same reason a missing mode is: a typo in
 * a bookmark must land on the menu, never on a blank screen and never on
 * `ladderFor`, which throws on a mode it does not know.
 *
 * @returns {'drill' | 'learn' | 'ordered' | null}
 */
function readMode() {
  const requested = new URLSearchParams(window.location.search).get('mode');
  return MODES.includes(requested) ? requested : null;
}

/**
 * Which table `?table=` asks for, or null for "not a table".
 *
 * Only ordered mode reads this. The range check is `isTable` from ordered.js
 * rather than a pair of bounds written out here, so there is one copy of "which
 * rows are tables" in the codebase — two copies of a range is the divergence
 * shape that has already bitten this project twice.
 *
 * `Number()` is deliberately not used: it turns '' into 0 and ' 3 ' into 3.
 * `?table=` with nothing after it is a missing table, not the 0s.
 *
 * @returns {number | null}
 */
function readTable() {
  const requested = new URLSearchParams(window.location.search).get('table');
  if (requested === null || !/^\d+$/.test(requested)) {
    return null;
  }
  const table = Number.parseInt(requested, 10);
  return isTable(table) ? table : null;
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
const menuRegion = document.getElementById('menu');

/**
 * The thin strip along the top of the shell, which carries the progress bar.
 *
 * TRAP — THE PROGRESS BAR IS NOT INSIDE THE STAGE. It lives in `#shell`
 * (index.html:35), ABOVE all three regions, so `stage.hidden = true` does not
 * hide it and neither does anything else the screen swap does. Show the menu
 * without dealing with it and the menu renders under a stale `11 / 11` left over
 * from the session that just ended — nothing throws, no test goes red, and it
 * quietly reads as progress through a menu.
 *
 * `showMenu` therefore does two things to this element and `runSession` undoes
 * both: the count is reset AND the strip is hidden, because a menu has no
 * progress and an emptied bar reading `0 / 0` is still a progress bar.
 */
const topStrip = shell.querySelector('.shell__top');

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
 * both instruction modes, where there is no timer to have a delay for.
 *
 * @type {{
 *   state: object,
 *   delayMs: number | null,
 *   mode: 'drill' | 'learn' | 'ordered',
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
 * NEITHER INSTRUCTION MODE STARTS THIS LOOP, and the `delayMs === null` guard
 * means that even if it somehow ran it could not advance a learn or an ordered
 * problem. `tick` itself refuses a ['strategy','reveal'] ladder too, which is
 * both of them. Three independent guards for one rule, because "no clock" is the
 * defining property of those modes and a timer sneaking in would show up only as
 * an answer appearing on its own — which reads as a bug in the kid's own memory
 * of what they pressed.
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
 *   bucket in drill; null in learn and ordered, which have no timer
 * @param {'drill' | 'learn' | 'ordered'} mode
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
 * @param {'drill' | 'learn' | 'ordered'} mode
 * @param {number | null} [table] which table, for ordered mode ONLY. Null in
 *   drill and learn, which do not have one.
 * @returns {Promise<void>}
 */
async function runSession(mode, table = null) {
  running = true;

  // Fresh model, from the log plus everything this sitting has already played.
  // In drill this feeds the scheduler; in learn it decides which facts get
  // taught, and in ordered it decides how much of the table has peeled — so
  // including `sittingEvents` is what makes a run played this sitting count.
  model = deriveMastery(knownEvents(), CONFIG);

  const session = newSessionId();
  const startBuckets = bucketSnapshot(model);
  const previousMedianMs = previousSessionMedian(knownEvents());

  // The item list. Drill picks one at a time, because each pick depends on the
  // outcome of the last. Both instruction modes decide the whole thing up front,
  // because their shape is fixed before the kid answers anything — and ordered
  // mode NEVER CALLS THE SCHEDULER at all: the run is a row of the table with
  // its cleared prefix trimmed, in table order, every time.
  //
  // Progress totals come from `plan.length`, NEVER from a config multiplication:
  // `pickLearnFacts` returns FEWER than learnFacts when eligibility runs out, and
  // a hard-coded 12 against a 8-item session would leave the bar stuck at 8/12
  // on a screen that has already moved on. The same holds harder in ordered mode,
  // where the run shortens by design as facts peel off the front — an eleven the
  // bar could not reach would be wrong on every visit after the first.
  let plan = null;
  if (mode === 'learn') {
    plan = buildLearnSession(pickLearnFacts(model, CONFIG), CONFIG);
  } else if (mode === 'ordered') {
    plan = runFor(model, table);
  }
  const total = plan === null ? CONFIG.sessionLength : plan.length;

  // A session with nothing in it is the failure the `canLearn` guard already
  // exists to prevent, and a deep link is the one way to ask for one: a table
  // whose facts have all cleared has an empty run, and the menu renders that row
  // as done and not as a control.
  //
  // FALL BACK TO THE MENU RATHER THAN RETURNING. Before the menu existed there
  // was nowhere to go, so this warned and stopped — which left the kid on a bare
  // stage under whatever the last session's progress bar said. There is a home
  // screen now, and every dead end must reach it: `?mode=ordered&table=2` on a
  // finished table is one route in, and the results screen's `[ The 3s ]` button
  // is another, since the model it chose that table from is a moment older than
  // the one this session derives.
  if (plan !== null && plan.length === 0) {
    console.warn(`math-game: nothing to play in ${mode}${table === null ? '' : ` table ${table}`}`);
    running = false;
    showMenu();
    return;
  }

  resultsRegion.hidden = true;
  menuRegion.hidden = true;
  stage.hidden = false;
  mountProblemScreen(stage);
  // The other half of the pair `showMenu` opens: the strip comes back, and the
  // count is set before the first problem appears rather than after it.
  topStrip.hidden = false;
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
    // INDEX, never by object identity, and nothing here writes to a fact. An
    // ordered run serves each of its facts exactly once, so it has no such
    // repeats — which is why its rung counts runs where learn's counts attempts.
    const fact = plan === null ? pickNext(model, history, CONFIG, rng) : plan[index];
    const id = factId(fact);

    // TRAP — PASS `mode` EXPLICITLY. `ladderFor`'s third parameter defaults to
    // `config.mode`, which USED TO BE the fallback for a URL with no query
    // string and is not the mode this session is running in. While that key
    // existed, `ladderFor(fact, CONFIG)` inside a learn session started from
    // `?mode=learn` returned the DRILL ladder: the kid got a hint-free screen
    // with no strategy and no button, the log recorded `stage: 'clean'` on
    // instruction attempts, and mastery's "clean means retrieval" rule quietly
    // started counting instruction as fluency. Nothing threw.
    //
    // `CONFIG.mode` is retired now, so the same slip throws instead of lying —
    // but the fix is unchanged and applies identically to ordered mode: pass it.
    const ladder = ladderFor(fact, CONFIG, mode);

    // Drill's reveal delay follows the fact's CURRENT bucket: a cold fact is
    // rescued in 4s, a hot one is made to wait 8s because by then the retrieval
    // effort is the exercise. The delay grows with mastery — that is not a typo.
    // NEITHER INSTRUCTION MODE HAS A DELAY AT ALL: null, not a large number, so
    // nothing downstream can mistake it for a very patient timer. In ordered
    // mode as in learn, the only thing that ever advances a problem is the kid.
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
    // Which mode produced these numbers. Without it a drill session cannot tell
    // whether the preceding session's median is comparable to its own, and
    // `previousSessionMedian` would compare a retrieval median against a
    // derivation median — the comparison spec §5 forbids. Absent means drill,
    // matching the attempt-event rule, so v1 history needs no migration.
    mode,
    // Which table an ordered run walked, written for ordered sessions ONLY. The
    // rungs do not need it — they derive the table from `fact.a` on the attempts
    // themselves, which is what keeps an abandoned run's evidence usable — so
    // this is for reading the log by eye and for the results screen. A `table` on
    // a drill line would be a column of nulls that reads as a real signal.
    ...(mode === 'ordered' ? { table } : {}),
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
 * Show the game's own home screen.
 *
 * The model is DERIVED HERE rather than reused, from the loaded tail plus
 * everything this sitting has played. That is what makes a run finished a moment
 * ago move its bar with no reload — and at startup it is the only thing that
 * builds a model at all, because nothing has run a session yet.
 *
 * @returns {void}
 */
function showMenu() {
  model = deriveMastery(knownEvents(), CONFIG);

  // TRAP — CLEAR AND HIDE THE TOP STRIP. See `topStrip`. It is outside all three
  // regions, so the swap below does not touch it, and the menu would otherwise
  // render under the finished session's `11 / 11`.
  renderProgress(shell, 0, 0);
  topStrip.hidden = true;

  stage.hidden = true;
  resultsRegion.hidden = true;
  menuRegion.hidden = false;
  renderMenu(menuRegion, model);
}

/**
 * A control on the results screen or on the menu. Registered once at startup for
 * each; both listeners are delegated on a container that outlives every screen
 * inside it, so they survive every re-render.
 *
 * One handler serves both screens because both ask for the same four things. A
 * mode name starts a new session in that mode with NO page reload — which is why
 * `runSession` re-derives everything rather than trusting module state left over
 * from the session that just ended.
 *
 * 'done' and 'menu' both land on the menu screen. THE RESULTS SCREEN NO LONGER
 * NAVIGATES: `Done` used to leave for games-menu.html, and now it returns to the
 * game's own home, where a bar has moved and the next thing to play is one press
 * away. Both names are accepted because results.js still sends 'done' and the
 * two mean the same thing here.
 *
 * 'games' is the ONE real navigation left in the app, and it comes from the
 * menu's "Back to all games" and nowhere else.
 *
 * 'ordered' needs a table and is refused without a valid one — the menu never
 * sends one without it, because a finished table renders as no control at all,
 * but a run over a row that does not exist is worth refusing rather than
 * discovering.
 *
 * @param {'learn' | 'drill' | 'ordered' | 'done' | 'menu' | 'games'} action
 * @param {number | null} [table] required for 'ordered', ignored otherwise
 * @returns {void}
 */
function onAction(action, table = null) {
  if (action === 'done' || action === 'menu') {
    showMenu();
    return;
  }
  if (action === 'games') {
    window.location.href = MENU_URL;
    return;
  }
  if (!MODES.includes(action) || running) {
    return;
  }
  if (action === 'ordered' && !isTable(table)) {
    return;
  }
  runSession(action, table).catch((error) => {
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

  // All four input routes are wired ONCE, before the first mount. Each is
  // delegated on a container that outlives every screen inside it, so remounting
  // cannot lose the wiring — and registering them per session, or per render,
  // would stack duplicate listeners. The menu is re-rendered every single time it
  // is shown, so it is the one most exposed to that mistake: a handler bound
  // inside `showMenu` would start N sessions on the Nth visit to the menu.
  document.addEventListener('keydown', onKeyDown);
  onRevealClick(stage, onReveal);
  onResultsAction(resultsRegion, onAction);
  onMenuAction(menuRegion, onAction);

  const mode = readMode();
  const table = readTable();

  // A URL with no recognised `?mode=`, or `?mode=ordered` without a table this
  // game has, is not an error and is not a session — it is a kid who has not
  // chosen yet, or a mistyped bookmark. Both land on the menu, which is the
  // normal way in: games-menu.html points here with no query string at all. The
  // deep links still bypass it — ?mode=drill, ?mode=learn, ?mode=ordered&table=N.
  if (mode === null || (mode === 'ordered' && table === null)) {
    showMenu();
    return;
  }

  await runSession(mode, table);
}

main().catch((error) => {
  console.error('math-game: session failed', error);
});
