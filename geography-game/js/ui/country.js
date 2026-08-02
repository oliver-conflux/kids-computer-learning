// The country screen — the prompt region and the row of name slots.
//
// RENDERING IS A PURE FUNCTION OF STATE. This module holds no game state of its
// own. It owns no timer, never calls the engine, and never listens for a letter
// key. main.js owns the clock, the randomness and the typing, and calls in here
// whenever the state it holds has changed. Rendering the same ProblemState twice
// therefore produces the same DOM and no side effects. The idiom, the WeakMap
// and the pulse guard are lifted from spelling-game/js/ui/word.js deliberately —
// a kid moving between the games should not meet two different screens, and a
// maintainer should not meet two different idioms.
//
// THE ONE THING THAT IS NEW HERE: THE SLOTS ARE GROUPED INTO WORDS.
//
// The engine's target is letters only. `Costa Rica` is typed as `costarica`,
// which is what preserves the a-z invariant the shared core is built on and why
// core/engine.js needed no change for this game (see js/space.js). But a kid
// shown nine undifferentiated boxes for `Costa Rica` is being asked a different
// and harder question than the one we mean: they have to know the name AND
// where its word break falls, and getting the break wrong is not a geography
// mistake. So `slotGroups` reads the word breaks off `item.name` — the display
// name, which is the only place they exist — and the slots are laid out in
// groups with a visible gap between them, while the engine only ever sees
// letters. The space bar does nothing at all: `geographySpace.isTypableChar`
// returns false for it, so the gap is drawn, never typed.
//
// The reconciliation in `slotGroups` is the guard that makes that safe. If the
// name's letters ever stopped summing to the target's length — a rename, a
// stray accent, a build that changed `normalize` — the groups would silently
// drop or duplicate slots and the country would be unanswerable, because there
// would be no slot for a letter the engine is waiting on. It falls back to one
// ungrouped run instead, which is ugly and playable rather than pretty and dead.
//
// NO SUBMIT KEY. The engine evaluates when the typed length reaches the target
// length (core/engine.js). There is no Enter handler here and there must not be
// one: `belgum` for `belgium` is one letter short and keeps waiting, which is
// exactly the behaviour the slots make visible.
//
// NO CLOCK IS EVER DRAWN. Not a countdown, not a bar, not an elapsed reading.
// The strip along the top counts COUNTRIES. Time is measured relentlessly by the
// engine and never shown.
//
// Exports: mountCountryScreen, promptHost, renderCountry, renderProgress,
// slotGroups, revealLadder, revealedCount.

import { geographySpace } from '../space.js';
import { itemKeyOf } from '../../../core/space.js';

/**
 * The state field holding the country. Read from the adapter rather than
 * written as `'item'` here, because that name is the space's choice — the math
 * game calls its items `fact` — and a screen that hard-codes it breaks silently
 * the day the binding changes.
 */
const ITEM_KEY = itemKeyOf(geographySpace);

/**
 * The prefix for a reveal rung. Stage names reach the log, so this string is
 * part of the log's vocabulary: `clean`, `r1`, `r2`. It lives here because this
 * module is the one that builds the ladder and the one that reads it back, and
 * it is the same vocabulary the spelling log uses so one reader serves both.
 */
const REVEAL_STAGE_PREFIX = 'r';

/** The first rung. `stage === 'clean'` iff nothing was revealed. */
const CLEAN_STAGE = 'clean';

/** How long the amber pulse runs. Must match --pulse-ms in base.css. */
const PULSE_MS = 400;

/** Last ProblemState rendered per container, kept BY REFERENCE for the pulse. */
const lastRendered = new WeakMap();

/** Pending pulse-clear timers, one per container. */
const pulseTimers = new WeakMap();

/**
 * Build the screen's skeleton inside `container`, replacing whatever was there.
 * Call once per session; `renderCountry` calls it for you if the skeleton is
 * missing, so mounting is never a precondition you can get wrong.
 *
 * Every node the screen needs is built here and afterwards only ever has its
 * CONTENT changed. No render creates or destroys the prompt region or the slot
 * row, which is half of why the name cannot move while the kid is thinking; the
 * other half is the fixed prompt height in prompt.css.
 *
 * @param {Element} container the node this screen owns and clears
 * @returns {Element} the .country-screen root
 */
