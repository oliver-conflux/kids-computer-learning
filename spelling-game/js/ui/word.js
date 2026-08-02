// The word screen — the DOM half of the loop, and the same screen in both modes.
//
// RENDERING IS A PURE FUNCTION OF STATE. This module holds no game state of its
// own. It owns no timer, it never calls the engine, and it never listens for a
// letter key. main.js owns the clock, the randomness and the typing, and calls
// in here whenever the state it holds has changed. Everything below is therefore
// idempotent: rendering the same ProblemState twice produces the same DOM and no
// side effects. The idiom, the WeakMaps and the pulse guard are lifted from
// math-game/js/ui/problem.js deliberately — a kid moving between the two games
// should not meet two different screens, and a maintainer should not meet two
// different idioms.
//
// TWO EXCEPTIONS, both of which are TRANSITIONS rather than states:
//
//   - the wrong-answer pulse. See `renderPulse`; that comment is the important
//     one in this file and it is the math game's, unchanged, because the trap it
//     describes is the same trap.
//   - SAYING THE WORD. Audio is not decoration here the way it would be in math:
//     it is the entire prompt. Nothing on screen says which word to spell, in
//     either mode, so a word that is never spoken is a row of empty boxes. It is
//     said once when a new word arrives and again whenever the kid presses
//     Space, and both of those are transitions.
//
// WHAT IS DIFFERENT FROM MATH, and it is one thing: the answer arrives ONE
// LETTER AT A TIME, left to right, greyed into the slots. Math reveals its whole
// answer in one step because "42" has no useful halfway house. A word does: a
// word handed over whole is copied, and a word handed over letter by letter is
// still partly retrieved. The ladder therefore has a rung per letter, and this
// module reads how many letters to show off the LADDER INDEX rather than off a
// count of its own — see `revealedCount`.
//
// NO SUBMIT KEY, in either mode. The engine evaluates when the typed length
// reaches the word length (core/engine.js). There is no Enter handler here and
// there must not be one: `frend` for `friend` is one letter short and keeps
// waiting, which is exactly the behaviour the slots make visible.
//
// NO CLOCK IS EVER DRAWN. Not a countdown, not a bar, not an elapsed reading, in
// either mode. The strip along the top counts WORDS. Time is measured
// relentlessly by the engine and never shown.
//
// Exports: mountWordScreen, renderWord, renderProgress, revealLadder,
// revealedCount, revealDelayMs.

import { spellingSpace } from '../space.js';
import { itemKeyOf } from '../../../core/space.js';

/**
 * The state field holding the Word. Read from the adapter rather than written as
 * `'item'` here, because that name is the space's choice — the math game calls
 * its items `fact` — and a screen that hard-codes it breaks silently the day the
 * binding changes.
 */
const ITEM_KEY = itemKeyOf(spellingSpace);

/**
 * The prefix for a reveal rung. Stage names reach the log, so this string is
 * part of the log's vocabulary: `clean`, `r1`, `r2`. It lives here because this
 * module is the one that builds the ladder and the one that reads it back.
 */
const REVEAL_STAGE_PREFIX = 'r';

/** The first rung. `stage === 'clean'` iff nothing was revealed — spec §8. */
const CLEAN_STAGE = 'clean';

/** How long the amber pulse runs. Must match --pulse-ms in base.css. */
const PULSE_MS = 400;

/** Last ProblemState rendered per container, kept BY REFERENCE for the pulse. */
const lastRendered = new WeakMap();

/** Pending pulse-clear timers, one per container. */
const pulseTimers = new WeakMap();

/** The audio player each mounted container was given, or null. */
const players = new WeakMap();

/** The `word#startedAt` key of the last word spoken into each container. */
const spokenFor = new WeakMap();

/** Containers that already carry their delegated listeners. */
const wiredContainers = new WeakSet();

