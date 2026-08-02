// The wiring. One of exactly three impure modules under spelling-game/js/ — the
// others are log.js, which owns the network and the outbox, and audio.js, which
// owns the sound. `Date.now` and `Math.random` appear HERE and in log.js and
// nowhere else in this game, which is what keeps every other module replayable.
//
// The shape of a sitting:
//
//   serverIsUp -> flushOutbox -> loadEvents -> [ runSession(mode) -> results ]*
//
// Everything is re-derived at the top of every session. Nothing about the kid's
// level is stored: the frontier is computed from the log each time, which is why
// one codebase serves a four-year-old and a ten-year-old with no setting to get
// wrong and no profile to pick.

import { CONFIG } from './config.js';
import { SPINE } from './spine.js';
import { spellingSpace } from './space.js';
import { activeWindow } from './frontier.js';
import { typingCost, KEYMAP } from './typing-cost.js';
import { pickLearnFamily, buildLearnSession } from './learn.js';
import { createAudio } from './audio.js';
import { serverIsUp, loadEvents, record, flushOutbox } from './log.js';

import { deriveMastery } from '../../core/mastery.js';
import { pickNext } from '../../core/scheduler.js';
import { createEngine } from '../../core/engine.js';

import {
  mountWordScreen,
  renderWord,
  renderProgress,
  revealLadder,
  revealedCount,
  revealDelayMs,
} from './ui/word.js';
import { mountLearnScreen, renderLearn, onShowWord, learnLadder } from './ui/learn.js';
import { renderResults, onResultsAction } from './ui/results.js';

const MENU_URL = '../games-menu.html';
const MODES = ['learn', 'drill'];

// Let a finished word sit in the slots for a beat before the next one. Purely
// presentational: `resolvedAt` was stamped on the keystroke, so no logged number
// moves because of it.
const ADVANCE_HOLD_MS = 550;

// How often the reveal loop wakes. Fast enough that a letter lands when it
// should, slow enough to be invisible. Not a clock — nothing counts it down and
// nothing displays it.
const TICK_MS = 100;

const engine = createEngine(spellingSpace);
const audio = createAudio();

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
let tickTimer = null;

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

function modeFromUrl() {
  const asked = new URLSearchParams(window.location.search).get('mode');
  return MODES.includes(asked) ? asked : CONFIG.mode;
}

/** The word behind an id, via the model — total over the spine. */
function wordOf(model, id) {
  return model.byId.get(id).item.word;
}

function showNotice(title, body) {
  document.body.innerHTML =
    `<div class="startup-notice"><h1>${title}</h1>${body
      .map((line) => `<p>${line}</p>`)
      .join('')}</div>`;
}

// ---------------------------------------------------------------------------
// the reveal loop
// ---------------------------------------------------------------------------

// A drill problem's letters arrive on a timer; a learn problem's never do.
// `tick` is already a structural no-op on a learn ladder (core/engine.js reads
// `ladder[0] === 'strategy'`), so this loop is safe to run in both modes — but
// it is only STARTED for drill, so learn mode has no clock even accidentally.
function startTickLoop(mode, bucket, container) {
  stopTickLoop();
  tickTimer = setInterval(() => {
    if (active === null) {
      return;
    }
    const next = engine.tick(active.state, now(), revealDelayMs(active.state, bucket, CONFIG));
    // The engine returns its input BY REFERENCE when nothing happened. Comparing
    // identity is how we avoid re-rendering the screen ten times a second.
    if (next !== active.state) {
      active.state = next;
      renderWord(container, next, mode);
    }
  }, TICK_MS);
}

