// The wiring. One of exactly two impure modules under geography-game/js/ — the
// other is log.js, which owns the network and the outbox. `Date.now` and
// `Math.random` appear HERE and in log.js and nowhere else in this game, which
// is what keeps every other module replayable.
//
// The shape of a sitting:
//
//   serverIsUp -> flushOutbox -> loadEvents -> [ runSession() -> results ]*
//
// Everything is re-derived at the top of every session. Nothing about the kid's
// level is stored: the frontier is computed from the log each time, which is why
// one codebase serves a four-year-old and a ten-year-old with no setting to get
// wrong and no profile to pick.
//
// THIS FILE IS spelling-game/js/main.js WITH TWO THINGS REMOVED AND ONE ADDED.
// Removed: learn mode, because this game has one activity, and the audio player,
// because the prompt is on screen rather than in the air. Added: the prompt
// dispatch, which is the only place in the game that cares whether an item is a
// map or a flag — everything downstream of the scheduler treats them as two
// ordinary items that happen to share an answer.

import { CONFIG } from './config.js';
import { SPINE } from './spine.js';
import { geographySpace } from './space.js';
import { serverIsUp, loadEvents, record, flushOutbox } from './log.js';

import { deriveMastery } from '../../core/mastery.js';
import { activeWindow } from '../../core/frontier.js';
import { typingCost, KEYMAP } from '../../core/typing-cost.js';
import { pickNext } from '../../core/scheduler.js';
import { createEngine } from '../../core/engine.js';

import {
  mountCountryScreen,
  promptHost,
  renderCountry,
  renderProgress,
  revealLadder,
  revealedCount,
  onRevealClick,
} from './ui/country.js';
import { renderMap } from './ui/map.js';
import { renderFlag } from './ui/flag.js';
import { renderResults, onResultsAction } from './ui/results.js';

const MENU_URL = '../games-menu.html';

// Every attempt this game writes is a drill attempt. Passed explicitly rather
// than left to core/engine.js's default: mastery.js excludes learn attempts from
// its evidence, so the field is load-bearing and an absent one is a promise that
// the default will not change.
const MODE = 'drill';

// Let a finished country sit in the slots for a beat before the next one. Purely
// presentational: `resolvedAt` was stamped on the keystroke, so no logged number
// moves because of it.
const ADVANCE_HOLD_MS = 550;

const engine = createEngine(geographySpace);

/**
 * Spine entry by id. Built once — the spine does not change at runtime — and
 * used only by `itemWeight`, which the scheduler calls once per candidate per
 * problem and which must not walk 344 entries to answer.
 */
const byId = new Map(SPINE.map((entry) => [geographySpace.itemId(entry), entry]));

const now = () => Date.now();
const rng = () => Math.random();

const shell = document.getElementById('shell');
const stage = document.getElementById('stage');
const resultsRegion = document.getElementById('results');