/**
 * Build the word screen's skeleton inside `container`, replacing whatever was
 * there. Call once per screen; `renderWord` calls it for you if the skeleton is
 * missing, so mounting is never a precondition you can get wrong.
 *
 * Every node both modes need is built here and afterwards only ever has its
 * CONTENT changed — no render creates or destroys a node mid-problem, which is
 * half of why the word cannot move while the kid is thinking. The other half is
 * in word.css.
 *
 * THE AUDIO PLAYER IS INJECTED, not constructed. main.js builds one
 * `createAudio()` for the whole session and hands it in; this module only ever
 * calls `play`. Passing nothing is legal and gives a silent screen, which is
 * what the tests and any future caller that wants to own the sound itself get.
 *
 * @param {Element} container the node this screen owns and clears
 * @param {{audio?: {play: (word: string) => unknown}}} [options]
 * @returns {Element} the .word-screen root
 */
export function mountWordScreen(container, options = {}) {
  container.textContent = '';

  const screen = el('section', 'word-screen');
  screen.dataset.stage = CLEAN_STAGE;
  screen.dataset.mode = 'drill';

  // The prompt line. It carries no word — the word is the thing being asked for
  // — only the button that says it again and the reminder of which key does
  // that. Present in BOTH modes: in learn the family is on screen but the target
  // is not, so audio is the only thing naming what to spell there too.
  const prompt = el('div', 'word-prompt', { role: 'prompt' });
  const replay = el('button', 'word-prompt__button', { role: 'replay' });
  replay.type = 'button';
  replay.textContent = '🔊';
  replay.setAttribute('aria-label', 'Hear the word again');
  const hint = el('p', 'word-prompt__hint', {}, 'space to hear it again');
  prompt.append(replay, hint);

  const slots = el('div', 'slots', { role: 'slots' });

  screen.append(prompt, slots);
  container.append(screen);

  players.set(container, options.audio ?? null);
  lastRendered.delete(container);
  spokenFor.delete(container);
  wire(container);

  return screen;
}

/**
 * Render one ProblemState. Safe to call on every frame — the same state object
 * rendered twice is a no-op, including for the pulse and for the audio.
 *
 * `mode` is a parameter rather than a field on the state for the reason math's
 * problem.js gives: what mode a problem is in is a property of the SESSION, and
 * main.js is the only thing that knows it. It defaults to 'drill' so a caller
 * that forgets gets the mode whose help is timed rather than the one whose help
 * is on screen from the first frame.
 *
 * @param {Element} container the element mountWordScreen was given
 * @param {object} state ProblemState from core/engine.js
 * @param {'drill'|'learn'} [mode]
 * @returns {void}
 */
export function renderWord(container, state, mode = 'drill') {
  // The audio player is carried across a re-mount deliberately: it was given at
  // mount time and a screen that silently rebuilt itself without one would leave
  // the kid with a row of boxes and nothing telling her which word they are for.
  const screen =
    container.querySelector('.word-screen') ??
    mountWordScreen(container, { audio: players.get(container) });

  screen.dataset.stage = state.stage;
  screen.dataset.mode = mode === 'learn' ? 'learn' : 'drill';

  renderSlots(screen, state, mode);
  renderPulse(container, screen, state);
  speakNewWord(container, state);
}

/**
 * The progress strip: `done` of `total` words, plus the bar's fill.
 *
 * `done` counts words COMPLETED. It starts at 0 and reaches `total` only when
 * the session is over — it is not the 1-based index of the word on screen. "7 /
 * 20" reads plausibly as either, so: while the kid is spelling the eighth word
 * having finished seven, this shows "7 / 20", and the label and the bar are then
 * always the same fraction of finished work.
 *
 * It lives in this file rather than in a shell module because the math game's
 * equivalent lives in its problem.js, and index.html documents the name. Pass it
 * the shell.
 *
 * NOTE: no elapsed time, no countdown, no timer bar is rendered here or anywhere
 * else in this module. The bar counts WORDS.
 *
 * @param {Element} shell an element containing the .progress markup
 * @param {number} done words completed, 0..total
 * @param {number} total words in the session
 * @returns {void}
 */