function stopTickLoop() {
  if (tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

// ---------------------------------------------------------------------------
// input
// ---------------------------------------------------------------------------

// Letters and Backspace only. Space is the word screen's own — it replays the
// audio — and there is NO submit key in either mode: the problem resolves when
// the typed length reaches the word's length, which the engine decides.
function onKeyDown(event) {
  if (active === null || event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }

  if (event.key === 'Backspace') {
    event.preventDefault();
    apply(engine.backspace(active.state, now()));
    return;
  }

  // Lower-cased so a kid with caps lock on, or a shifted letter, still spells.
  // The adapter accepts a-z only, and rejecting a capital would look to a
  // four-year-old like the keyboard had stopped working.
  const char = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (!spellingSpace.isTypableChar(char)) {
    return;
  }
  event.preventDefault();
  apply(engine.typeChar(active.state, char, now()));
}

function apply(next) {
  if (active === null || next === active.state) {
    return; // by-reference no-op: nothing happened, nothing to draw
  }
  active.state = next;
  renderWord(active.container, next, active.mode);
  if (next.status === 'correct') {
    active.resolve();
  }
}

/** Learn mode's "show me", pressed and held. */
function onReveal() {
  if (active === null) {
    return;
  }
  apply(engine.revealAnswer(active.state, now()));
}

// ---------------------------------------------------------------------------
// one problem
// ---------------------------------------------------------------------------

/**
 * Put one word on screen and resolve when it is spelled correctly.
 *
 * @returns {Promise<object>} the attempt event
 */
function runProblem(id, model, mode, container) {
  const item = model.byId.get(id).item;
  const bucket = model.byId.get(id).bucket;
  const ladder = mode === 'learn' ? learnLadder() : revealLadder(item.word);

  return new Promise((resolve) => {
    active = {
      container,
      mode,
      state: engine.startProblem(item, ladder, now()),
      resolve: () => {
        stopTickLoop();
        const state = active.state;
        active = null;

        const event = engine.toAttemptEvent(state, CONFIG, currentSession, mode);

        // THE REVEAL COUNT. core/engine.js writes `revealed` as a BOOLEAN and
        // only for learn attempts — right for the math game, where the reveal is
        // one button press, and not enough here. Spelling's help arrives one
        // letter at a time, so the NUMBER of letters the kid needed is the only
        // measure of how much scaffolding a word took: without it, a word
        // rescued on letter one and a word rescued on letter five are
        // indistinguishable in the log forever. It is written here rather than
        // in the core so math's event shape is untouched.
        //
        // `stage === 'clean'` iff `revealed === 0`, by construction — both are
        // read off the same ladder index.
        event.revealed = revealedCount(state, mode);

        resolve(event);
      },
    };

    renderWord(container, active.state, mode);
    audio.play(item.word);
    if (mode === 'drill') {
      startTickLoop(mode, bucket, container);
    }
  });
}

// ---------------------------------------------------------------------------
// a session
// ---------------------------------------------------------------------------

async function runSession(mode) {
  if (running) {
    return;
  }
  running = true;
  currentSession = sessionId();

  // Re-derived every session, never carried over. A continuation button starts a
  // new session with no page reload, so anything trusted from last time would be
  // stale exactly when it mattered.
  let model = deriveMastery(sittingEvents, CONFIG, spellingSpace);
  const startBuckets = new Map([...model.byId].map(([id, stats]) => [id, stats.bucket]));
  let frontierIds = activeWindow(SPINE, model, CONFIG.windowSize);

  // THE WHOLE SPINE IS HOT. `activeWindow` returns [] and core's `pickNext`
  // throws on an empty candidate set — deliberately, because for the math game
  // an empty set really is a caller bug. Here it is a state a kid reaches by
  // finishing, and it deserves an answer rather than a stack trace. Not fixed by
  // falling back to the whole spine, which would re-serve mastered words forever
  // with nothing to say she had finished.
  if (frontierIds.length === 0) {
    running = false;
    showNotice('You have spelled every word we have!', [
      'There are no words left in the list to practise.',
      'Ask a grown-up to add more — the list lives in <code>spelling-game/js/spine.js</code>.',
    ]);
    return;
  }

  stage.hidden = false;
  resultsRegion.hidden = true;

  const previousMedianMs = lastSessionMedian(mode);
  const previousFrontier = lastSessionFrontier();

  let order;
  let family = null;
  let container;

  if (mode === 'learn') {
    family = pickLearnFamily(model, frontierIds, CONFIG);
    order = buildLearnSession(family.words, CONFIG);
    const mounted = mountLearnScreen(stage);
    container = mounted.wordContainer;
    mountWordScreen(container, { audio });
    onShowWord(stage, onReveal);
  } else {
    order = null; // drill picks each word as it goes, against the live model
    container = stage;
    mountWordScreen(container, { audio });
  }

  const total = mode === 'learn' ? order.length : CONFIG.sessionLength;
  const history = [];
  const attempts = [];

  renderProgress(shell, 0, total);

  for (let index = 0; index < total; index += 1) {
    let id;
    if (mode === 'learn') {
      id = order[index];
    } else {
      // BOTH DIALS MEET HERE, AND NOWHERE ELSE. `candidates` is the frontier —
      // which words are in play at all — and `itemWeight` is typing difficulty,
      // a property of the word rather than of what the kid knows. They answer
      // different questions and are multiplied, so an awkward word is served
      // less often but never never (typingCost clamps to its own floor).
      id = pickNext({
        model,
        history,
        config: CONFIG,
        rng,
        space: spellingSpace,
        candidates: frontierIds,
        itemWeight: (candidateId) => typingCost(wordOf(model, candidateId), KEYMAP, CONFIG),
      });
    }

    if (mode === 'learn') {
      renderLearn(stage, { family, word: wordOf(model, id) });
    }

    const event = await runProblem(id, model, mode, container);

    // Not awaited. The kid never waits on I/O between words.
    record(event);
    sittingEvents.push(event);
    attempts.push(event);
    history.push(id);

    // Re-derive after every word. The success governor recovers each item's
    // outcome from the model's retained attempts, so a model that has not seen
    // this session is not merely blind — it is scored against the wrong
    // evidence. core/scheduler.js documents the measurement.
    model = deriveMastery(sittingEvents, CONFIG, spellingSpace);
    if (mode === 'drill') {
      frontierIds = activeWindow(SPINE, model, CONFIG.windowSize);
      if (frontierIds.length === 0) {
        break; // she finished the spine mid-session; the results screen still runs
      }
    }

    renderProgress(shell, history.length, total);

    if (index < total - 1) {
      await hold(ADVANCE_HOLD_MS);
    }
  }

  stopTickLoop();
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
    mode,
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
    mode,
    items,
    cleanRate,
    medianMs,
    previousMedianMs,
    moved: bucketMoves(startBuckets, model),
    window: frontierIds,
    frontier,
    previousFrontier,
    canLearn: true,
  };

  stage.hidden = true;
  resultsRegion.hidden = false;
  renderResults(resultsRegion, model, summary, CONFIG);

  running = false;
}

/**
 * How far along the spine the frontier has reached: the index of the last word
 * that is no longer cold. Derived, never stored — like everything else about
 * the kid's level.
 */
function frontierPosition(model) {
  let reached = 0;
  SPINE.forEach((entry, index) => {
    const stats = model.byId.get(spellingSpace.itemId(entry));
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
      moved.push({ id, word: stats.item.word, from: before, to: stats.bucket });
    }
  }
  return moved;
}

function lastSessionMedian(mode) {
  for (let index = sittingEvents.length - 1; index >= 0; index -= 1) {
    const event = sittingEvents[index];
    if (event.type === 'session' && (event.mode ?? 'drill') === mode) {
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
  if (!MODES.includes(action) || running) {
    return;
  }
  runSession(action).catch((error) => {
    console.error('spelling-game: session failed', error);
  });
}

async function main() {
  // REFUSE TO START RATHER THAN PLAY WITH NOWHERE TO SAVE. loadEvents() cannot
  // answer this — it returns [] both for "server down" and for "first run on a
  // new machine", which is right for it and wrong at boot. Without this check a
  // game served without its API plays perfectly and banks every word into an
  // outbox that may never flush: the kid sees her progress, and then does not.
  if (!(await serverIsUp())) {
    showNotice('Start the game first', [
      'This game needs its little server running so it can remember how you did.',
      'Double-click <code>play.command</code> in the games folder, then pick the spelling game from the menu that opens.',
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

  runSession(modeFromUrl()).catch((error) => {
    console.error('spelling-game: session failed', error);
  });
}

main().catch((error) => {
  console.error('spelling-game: startup failed', error);
});