export function mountCountryScreen(container) {
  container.textContent = '';

  const screen = el('section', 'country-screen');
  screen.dataset.stage = CLEAN_STAGE;

  // The prompt region. main.js fills it with a map or a flag, once per problem
  // — see promptHost. It is a fixed height in both cases so the slots below it
  // sit in the same place for every country.
  const prompt = el('div', 'prompt', { role: 'prompt' });
  const slots = el('div', 'slots', { role: 'slots' });

  screen.append(prompt, slots);
  container.append(screen);

  lastRendered.delete(container);

  return screen;
}

/**
 * The node a prompt renderer draws into.
 *
 * THE PROMPT IS DRAWN ONCE PER PROBLEM, NOT ONCE PER KEYSTROKE, which is why it
 * is filled by the caller rather than by `renderCountry`. A map prompt is 172
 * `<path>` elements; rebuilding it on every letter would be wasteful, and worse,
 * would replace the node mid-keystroke and make the image flicker under a kid
 * who is mid-word. main.js calls this once when a problem starts.
 *
 * @param {Element} container the element mountCountryScreen was given
 * @returns {Element} the .prompt region
 */
export function promptHost(container) {
  const screen = container.querySelector('.country-screen') ?? mountCountryScreen(container);
  return find(screen, 'prompt');
}

/**
 * Render one ProblemState's slots. Safe to call on every keystroke — the same
 * state object rendered twice is a no-op, including for the pulse.
 *
 * Does NOT touch the prompt region. See promptHost.
 *
 * @param {Element} container the element mountCountryScreen was given
 * @param {object} state ProblemState from core/engine.js
 * @returns {void}
 */
export function renderCountry(container, state) {
  const screen = container.querySelector('.country-screen') ?? mountCountryScreen(container);

  screen.dataset.stage = state.stage;

  renderSlots(screen, state);
  renderPulse(container, screen, state);
}

/**
 * The progress strip: `done` of `total` countries, plus the bar's fill.
 *
 * `done` counts countries COMPLETED. It starts at 0 and reaches `total` only
 * when the session is over — it is not the 1-based index of the country on
 * screen. "7 / 20" reads plausibly as either, so: while the kid is naming the
 * eighth country having finished seven, this shows "7 / 20", and the label and
 * the bar are then always the same fraction of finished work.
 *
 * NOTE: no elapsed time, no countdown, no timer bar is rendered here or anywhere
 * else in this module. The bar counts COUNTRIES.
 *
 * @param {Element} shell an element containing the .progress markup
 * @param {number} done countries completed, 0..total
 * @param {number} total countries in the session
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
 * How many slots each visible word of `name` gets, guaranteed to sum to
 * `letters`.
 *
 * The ONLY place the word breaks in a country's name exist is the display name:
 * the engine's target has had them stripped, deliberately (js/space.js). So this
 * reads them off `name`, counting only the characters that become target
 * letters — `Guinea-Bissau` is one group of twelve, because the hyphen is not
 * typed and drawing a slot for it would invite a kid to try.
 *
 * THE SUM CHECK IS THE POINT, not a formality. Groups that did not sum to the
 * target's length would draw the wrong number of slots, and a missing slot means
 * a letter the engine is waiting for has nowhere to land — a country that can
 * never be answered, with nothing thrown and nothing logged. The fallback gives
 * up the word gap and keeps the game playable, which is the right way round.
 *
 * Pure. Exported for tests.
 *
 * @param {string} name the display name, e.g. 'Costa Rica'
 * @param {number} letters the target's length, e.g. 9
 * @returns {number[]} slot counts per group, summing to `letters`
 */
export function slotGroups(name, letters) {
  const groups = String(name ?? '')
    .split(' ')
    .map((part) => part.replace(/[^A-Za-z]/g, '').length)
    .filter((count) => count > 0);

  const total = groups.reduce((sum, count) => sum + count, 0);
  return total === letters ? groups : [letters];
}