export function renderProgress(shell, done, total) {
  const bar = shell.matches('.progress') ? shell : shell.querySelector('.progress');
  const count = shell.querySelector('.progress__count');
  if (bar === null && count === null) {
    return;
  }

  const safeTotal = total > 0 ? total : 0;
  const safeDone = clamp(done, 0, safeTotal);
  const fraction = safeTotal === 0 ? 0 : safeDone / safeTotal;

  if (bar !== null) {
    bar.style.setProperty('--progress', String(fraction));
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(safeTotal));
    bar.setAttribute('aria-valuenow', String(safeDone));
  }
  if (count !== null) {
    count.textContent = `${safeDone} / ${safeTotal}`;
  }
}

/**
 * The drill ladder for one word: `['clean', 'r1', 'r2', … 'rN']`, N letters.
 *
 * THE LADDER IS WHERE PROGRESSIVE REVEAL ACTUALLY LIVES. There is no reveal
 * timer in this module and no letter counter anywhere: the engine advances one
 * rung per `revealDelayMs`, a wrong answer advances exactly one rung because
 * that is what `stageAfter` does, and the number of letters showing is simply
 * the index of the current rung. Longer words get proportionally more
 * scaffolding for free, with no rule needed (spec §8).
 *
 * The last rung shows the whole word, so a stuck kid always reaches something
 * they can type. That is the same terminal help math's single `reveal` rung
 * gives, arrived at gradually.
 *
 * `stage === 'clean'` is therefore true exactly when zero letters were revealed,
 * which is the log's definition of a clean attempt (spec §8) and what
 * `deriveMastery` already keys on unchanged.
 *
 * Pure. main.js calls it when it starts a drill problem.
 *
 * @param {string} word
 * @returns {string[]} the ladder, `word.length + 1` rungs
 */
export function revealLadder(word) {
  const letters = typeof word === 'string' ? word.length : 0;
  const ladder = [CLEAN_STAGE];
  for (let i = 1; i <= letters; i += 1) {
    ladder.push(`${REVEAL_STAGE_PREFIX}${i}`);
  }
  return ladder;
}

/**
 * How many letters are showing, given the state and the mode.
 *
 * Read off the LADDER INDEX rather than off the stage name, so the two cannot
 * disagree and a differently-named ladder still renders correctly.
 *
 * LEARN IS ALWAYS ZERO, and this is not an oversight. Learn mode's help is the
 * family on screen and the press-and-hold button (spec §6), never a letter that
 * arrives on its own — learn has no clock, and its wrong answers do not advance
 * the stage. But its ladder is `['strategy','reveal']` and pressing "show me"
 * moves the stage to the last rung, which by index alone would grey the first
 * letter into the slots at the very moment the kid is trying to hold the whole
 * word in their head. The mode gate is what stops that.
 *
 * Pure, and the seam the reveal is tested through.
 *
 * @param {object} state ProblemState
 * @param {'drill'|'learn'} [mode]
 * @returns {number} 0..ladder.length - 1
 */
export function revealedCount(state, mode = 'drill') {
  if (mode === 'learn' || state === null || typeof state !== 'object') {
    return 0;
  }
  const ladder = Array.isArray(state.ladder) ? state.ladder : [];
  const index = ladder.indexOf(state.stage);
  return index > 0 ? index : 0;
}

/**
 * How long the engine should dwell on the current rung before showing the next
 * letter — the value main.js passes as `tick`'s `delayMs`.
 *
 * TWO VALUES, BECAUSE ONE CANNOT DO BOTH JOBS (spec §8). `delays[bucket]` is the
 * RETRIEVAL WINDOW before the first letter, and it GROWS WITH MASTERY: a new
 * word is rescued soonest, which is what keeps acquisition errorless, and a
 * nearly-mastered one is made to work for it because at that point the effort is
 * the whole point. This looks backwards, is not, and is the rule most likely to
 * be reverted by accident. `letterStepMs` is flat and brisk: once the first
 * letter is up the kid is being walked through the word rather than thinking,
 * and a per-letter `delays` value would take half a minute to spell `elephant`.
 *
 * An unknown bucket falls back to `cold` — the shortest window, so a corrupt or
 * missing mastery entry rescues the kid sooner rather than leaving them staring
 * at empty boxes for eight seconds.
 *
 * Pure. Every quantity comes from `config`.
 *
 * @param {object} state ProblemState
 * @param {'cold'|'warm'|'hot'} bucket the word's mastery bucket
 * @param {{delays: object, letterStepMs: number}} config
 * @returns {number} milliseconds
 */