/** Events loaded at startup, plus everything this sitting has written. */
let sittingEvents = [];
/** The problem currently on screen, or null between problems. */
let active = null;
/** Set while a session is running, so a stray click cannot start a second one. */
let running = false;
/** The id stamped on this session's events. */
let currentSession = null;

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function hold(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function median(values) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function sessionId() {
  return `s_${Math.floor(rng() * 0x10000)
    .toString(16)
    .padStart(4, '0')}`;
}

function showNotice(title, body) {
  document.body.innerHTML =
    `<div class="startup-notice"><h1>${title}</h1>${body
      .map((line) => `<p>${line}</p>`)
      .join('')}</div>`;
}

// ---------------------------------------------------------------------------
// the two dials
// ---------------------------------------------------------------------------

/**
 * The typing dial. A country's name carries a keyboard burden that is not
 * geography knowledge — Kyrgyzstan, Liechtenstein, Turkmenistan — so an awkward
 * name is served less often and never excluded (typingCost clamps to its own
 * floor). This is the same hook, the same module and the same reasoning as the
 * spelling game; promoting typingCost into core is what made it available.
 *
 * A FLAG ITEM PAYS ITS SHAPE SIBLING'S COST, because the word it asks for is the
 * same word. Nothing special is needed for that — both entries carry the same
 * `target`, so both get the same number, which is the correct answer and is why
 * this reads as one line.
 */
const itemWeight = (id) => typingCost(byId.get(id).target, KEYMAP, CONFIG);

/**
 * The prompt. THE ONLY PLACE IN THE GAME THAT BRANCHES ON `kind`.
 *
 * Everything below the scheduler — the engine, mastery, the frontier, the slots
 * — sees two ordinary items that happen to share an answer. That is what the
 * typed answer bought: two completely different questions reach the same core
 * with no core change, and adding a third prompt would be one more branch here
 * and nothing anywhere else.
 *
 * Drawn ONCE per problem rather than on every keystroke; see promptHost.
 */
function renderPrompt(container, item) {
  const host = promptHost(container);
  if (item.kind === 'shape') {
    renderMap(host, item, CONFIG);
  } else {
    renderFlag(host, item);
  }
}

// ---------------------------------------------------------------------------
// input
// ---------------------------------------------------------------------------

/**
 * Letters and Backspace only. There is NO submit key: the problem resolves when
 * the typed length reaches the name's length, which the engine decides.
 *
 * THE SPACE BAR DOES NOTHING, and that is the whole handling of multi-word
 * names on the input side. `Costa Rica` is typed `costarica`;
 * `geographySpace.isTypableChar` returns false for a space, so the keystroke
 * falls out of the guard below and no slot advances. The gap the kid sees
 * between `costa` and `rica` is drawn by the slot grouping (js/ui/country.js)
 * and is never something to type. `preventDefault` is deliberately NOT called
 * for it: the shell is exactly one viewport tall while a problem is up, so there
 * is nothing for the page to scroll, and swallowing a key this file does not
 * handle is how a browser default gets broken somewhere else later.
 */
function onKeyDown(event) {
  if (active === null || event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }

  if (event.key === 'Backspace') {
    event.preventDefault();
    apply(engine.backspace(active.state, now()));
    return;
  }

  // Lower-cased so a kid with caps lock on, or a shifted letter, still answers.
  // The adapter accepts a-z only, and rejecting a capital would look to a
  // four-year-old like the keyboard had stopped working.
  const char = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (!geographySpace.isTypableChar(char)) {
    return;
  }
  event.preventDefault();
  apply(engine.typeChar(active.state, char, now()));
}

/**
 * The kid pressed "I don't know". Jump to the last rung of the ladder, which
 * puts the whole name on screen.
 *
 * NOT LOGGED AS A WRONG ANSWER, and that distinction is the point. `wrong` is
 * read by the scheduler's interference guard as evidence that two countries are
 * confusable; "I don't know" is evidence of no such thing. `revealAnswer` moves
 * the stage and sets `revealed`, so the attempt is correctly not clean and
 * cannot count as retrieval — the country stays cold and comes back.
 *
 * Safe to call at any time: `revealAnswer` on a state already at the last rung
 * returns that state BY REFERENCE, so `apply` sees no change and does not
 * redraw. That is also why no guard is needed for a double click.
 */
function revealCurrent() {
  if (active === null) {
    return;
  }
  apply(engine.revealAnswer(active.state, now()));
}

function apply(next) {
  if (active === null || next === active.state) {
    return; // by-reference no-op: nothing happened, nothing to draw
  }
  active.state = next;
  renderCountry(active.container, next);
  if (next.status === 'correct') {
    active.resolve();
  }
}

// ---------------------------------------------------------------------------
// one problem
// ---------------------------------------------------------------------------

/**
 * Put one country on screen and resolve when its name is typed correctly.
 *
 * @returns {Promise<object>} the attempt event
 */
function runProblem(id, model, container) {
  const item = model.byId.get(id).item;
  const ladder = revealLadder(geographySpace.targetOf(item));

  return new Promise((resolve) => {
    // BEFORE startProblem, so the clock does not start while the browser is
    // still laying out 172 paths. The difference is small; the direction of the
    // error is not, and every millisecond of it lands on `hotMs`.
    renderPrompt(container, item);

    active = {
      container,
      state: engine.startProblem(item, ladder, now()),
      resolve: () => {
        const state = active.state;
        active = null;

        const event = engine.toAttemptEvent(state, CONFIG, currentSession, MODE);

        // THE REVEAL COUNT. core/engine.js writes `revealed` as a BOOLEAN and
        // only for learn attempts — right for the math game, where the reveal is
        // one button press, and not enough here. Help arrives one letter at a
        // time, so the NUMBER of letters the kid needed is the only measure of
        // how much scaffolding a country took: without it, a country rescued on
        // letter one and one rescued on letter five are indistinguishable in the
        // log forever. Written here rather than in the core so math's event
        // shape is untouched, exactly as the spelling game does it.
        //
        // `stage === 'clean'` iff `revealed === 0`, by construction — both are
        // read off the same ladder index.
        event.revealed = revealedCount(state);

        resolve(event);
      },
    };

    renderCountry(container, active.state);
  });
}

// ---------------------------------------------------------------------------
// a session
// ---------------------------------------------------------------------------

async function runSession() {
  if (running) {
    return;
  }
  running = true;
  currentSession = sessionId();

  // Re-derived every session, never carried over. The continuation button starts
  // a new session with no page reload, so anything trusted from last time would
  // be stale exactly when it mattered.
  let model = deriveMastery(sittingEvents, CONFIG, geographySpace);
  const startBuckets = new Map([...model.byId].map(([id, stats]) => [id, stats.bucket]));
  let frontierIds = activeWindow(SPINE, model, CONFIG.windowSize, geographySpace);

  // THE WHOLE SPINE IS HOT. `activeWindow` returns [] and core's `pickNext`
  // throws on an empty candidate set — deliberately, because for the math game
  // an empty set really is a caller bug. Here it is a state a kid reaches by
  // finishing, and it deserves an answer rather than a stack trace. Not fixed by
  // falling back to the whole spine, which would re-serve mastered countries
  // forever with nothing to say she had finished.
  if (frontierIds.length === 0) {
    running = false;
    showNotice('You have named every country we have!', [
      'There are no countries left in the list to practise.',
      'Ask a grown-up to add more — the list lives in <code>geography-game/js/spine.js</code>.',
    ]);
    return;
  }

  stage.hidden = false;
  resultsRegion.hidden = true;

  const previousMedianMs = lastSessionMedian();
  const previousFrontier = lastSessionFrontier();

  mountCountryScreen(stage);
  onRevealClick(stage, revealCurrent);

  const total = CONFIG.sessionLength;
  const history = [];
  const attempts = [];

  renderProgress(shell, 0, total);

  for (let index = 0; index < total; index += 1) {
    // BOTH DIALS MEET HERE, AND NOWHERE ELSE. `candidates` is the frontier —
    // which items are in play at all — and `itemWeight` is typing difficulty, a
    // property of the name rather than of what the kid knows. They answer
    // different questions and are multiplied, so an awkward name is served less
    // often but never never.
    const id = pickNext({
      model,
      history,
      config: CONFIG,
      rng,
      space: geographySpace,
      candidates: frontierIds,
      itemWeight,
    });

    const event = await runProblem(id, model, stage);

    // Not awaited. The kid never waits on I/O between countries.
    record(event);
    sittingEvents.push(event);
    attempts.push(event);
    history.push(id);

    // Re-derive after every problem. The success governor recovers each item's
    // outcome from the model's retained attempts, so a model that has not seen
    // this session is not merely blind — it is scored against the wrong
    // evidence. core/scheduler.js documents the measurement.
    model = deriveMastery(sittingEvents, CONFIG, geographySpace);
    frontierIds = activeWindow(SPINE, model, CONFIG.windowSize, geographySpace);
    if (frontierIds.length === 0) {
      break; // she finished the spine mid-session; the results screen still runs
    }

    renderProgress(shell, history.length, total);

    if (index < total - 1) {
      await hold(ADVANCE_HOLD_MS);
    }
  }

  active = null;

  const items = attempts.length;
  const cleanCount = attempts.filter((event) => event.stage === 'clean').length;
  const cleanRate = items === 0 ? 0 : cleanCount / items;
  const medianMs = median(attempts.map((event) => event.ms));
  const frontier = frontierPosition(model);

  // TRAP — `t` MUST be toISOString(). core/mastery.js orders events by comparing
  // `t` as a plain string, which is chronological only while every writer emits
  // the UTC Z-suffixed format. A local offset makes lexicographic order stop
  // matching time order, silently and permanently, in an append-only file.
  const sessionEvent = {
    type: 'session',
    t: new Date(now()).toISOString(),
    build: CONFIG.build,
    session: currentSession,
    mode: MODE,
    items,
    cleanRate,
    medianMs,
    // The one number that answers "is she progressing?", and the reason this
    // event exists at all.
    frontier,
  };
  record(sessionEvent);
  sittingEvents.push(sessionEvent);

  const summary = {
    session: currentSession,
    items,
    cleanRate,
    medianMs,
    previousMedianMs,
    moved: bucketMoves(startBuckets, model),
    window: frontierIds,
    frontier,
    previousFrontier,
  };

  stage.hidden = true;
  resultsRegion.hidden = false;
  renderResults(resultsRegion, model, summary, CONFIG);

  running = false;
}

/**
 * How far along the spine the frontier has reached: the index of the last item
 * that is no longer cold. Derived, never stored — like everything else about the
 * kid's level.
 */
function frontierPosition(model) {
  let reached = 0;
  SPINE.forEach((entry, index) => {
    const stats = model.byId.get(geographySpace.itemId(entry));
    if (stats !== undefined && stats.bucket !== 'cold') {
      reached = index + 1;
    }
  });
  return reached;
}

function bucketMoves(startBuckets, model) {
  const moved = [];
  for (const [id, stats] of model.byId) {
    const before = startBuckets.get(id);
    if (before !== undefined && before !== stats.bucket) {
      moved.push({ id, from: before, to: stats.bucket });
    }
  }
  return moved;
}

function lastSessionMedian() {
  for (let index = sittingEvents.length - 1; index >= 0; index -= 1) {
    const event = sittingEvents[index];
    if (event.type === 'session') {
      return event.medianMs ?? null;
    }
  }
  return null;
}

function lastSessionFrontier() {
  for (let index = sittingEvents.length - 1; index >= 0; index -= 1) {
    const event = sittingEvents[index];
    if (event.type === 'session' && Number.isFinite(event.frontier)) {
      return event.frontier;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// startup
// ---------------------------------------------------------------------------

function onAction(action) {
  if (action === 'done') {
    window.location.href = MENU_URL;
    return;
  }
  if (action !== 'play' || running) {
    return;
  }
  runSession().catch((error) => {
    console.error('geography-game: session failed', error);
  });
}

async function main() {
  // REFUSE TO START RATHER THAN PLAY WITH NOWHERE TO SAVE. loadEvents() cannot
  // answer this — it returns [] both for "server down" and for "first run on a
  // new machine", which is right for it and wrong at boot. Without this check a
  // game served without its API plays perfectly and banks every country into an
  // outbox that may never flush: the kid sees her progress, and then does not.
  if (!(await serverIsUp())) {
    showNotice('Start the game first', [
      'This game needs its little server running so it can remember how you did.',
      'Double-click <code>play.command</code> in the games folder, then pick the country game from the menu that opens.',
    ]);
    return;
  }

  // TRAP — FLUSH BEFORE READING. A previous session that lost the server queued
  // its events. They must land on disk BEFORE the tail is read, or they arrive
  // after it and this session's mastery is derived from a history missing
  // everything the last one recorded. The wrong order fails silently: the file
  // ends up complete, so nothing looks wrong afterwards.
  await flushOutbox();
  sittingEvents = await loadEvents();

  document.addEventListener('keydown', onKeyDown);
  onResultsAction(resultsRegion, onAction);

  runSession().catch((error) => {
    console.error('geography-game: session failed', error);
  });
}

main().catch((error) => {
  console.error('geography-game: startup failed', error);
});
