// typing-game/js/main.js
//
// Wiring. One of exactly two impure modules (the other is log.js): this is
// where the DOM, the clock, and the network meet the pure core.
//
// Date.now() lives HERE and nowhere else — the engine takes time as an injected
// `at` so it stays testable without a browser.

import { lessonById, nextLesson } from './curriculum.js';
import { itemsFor } from './content.js';
// `stats` is deliberately not imported: a round spans many items, so its
// accuracy and wpm are accumulated across them here rather than read off a
// single item's state.
import { start, press, backspace, isComplete, nextChar } from './engine.js';
import { renderKeyboard, flashWrong } from './keyboard.js';
import { renderHands } from './hands.js';
import { loadSettings, saveSettings } from './settings.js';
import { loadEvents, record, flushOutbox } from './log.js';
import { forLesson, starsFor } from './progress.js';
import {
  renderLines, renderPrompt, renderProgress, applyGuidance,
  highlightNext, showResults, hideResults, shakeLine,
} from './ui.js';

// Declared before anything can reference it — finishItem and finishRound both
// stamp it onto their events.
const sessionId = `s_${Math.random().toString(36).slice(2, 8)}`;
const BUILD = 't1';

let settings = loadSettings();
let lesson = null;
let items = [];
let itemIndex = 0;
let state = null;
let roundKeystrokes = 0;
let roundErrors = 0;
let roundBestStreak = 0;
let roundStartedAt = null;
let shiftSide = null;

/** Track which Shift is down. keydown on a letter only exposes a boolean. */
function watchShift() {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') shiftSide = e.code;
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') shiftSide = null;
  });
}

function scaleStage() {
  const stage = document.getElementById('stage');
  const available = Math.min(document.body.clientWidth - 32, 924);
  stage.style.transform = `scale(${available / 924})`;
}

function startItem() {
  state = start(items[itemIndex], { blockOnError: settings.blockOnError });
  renderLines(state);
  renderPrompt(state, { name: settings.name, hint: lesson.hint });
  renderProgress(itemIndex, items.length);
  // Per ITEM, not per lesson: guidanceForItem's new-key exception is about what
  // the kid can see, so the deck and hands have to be shown for that item too.
  // Applying the lesson-wide setting once would leave a new-key drill lighting
  // keys on a hidden keyboard.
  applyGuidance(guidanceForItem());
  highlightNext(nextChar(state), guidanceForItem());
}

/**
 * A drill containing a not-yet-mastered new key always renders at Full,
 * whatever the setting says — you cannot learn a new key's finger without being
 * shown it (spec §1). Words and sentences in the same round follow the setting,
 * so the hands-off badge is still earnable on a new-key lesson.
 */
function guidanceForItem() {
  const isDrill = itemIndex < lesson.mix.drills;
  const hasNewKey = lesson.newKeys.some((k) => items[itemIndex].includes(k));
  return isDrill && hasNewKey ? 3 : settings.guidance;
}

function finishItem() {
  roundKeystrokes += state.keystrokes;
  roundErrors += state.errors;
  roundBestStreak = Math.max(roundBestStreak, state.bestStreak);

  record({
    type: 'item',
    t: new Date().toISOString(),
    build: BUILD,
    session: sessionId,
    lesson: lesson.id,
    kind: itemKind(itemIndex),
    text: state.text,
    keystrokes: state.keystrokes,
    errors: state.errors,
    ms: state.finishedAt - state.startedAt,
    guidance: guidanceForItem(),
    blockOnError: settings.blockOnError,
    misses: state.misses,
  });

  itemIndex += 1;
  if (itemIndex >= items.length) finishRound();
  else startItem();
}

function itemKind(i) {
  if (i < lesson.mix.drills) return 'drill';
  if (i < lesson.mix.drills + lesson.mix.words) return 'word';
  return 'sentence';
}

function finishRound() {
  const accuracy = roundKeystrokes === 0 ? 1 : (roundKeystrokes - roundErrors) / roundKeystrokes;
  const minutes = (Date.now() - roundStartedAt) / 60000;
  const wpm = minutes <= 0 ? 0 : items.join('').length / 5 / minutes;
  const stars = starsFor(accuracy);

  record({
    type: 'round',
    t: new Date().toISOString(),
    build: BUILD,
    session: sessionId,
    lesson: lesson.id,
    items: items.length,
    accuracy,
    wpm,
    bestStreak: roundBestStreak,
    guidance: settings.guidance,
    handsOff: stars === 3 && settings.guidance <= 1,
  });

  renderProgress(items.length, items.length);
  showResults(
    {
      stars, accuracy, wpm, bestStreak: roundBestStreak,
      canStepDown: stars === 3 && settings.guidance > 0,
      hasNext: nextLesson(lesson.id) !== null,
    },
    {
      onAgain: () => playLesson(lesson.id),
      onNext: () => playLesson(nextLesson(lesson.id).id),
      onStepDown: () => {
        settings = { ...settings, guidance: settings.guidance - 1 };
        saveSettings(settings);
        playLesson(lesson.id);
      },
    },
  );
}

function onKeyDown(e) {
  if (state === null || isComplete(state)) return;
  if (e.key === 'Backspace') {
    e.preventDefault();
    state = backspace(state);
    renderLines(state);
    highlightNext(nextChar(state), guidanceForItem());
    return;
  }
  if (e.key.length !== 1) return; // ignore Tab, arrows, modifiers
  e.preventDefault();

  const before = state;
  state = press(state, { key: e.key, shiftSide, at: Date.now() });
  const wasWrong = state.errors > before.errors;

  if (wasWrong) shakeLine();
  renderLines(state);
  renderPrompt(state, { name: settings.name, hint: lesson.hint });
  highlightNext(nextChar(state), guidanceForItem());

  // AFTER highlightNext, not before: highlighting the next key clears every
  // is-next and is-wrong class on the deck, so a flash raised first is wiped in
  // the same task and never paints.
  if (wasWrong) flashWrong(e.key);

  if (isComplete(state)) finishItem();
}

function playLesson(id) {
  hideResults();
  lesson = lessonById(id);
  items = itemsFor(id, Math.random);
  itemIndex = 0;
  roundKeystrokes = 0;
  roundErrors = 0;
  roundBestStreak = 0;
  roundStartedAt = Date.now();
  settings = { ...settings, lastLesson: id };
  saveSettings(settings);

  document.getElementById('lesson-title').textContent = lesson.title;
  startItem(); // applies this item's guidance itself
}

async function boot() {
  renderKeyboard(document.getElementById('keyboard'));
  renderHands(document.getElementById('hands'));
  scaleStage();
  window.addEventListener('resize', scaleStage);
  watchShift();
  window.addEventListener('keydown', onKeyDown);

  await flushOutbox();
  const events = await loadEvents();
  const resume = settings.lastLesson ?? 'home-base';
  console.log('progress', forLesson(events, resume));
  playLesson(resume);
}

boot();