export function revealDelayMs(state, bucket, config) {
  const ladder = Array.isArray(state.ladder) ? state.ladder : [];
  const onFirstRung = ladder.indexOf(state.stage) <= 0;
  if (!onFirstRung) {
    return config.letterStepMs;
  }
  const delays = config.delays ?? {};
  return delays[bucket] ?? delays.cold;
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

/**
 * One slot per letter, filled left to right from `state.typed`, with the
 * revealed letters greyed into the slots the kid has not reached.
 *
 * The help lands INSIDE the slots because that is where the kid is already
 * looking — the same decision, and the same reason, as the math game's revealed
 * answer. Slots are rebuilt only when the count changes, so a re-render never
 * destroys a node that is mid-animation.
 *
 * `--letters` drives the type scale in word.css. It is the word's own length,
 * not a tunable: an eight-letter word has to fit on one line at whatever size
 * that takes, and a word that wrapped would move the row it is on.
 */
function renderSlots(screen, state, mode) {
  const slots = find(screen, 'slots');
  const word = wordOf(state);
  const letters = word.length;

  if (slots.childElementCount !== letters) {
    slots.textContent = '';
    for (let i = 0; i < letters; i += 1) {
      slots.append(el('span', 'slot'));
    }
  }
  slots.style.setProperty('--letters', String(Math.max(letters, 1)));

  const typed = state.typed ?? '';
  const shown = Math.min(revealedCount(state, mode), letters);

  for (let i = 0; i < letters; i += 1) {
    const slot = slots.children[i];
    if (i < typed.length) {
      slot.textContent = typed[i];
      slot.dataset.state = 'filled';
    } else if (i < shown) {
      slot.textContent = word[i];
      slot.dataset.state = 'revealed';
    } else {
      slot.textContent = '';
      // The slot the next letter lands in carries the accent ring; the rest are
      // plain. It is the only positional feedback there is, and it is enough.
      slot.dataset.state = i === typed.length ? 'next' : 'empty';
    }
  }
}

/**
 * The wrong-answer flash — and the one genuinely subtle thing in this file.
 *
 * FIRE ON THE TRANSITION, NOT ON THE STATE. `state.pulse` is not a "flash now"
 * flag that something clears; it stays true on the state object until the next
 * transition replaces it, and `tick` returns the SAME OBJECT BY REFERENCE when
 * nothing happened — so a loop calling `tick -> renderWord` hands us the same
 * pulsing state over and over. Rendering the animation whenever `state.pulse` is
 * true re-fires the amber at the polling rate: a strobe, not a pulse.
 *
 * So the guard is object IDENTITY against the last state rendered into this
 * container. That is exactly the set of wrong answers, including two wrong
 * answers in a row, which really are two distinct pulsing objects and really
 * should flash twice.
 *
 * The attribute is removed and re-set with a forced reflow in between, because a
 * CSS animation does not replay on an element that already has it applied.
 *
 * Note what does NOT happen here: nothing is marked red and left standing, and
 * no letter is rejected as it is typed. The amber clears itself, the engine has
 * already cleared the entry, and one more letter arrives — a wrong answer buys
 * help (spec §7.2).
 */
function renderPulse(container, screen, state) {
  const previous = lastRendered.get(container);
  const isNewState = previous !== state;
  lastRendered.set(container, state);

  if (!isNewState || !state.pulse) {
    return;
  }

  const pending = pulseTimers.get(container);
  if (pending !== undefined) {
    clearTimeout(pending);
  }

  screen.removeAttribute('data-pulse');
  void screen.offsetWidth; // force reflow so the animation restarts
  screen.dataset.pulse = 'on';

  pulseTimers.set(
    container,
    setTimeout(() => {
      screen.removeAttribute('data-pulse');
      pulseTimers.delete(container);
    }, PULSE_MS),
  );
}

/**
 * Say the word, once, when a NEW word appears.
 *
 * Keyed on the word plus `startedAt` rather than on state identity, because
 * every keystroke produces a new state object and the kid would hear the word
 * again on each one. `startedAt` is what distinguishes two problems on the same
 * word — the cycled repeats a learn session is made of — so both get spoken.
 *
 * Failure is silent by construction: audio.js falls forward from a missing mp3
 * to speech synthesis to nothing at all, and never throws. A machine with no
 * cache and no voice plays the game in silence rather than not at all.
 */
function speakNewWord(container, state) {
  const player = players.get(container);
  const word = wordOf(state);
  if (player === null || player === undefined || word === '') {
    return;
  }

  const key = `${word}#${state.startedAt}`;
  if (spokenFor.get(container) === key) {
    return;
  }
  spokenFor.set(container, key);
  play(container);
}

/**
 * Say whatever word is currently on screen. Used by Space and by the button.
 */
function play(container) {
  const player = players.get(container);
  const state = lastRendered.get(container);
  if (player === null || player === undefined || state === undefined) {
    return;
  }
  const word = wordOf(state);
  if (word !== '') {
    player.play(word);
  }
}

/**
 * Wire the replay affordances, once per container.
 *
 * SPACE IS FREE, and that is why it is the replay key: words on the spine are
 * lowercase a–z with no spaces, so the kid can never mean to type one (spec §6).
 *
 * The keydown listener is on the DOCUMENT because the kid types straight at the
 * page — there is no input element to focus and no submit key. It bows out when
 * the event started on a button, which is what keeps it from fighting learn
 * mode's press-and-hold: Space on the focused "show me" button shows the word,
 * Space anywhere else says it. `preventDefault` stops the page scrolling under
 * the kid, which on a short page is invisible and on a long one is not.
 *
 * The click listener is delegated to the container rather than bound to the
 * button, because `mountWordScreen` builds a fresh button every time it runs and
 * a listener on the button would be thrown away with it — the kind of bug that
 * only shows up on the second session.
 */
function wire(container) {
  if (wiredContainers.has(container)) {
    return;
  }
  wiredContainers.add(container);

  container.addEventListener('click', (event) => {
    const target = event.target;
    if (target === null || typeof target.closest !== 'function') {
      return;
    }
    if (target.closest('[data-role="replay"]') !== null) {
      play(container);
    }
  });

  container.ownerDocument.addEventListener('keydown', (event) => {
    if (event.key !== ' ' && event.code !== 'Space') {
      return;
    }
    if (!container.isConnected || container.querySelector('.word-screen') === null) {
      return;
    }
    const target = event.target;
    if (target !== null && typeof target.closest === 'function' && target.closest('button') !== null) {
      return; // the button has its own meaning for this key
    }
    event.preventDefault();
    play(container);
  });
}

/**
 * The word this state is about, or '' if the state carries no usable item — a
 * screen must not throw a session away over a malformed state.
 */
function wordOf(state) {
  const item = state?.[ITEM_KEY];
  if (item === null || item === undefined) {
    return '';
  }
  const word = spellingSpace.targetOf(item);
  return typeof word === 'string' ? word : '';
}

function el(tag, className, dataset = {}, text = '') {
  const node = document.createElement(tag);
  node.className = className;
  for (const [key, value] of Object.entries(dataset)) {
    node.dataset[key] = value;
  }
  if (text !== '') {
    node.textContent = text;
  }
  return node;
}

function find(screen, role) {
  return screen.querySelector(`[data-role="${role}"]`);
}

function clamp(value, low, high) {
  return Math.min(Math.max(value, low), high);
}