/**
 * The hint ladder for one country: `['clean', 'r1', 'r2', … 'rN']`, N letters.
 *
 * THE LADDER IS WHERE PROGRESSIVE REVEAL ACTUALLY LIVES. There is no letter
 * counter anywhere: the engine advances exactly one rung per wrong answer
 * because that is what `stageAfter` does, and the number of letters showing is
 * simply the index of the current rung. Longer names get proportionally more
 * scaffolding for free, with no rule needed.
 *
 * The last rung shows the whole name, so a kid who keeps guessing always reaches
 * something they can type.
 *
 * `stage === 'clean'` is therefore true exactly when zero letters were revealed,
 * which is the log's definition of a clean attempt and what `deriveMastery`
 * already keys on unchanged.
 *
 * NOTE WHAT IS ABSENT: no rung is reached by elapsed time. The spelling game
 * greys a letter in on a timer because a kid who heard the word is retrieving a
 * spelling and can be rescued into it; there is no equivalent here and this
 * game's CONFIG carries no delay to run one on. Help is bought with a wrong
 * answer and by nothing else.
 *
 * Pure. Exported for tests. main.js calls it when it starts a problem.
 *
 * @param {string} target the typed answer, letters only
 * @returns {string[]} the ladder, `target.length + 1` rungs
 */
export function revealLadder(target) {
  const letters = typeof target === 'string' ? target.length : 0;
  const ladder = [CLEAN_STAGE];
  for (let i = 1; i <= letters; i += 1) {
    ladder.push(`${REVEAL_STAGE_PREFIX}${i}`);
  }
  return ladder;
}

/**
 * How many letters are showing, given the state.
 *
 * Read off the LADDER INDEX rather than off the stage name, so the two cannot
 * disagree and a differently-named ladder still renders correctly.
 *
 * Pure, and the seam the reveal is tested through. It also reaches the log:
 * main.js writes it onto the attempt event, because the NUMBER of letters a
 * country needed is the only measure of how much scaffolding it took.
 *
 * @param {object} state ProblemState
 * @returns {number} 0..ladder.length - 1
 */
export function revealedCount(state) {
  if (state === null || typeof state !== 'object') {
    return 0;
  }
  const ladder = Array.isArray(state.ladder) ? state.ladder : [];
  const index = ladder.indexOf(state.stage);
  return index > 0 ? index : 0;
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

/**
 * One slot per letter, grouped into the name's words, filled left to right from
 * `state.typed`, with revealed letters greyed into the slots the kid has not
 * reached.
 *
 * The help lands INSIDE the slots because that is where the kid is already
 * looking — the same decision, and the same reason, as the spelling game's
 * revealed letters and the math game's revealed answer.
 *
 * THE FLAT ORDER IS THE GROUP ORDER. Slots live inside `.slot-group` wrappers,
 * so the index the engine's `typed` counts against is recovered with one
 * document-order query rather than by walking groups and keeping a running
 * offset. Document order and letter order are the same order by construction,
 * and saying so once here is cheaper than an index arithmetic that has to stay
 * correct.
 *
 * The rows are rebuilt only when the GROUPING changes, not when the state does,
 * so a re-render never destroys a node that is mid-animation.
 *
 * `--letters` drives the type scale in prompt.css. It is the name's own length,
 * not a tunable: `Bosnia and Herzegovina` has to fit on one line at whatever
 * size that takes, and a name that wrapped would move the prompt above it.
 */
function renderSlots(screen, state) {
  const slots = find(screen, 'slots');
  const item = state?.[ITEM_KEY] ?? null;
  const target = item === null ? '' : String(geographySpace.targetOf(item) ?? '');
  const letters = target.length;
  const groups = slotGroups(item?.name, letters);
  const signature = groups.join(',');

  if (slots.dataset.groups !== signature) {
    slots.textContent = '';
    for (const count of groups) {
      const group = el('span', 'slot-group');
      for (let i = 0; i < count; i += 1) {
        group.append(el('span', 'slot'));
      }
      slots.append(group);
    }
    slots.dataset.groups = signature;
  }
  slots.style.setProperty('--letters', String(Math.max(letters, 1)));

  const cells = slots.querySelectorAll('.slot');
  const typed = state.typed ?? '';
  const shown = Math.min(revealedCount(state), letters);

  for (let i = 0; i < cells.length; i += 1) {
    const slot = cells[i];
    if (i < typed.length) {
      slot.textContent = typed[i];
      slot.dataset.state = 'filled';
    } else if (i < shown) {
      slot.textContent = target[i];
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
 * transition replaces it, and the engine's no-op transitions return the SAME
 * OBJECT BY REFERENCE — so any loop that re-renders hands us the same pulsing
 * state over and over. Rendering the animation whenever `state.pulse` is true
 * re-fires the amber at the render rate: a strobe, not a pulse.
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
 * help.
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
