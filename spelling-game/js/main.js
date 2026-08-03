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
// level is stored: her placement — cursor, what she has finished with, what is
// worth drilling — is computed from the log each time, which is why one codebase
// serves a four-year-old and a ten-year-old with no setting to get wrong and no
// profile to pick.

import { CONFIG } from './config.js';
import { SPINE, playableSpine } from './spine.js';
import { spellingSpace } from './space.js';
import { pickLearnFamily, buildLearnSession } from './learn.js';
import { createAudio } from './audio.js';
import { hasHomophone } from './homophones.js';
import { derivePlacement } from './placement.js';
import { playableHash } from './playable-hash.js';
import { serverIsUp, loadEvents, record, flushOutbox } from './log.js';

import { deriveMastery } from '../../core/mastery.js';
import { typingCost, KEYMAP } from '../../core/typing-cost.js';
import { pickNext } from '../../core/scheduler.js';
import { createEngine } from '../../core/engine.js';

import {
  mountWordScreen,
  renderWord,
  renderProgress,
  revealLadder,
  revealedCount,
  revealDelayMs,
  flashWord,
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

/**
 * The player the word screen is given: `audio`, with every outcome reported.
 *
 * THE SCREEN IS THE ONLY THING THAT SPEAKS A PROBLEM. It used to be both — this
 * file called `audio.play` and `renderWord` called it again through
 * `speakNewWord`, so every word was played twice back to back and the second
 * call `stop()`ed the first. Inaudible, because the two were milliseconds apart,
 * and exactly the class of thing that produced a silent game this morning.
 *
 * The reason the duplicate existed is that `reportAudio` lives here: the screen
 * knew how to speak and this file knew how to notice silence. Wrapping the
 * player rather than calling it twice gives the screen both.
 */
const screenAudio = {
  play: (word) => audio.play(word).then(reportSpoken),
  preload: (word) => audio.preload(word),
  stop: () => audio.stop(),
};

/** Report an outcome and hand it back, so callers can still read it. */
function reportSpoken(outcome) {
  reportAudio(outcome);
  return outcome;
}

/**
 * The spine we actually draw from: SPINE trimmed to words with a pronunciation
 * on disk. Set once at startup by loadPlayable() and read by every session.
 *
 * It starts as the whole spine so that any path which skips startup — a test, a
 * future direct call — still gets a playable game rather than an empty one.
 *
 * NOTE THAT `spellingSpace.allItems` IS NOT TRIMMED, on purpose. That is the
 * item universe used to resolve ids, and a log written before the trim contains
 * events naming `said`. Narrowing it would make those events unresolvable and
 * quietly drop real history the kid earned. The trim belongs at the FRONTIER —
 * which words get served — not at the space, which is what the ids mean.
 */
let PLAYABLE = SPINE;

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

// How many words in a row may come out silent before we say so. One is a
// blocked first play, which is ordinary: browsers refuse sound until the page
// has been interacted with, and the very first word of a session arrives before
// the kid has touched a key. Two in a row means it is not coming.
const SILENT_WORDS_BEFORE_WARNING = 2;

let silentRun = 0;
let audioWarned = false;

/**
 * React to what `audio.play` actually managed to do.
 *
 * A SILENT SPELLING GAME IS AN UNPLAYABLE ONE, and this is the difference
 * between this game and the other two. Drill asks "spell the word you just
 * heard". A kid who heard nothing sees an empty row of boxes and no way at all
 * to know what is wanted — and, because the reveal is on a timer, the screen
 * then starts filling itself in while she sits there. That reads as a broken
 * game, and it is exactly what happened in testing: an mp3 404 followed by a
 * speech utterance Chrome queued and never started, with nothing thrown, nothing
 * logged, and `speechSynthesis.speaking` reporting true throughout.
 *
 * So it gets said out loud, once, in words a kid can act on.
 *
 * @param {'mp3' | 'tts' | 'silent'} outcome
 */
function reportAudio(outcome) {
  if (outcome !== 'silent') {
    silentRun = 0;
    return;
  }
  silentRun += 1;
  if (silentRun < SILENT_WORDS_BEFORE_WARNING || audioWarned) {
    return;
  }
  audioWarned = true;
  console.warn(
    'spelling-game: no sound. The cached mp3 is missing and speech synthesis did not start. ' +
      'Common causes: the tab is in the background, the tab is muted, or no words have been ' +
      'fetched yet (tools/fetch-words.js).',
  );
  showAudioWarning();
}

/**
 * A persistent, calm line telling the kid the sound is not working. Rendered
 * once into the shell rather than into a screen, so it survives the word
 * changing and the session ending.
 */
function showAudioWarning() {
  if (document.querySelector('.audio-warning') !== null) {
    return;
  }
  const note = document.createElement('p');
  note.className = 'audio-warning';
  note.setAttribute('role', 'status');
  note.textContent = 'No sound — ask a grown-up to check the volume.';
  shell.append(note);
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
async function runProblem(id, model, mode, container) {
  const item = model.byId.get(id).item;
  const bucket = model.byId.get(id).bucket;
  const ladder = mode === 'learn' ? learnLadder() : revealLadder(item.word);

  // THE HOMOPHONE FLASH — a fix to the QUESTION, not help with the answer.
  //
  // Drill plays a sound and shows empty boxes. For `sea` that is not a question:
  // `see` is an equally correct reading of everything the kid was told, so she
  // can be entirely right and be marked wrong. No improvement to the audio fixes
  // it. Eight such sets are in the spine today (docs/next-steps.md item 1).
  //
  // So for those words only, the word is shown while it is spoken, then taken
  // away and spelled from memory.
  //
  // BEFORE `startProblem`, WHICH IS THE WHOLE POINT OF DOING IT HERE. The clock
  // starts when the problem does, so reading time is not response time —
  // otherwise every homophone would look slow against `hotMs`, never go hot,
  // and sit in the frontier for ever. Nothing about the flash reaches the
  // engine: `revealed` stays 0 and the attempt can still be `clean`.
  //
  // Learn mode is excluded because the word is already on screen there
  // throughout, so a flash would be showing her what she is looking at.
  const flashed = mode === 'drill' && hasHomophone(item.word);
  if (flashed) {
    flashWord(container, item.word);
    // Spoken explicitly, because the screen's own `speakNewWord` fires off a
    // ProblemState and there is not one yet — that is the point of flashing
    // before the problem starts. Not awaited: the word is already on screen and
    // the sound should land under it, not after it.
    screenAudio.play(item.word);
    await hold(CONFIG.homophoneFlashMs);
  }

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

        // Recorded so the log can tell the two prompts apart. NOT a hint count
        // and deliberately not folded into `revealed`: the flash states the
        // question, it does not help with the answer, and a replay that treated
        // it as scaffolding would score every homophone as assisted for ever.
        if (flashed) {
          event.flashed = true;
        }

        resolve(event);
      },
    };

    // This speaks the word: renderWord -> speakNewWord, once per ProblemState,
    // through screenAudio so the outcome is still reported. There is no second
    // call here any more; see screenAudio.
    //
    // A flashed word is therefore said twice — once under the word while it
    // shows, and again as the empty slots appear. That is deliberate. The second
    // one lands on "now spell it", which for a homophone is the moment the
    // question actually gets asked.
    renderWord(container, active.state, mode);
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
  let placement = derivePlacement(model, PLAYABLE, CONFIG, hasHomophone);

  // SHE HAS FINISHED THE CATALOGUE. Nothing left to drill and nothing left to
  // probe is the real end of this game, and it deserves an answer rather than a
  // stack trace: core's `pickNext` throws on an empty candidate set —
  // deliberately, because for the math game an empty set really is a caller bug.
  // Here it is a state a kid reaches by finishing.
  //
  // Not fixed by falling back to the whole spine, which would re-serve
  // marked-off words for ever with nothing to say she had finished.
  if (nothingLeft(placement)) {
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
  // Read BEFORE the session writes its own event, or "since last time" compares
  // this session against itself and always reports no movement.
  const previousMarked = lastSessionMarked();

  let order;
  let family = null;
  let container;

  if (mode === 'learn') {
    // The lesson is built from words she has MET AND NOT FINISHED WITH — the
    // drill set — rather than from a slice of the spine. A lesson about words
    // she has never seen teaches nothing she asked for, and a word she got
    // right first time does not need a lesson at all.
    //
    // Which does mean an empty drill set has no lesson in it: a fresh log has
    // met nothing, so there is nothing to teach until she has played some drill.
    //
    // The SIBLINGS come from the other argument — the whole playable list,
    // marked-off words included — because the words she already owns are the
    // analogy that cracks the one she does not. PLAYABLE rather than SPINE: a
    // sibling with no recording would be a silent problem mid-lesson.
    family = pickLearnFamily(model, placement.drill, PLAYABLE, CONFIG);
    order = buildLearnSession(family.words, CONFIG);
    const mounted = mountLearnScreen(stage);
    container = mounted.wordContainer;
    mountWordScreen(container, { audio: screenAudio });
    onShowWord(stage, onReveal);
  } else {
    order = null; // drill picks each word as it goes, against the live model
    container = stage;
    mountWordScreen(container, { audio: screenAudio });
  }

  const total = mode === 'learn' ? order.length : CONFIG.sessionLength;
  const history = [];
  const attempts = [];

  // One probe every this many problems. Derived rather than configured, because
  // what matters is the RATIO — `probesPerSession` probes per `sessionLength`
  // problems — and storing both the ratio and the interval is two numbers that
  // can disagree. Floored at 1 so a config with more probes than problems asks
  // for probes throughout rather than dividing its way to zero or NaN.
  const probeEvery = Math.max(1, Math.round(CONFIG.sessionLength / CONFIG.probesPerSession));

  renderProgress(shell, 0, total);

  for (let index = 0; index < total; index += 1) {
    let id;
    if (mode === 'learn') {
      id = order[index];
    } else {
      // The words in play: the drill set, or the queue behind it in the odd case
      // where one is empty and the other is not. Reading `pending` as a fallback
      // costs a comparison and means a later change to how `drillCap` is applied
      // cannot turn into an empty-candidate throw halfway through a session.
      const candidates = placement.drill.length > 0 ? placement.drill : placement.pending;

      // THE PROBE SLOT. Every `probeEvery`-th problem asks a word she has never
      // met, drawn at random from the WHOLE catalogue rather than from anywhere
      // near her frontier. That is how a word she can already spell gets found
      // and retired without her having to earn it three times over, and it is
      // the entire placement mechanism — which is why there is no placement
      // screen and why NOTHING HERE MARKS A PROBLEM AS A PROBE. Same audio, same
      // reveal ladder, same homophone flash, same logged event shape. She must
      // not be able to tell she is being tested, or she is being tested.
      //
      // Counted from the START of the session rather than the end, because a
      // sitting that gets abandoned halfway should still have contributed its
      // share of probes. A probe is the only problem that tells us something we
      // did not already have on file, and sessions do get walked away from.
      //
      // AN EMPTY DRILL SET MAKES EVERY PROBLEM A PROBE, and that is not
      // special-cased because it must not be: a fresh log has met nothing, so
      // the first session is all probes and doubles as the placement test. It
      // then turns into ordinary play with no mode switch and nothing for her
      // to notice.
      const wantsProbe = index % probeEvery === 0 || candidates.length === 0;
      if (wantsProbe && placement.probePool.length > 0) {
        // Uniform over the pool. `probePool` comes back in spine order because
        // placement.js is pure and may not shuffle; the randomness is this
        // file's to own, and it is the same injected `rng` the scheduler uses.
        id = placement.probePool[Math.floor(rng() * placement.probePool.length)];
      } else {
        // BOTH DIALS MEET HERE, AND NOWHERE ELSE. `candidates` is the drill set
        // — which words are in play at all — and `itemWeight` is typing
        // difficulty, a property of the word rather than of what the kid knows.
        // They answer different questions and are multiplied, so an awkward word
        // is served less often but never never (typingCost clamps to its own
        // floor).
        id = pickNext({
          model,
          history,
          config: CONFIG,
          rng,
          space: spellingSpace,
          candidates,
          itemWeight: (candidateId) => typingCost(wordOf(model, candidateId), KEYMAP, CONFIG),
        });
      }
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
      // Re-derived for the same reason the model is. It is also what stops a
      // probe repeating inside one session: the word she just answered now has
      // a first sighting, so it has left `probePool` by the next draw — no
      // separate seen-set to keep, and it stays true across a page reload.
      placement = derivePlacement(model, PLAYABLE, CONFIG, hasHomophone);
      if (nothingLeft(placement)) {
        break; // she finished the catalogue mid-session; the results screen still runs
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

    // WORDS FINISHED WITH, and the number the results screen now reports
    // against the catalogue. It is written onto the event rather than derived
    // at read time for one reason: `marked` depends on `markSpanSessions` and
    // on the homophone list, so a count re-derived next year under a changed
    // constant would silently disagree with what she was shown at the time.
    // The derived-on-read view stays authoritative for PLAY; this is the
    // receipt for what the screen SAID.
    marked: placement.marked.size,

    // THE ITEM SPACE THIS SESSION WAS PLAYED AGAINST. PLAYABLE is built from the
    // audio cache on disk and is therefore NOT a function of the log, which
    // makes every session in this file unreplayable without it: a replay months
    // from now rebuilds the word list from whatever the cache holds THEN and
    // silently plays a different game. That is not hypothetical — 401 words had
    // no pronunciation on 2026-08-02 and have one now, which is exactly why
    // replaying those sessions reproduces none of them (docs/next-steps.md
    // item 6).
    //
    // Two fields because they fail differently. The count says how much the item
    // space moved; the hash says whether it moved at all, including the case
    // where one word was swapped for another and the count did not budge.
    //
    // Order never reaches the hash — PLAYABLE is a filter over SPINE, so it is
    // in spine order however /api/audio happened to list the cache, and
    // playable-hash.js sorts besides. An order-sensitive hash would be worse
    // than no hash, because it would report an item space that kept changing
    // when it had not.
    playableCount: PLAYABLE.length,
    playableHash: playableHash(PLAYABLE.map((entry) => entry.word)),
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
    // The WHOLE placement, not the drill list and the marked count separately.
    // They are two views of one partition of the spine, and handing them over as
    // two fields is how the screen would come to claim she had finished
    // everything while still listing words she was on.
    //
    // Current as of the last problem in drill mode, where it is re-derived after
    // every word. In learn mode it is the start-of-session value and that is
    // still correct: learn attempts are excluded from mastery evidence, so
    // nothing a learn session does can move a word into `marked`.
    placement,
    previousMarked,
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
 * Is there any word left to serve?
 *
 * Three of the five placement sets, and the two that are left out are the point.
 * `marked` is finished with by definition. `deferred` is a word she missed while
 * it was out of reach, and it is deliberately NOT servable — releasing those is
 * the whole design, and counting them here would keep the game running on words
 * she has no traction on and call that progress.
 *
 * `pending` is the queue behind `drill` and cannot be non-empty while `drill` is
 * empty under today's cap. It is read anyway so this stays the question "is
 * there anything left?" rather than "is the served list empty?" — only the first
 * one is still correct if how the cap is applied ever changes.
 *
 * @param {import('./placement.js').Placement} placement
 * @returns {boolean}
 */
function nothingLeft(placement) {
  return (
    placement.drill.length === 0 &&
    placement.pending.length === 0 &&
    placement.probePool.length === 0
  );
}

/**
 * How far along the spine the frontier has reached: the index of the last word
 * that is no longer cold. Derived, never stored — like everything else about
 * the kid's level.
 */
function frontierPosition(model) {
  let reached = 0;
  PLAYABLE.forEach((entry, index) => {
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

/**
 * Words finished with as of the last session that recorded the count.
 *
 * Not filtered by mode, unlike `lastSessionMedian`. A median is only comparable
 * against the same activity — learn and drill are different exercises with
 * different keystroke loads — but a marked count is a fact about the whole
 * catalogue and does not care which screen she was on when it moved.
 *
 * `null` on a first run, and on every `s1` session, which predate the field.
 * The results screen reads that as "first session" rather than as no movement,
 * which is the honest answer: we do not know what it was.
 */
function lastSessionMarked() {
  for (let index = sittingEvents.length - 1; index >= 0; index -= 1) {
    const event = sittingEvents[index];
    if (event.type === 'session' && Number.isFinite(event.marked)) {
      return event.marked;
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

/**
 * Ask the server which words have a pronunciation, and trim the spine to them.
 *
 * Failure is not an error here. A server without the endpoint, a network blip, a
 * malformed body — every one of them leaves PLAYABLE as the whole spine, which
 * is the behaviour a fresh clone with no cache needs anyway. There is nothing a
 * kid could do about it and nothing worth interrupting her for.
 *
 * What IS worth saying, to the console, is how many words got dropped. A trim is
 * invisible on screen — the game just quietly never offers `said` — and a silent
 * trim of the wrong size is the kind of thing that goes unnoticed for months.
 */
async function loadPlayable() {
  let words = null;
  try {
    const response = await fetch('/api/audio');
    if (response.ok) {
      const body = await response.json();
      if (Array.isArray(body?.words)) {
        words = body.words;
      }
    }
  } catch {
    // Offline, or an older server. Keep the whole spine.
  }

  PLAYABLE = playableSpine(SPINE, words);

  if (PLAYABLE.length === SPINE.length) {
    console.info(
      `spelling-game: ${SPINE.length} words, none trimmed` +
        (words === null || words.length === 0 ? ' (no audio cache — words will be spoken)' : ''),
    );
    return;
  }
  const dropped = SPINE.filter((entry) => !PLAYABLE.includes(entry)).map((entry) => entry.word);
  console.info(
    `spelling-game: playing ${PLAYABLE.length} of ${SPINE.length} words; ` +
      `${dropped.length} have no pronunciation and were trimmed: ${dropped.join(' ')}`,
  );
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

  // Before the first session, because runSession reads PLAYABLE immediately.
  await loadPlayable();

  document.addEventListener('keydown', onKeyDown);
  onResultsAction(resultsRegion, onAction);

  runSession(modeFromUrl()).catch((error) => {
    console.error('spelling-game: session failed', error);
  });
}

main().catch((error) => {
  console.error('spelling-game: startup failed', error);
});
