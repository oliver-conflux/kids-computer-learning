// The problem screen — the DOM half of the loop.
//
// RENDERING IS A PURE FUNCTION OF STATE. This module holds no game state of its
// own. It owns no timer, it never calls the engine, it never listens for a key.
// The wiring module (main.js) owns the clock, the randomness and the input, and
// calls in here whenever the state it holds has changed. Everything below is
// therefore idempotent: rendering the same ProblemState twice produces the same
// DOM and no side effects.
//
// The one deliberate exception is the wrong-answer pulse, which is an animation
// and so is inherently about a TRANSITION rather than about a state. See
// `renderPulse` — that comment is the important one in this file.
//
// Exports: mountProblemScreen, renderProblem, renderProgress.

import { answerOf, answerDigits } from '../facts.js';
import { strategyFor } from '../strategies.js';

/**
 * The last ProblemState rendered into each container, kept BY REFERENCE for the
 * pulse identity guard. A WeakMap so a container that goes away takes its entry
 * with it. This is not game state — nothing is ever read out of it except to
 * compare object identity.
 *
 * @type {WeakMap<Element, object>}
 */
const lastRendered = new WeakMap();

/** Pending pulse-clear timers, one per container. @type {WeakMap<Element, number>} */
const pulseTimers = new WeakMap();

/** How long the amber pulse runs. Must match --pulse-ms in base.css. */
const PULSE_MS = 400;

/** Operator glyphs. `op` is the fact's own token, so this extends with it. */
const OP_GLYPHS = { '*': '×', '+': '+', '-': '−', '/': '÷' };

/**
 * Build the problem screen's skeleton inside `container`, replacing whatever
 * was there. Call once per screen; `renderProblem` calls it for you if the
 * skeleton is missing, so mounting is never a precondition you can get wrong.
 *
 * The structure is fixed and only its text, attributes and slot count change on
 * render — the hint region in particular is always present and always the same
 * height, so no stage firing can move the layout.
 *
 * @param {Element} container
 * @returns {Element} the .problem-screen root
 */
export function mountProblemScreen(container) {
  container.textContent = '';

  const screen = el('section', 'problem-screen');
  screen.dataset.stage = 'clean';

  const problem = el('div', 'problem');
  problem.append(
    el('span', 'problem__operand', { role: 'a' }),
    el('span', 'problem__op', { role: 'op' }),
    el('span', 'problem__operand', { role: 'b' }),
    el('span', 'problem__eq', { role: 'eq' }, '='),
    el('span', 'slots', { role: 'slots' }),
  );

  // Reserved space. Both children live here permanently and are shown or hidden
  // by stage; neither is ever created or destroyed, so the region cannot resize.
  const hint = el('div', 'hint', { role: 'hint' });
  const strategy = el('p', 'hint__strategy', { role: 'strategy' });
  const blocks = el('div', 'hint__blocks', { role: 'blocks' });
  strategy.hidden = true;
  blocks.hidden = true;
  hint.append(strategy, blocks);

  screen.append(problem, hint);
  container.append(screen);

  lastRendered.delete(container);
  return screen;
}

/**
 * Render one ProblemState. Safe to call on every animation frame — the same
 * state object rendered twice is a no-op, including for the pulse.
 *
 * @param {Element} container the element mountProblemScreen was given
 * @param {object} state ProblemState from engine.js
 * @returns {void}
 */
export function renderProblem(container, state) {
  const screen =
    container.querySelector('.problem-screen') ?? mountProblemScreen(container);

  const { fact } = state;

  screen.dataset.stage = state.stage;
  find(screen, 'a').textContent = String(fact.a);
  find(screen, 'op').textContent = OP_GLYPHS[fact.op] ?? fact.op;
  find(screen, 'b').textContent = String(fact.b);

  renderSlots(screen, state);
  renderHint(screen, state);
  renderPulse(container, screen, state);
}

/**
 * The progress strip: `done` of `total` problems, plus the bar's fill.
 *
 * `done` is the count of problems COMPLETED — it starts at 0 and reaches
 * `total` only when the session is over. It is NOT the 1-based index of the
 * problem currently on screen. The two differ by one and "7 / 20" reads
 * plausibly as either, so: while the kid is working on the eighth problem
 * having finished seven, this shows "7 / 20". The label and the bar then always
 * agree, because both are the same fraction of finished work.
 *
 * This is separate from renderProblem because progress is SESSION state and
 * ProblemState carries no index. Keeping it as a named export rather than
 * letting the caller poke the DOM by id means the markup and the custom
 * property below stay private to this module.
 *
 * NOTE: no elapsed time, no countdown and no timer bar is rendered here or
 * anywhere else in this module. The bar counts PROBLEMS. Time is measured
 * relentlessly by the engine and never shown — a visible clock is a documented
 * math-anxiety trigger and an explicit non-goal.
 *
 * @param {Element} container an element containing the .progress markup (the shell)
 * @param {number} done problems completed, 0..total
 * @param {number} total problems in the session
 * @returns {void}
 */
export function renderProgress(container, done, total) {
  const bar = container.matches('.progress')
    ? container
    : container.querySelector('.progress');
  const count = container.querySelector('.progress__count');
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

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

/**
 * Exactly answerDigits(fact) slots, filled left to right from `state.typed`.
 *
 * Slots are rebuilt only when the count changes, which is once per problem at
 * most, so a re-render never destroys and recreates a node that is mid-animation.
 *
 * At the 'reveal' stage every slot the kid has not yet filled shows its digit of
 * the answer, greyed. The help lands inside the slots because that is where the
 * kid is already looking (spec §5).
 */
function renderSlots(screen, state) {
  const slots = find(screen, 'slots');
  const digits = answerDigits(state.fact);

  if (slots.childElementCount !== digits) {
    slots.textContent = '';
    for (let i = 0; i < digits; i += 1) {
      slots.append(el('span', 'slot'));
    }
  }

  const typed = state.typed;
  const revealing = state.stage === 'reveal';
  const answer = revealing ? String(answerOf(state.fact)).padStart(digits, '0') : '';

  for (let i = 0; i < digits; i += 1) {
    const slot = slots.children[i];
    if (i < typed.length) {
      slot.textContent = typed[i];
      slot.dataset.state = 'filled';
    } else if (revealing) {
      slot.textContent = answer[i];
      slot.dataset.state = 'revealed';
    } else {
      slot.textContent = '';
      // The slot the next digit lands in carries the accent ring; the rest are
      // plain. This is the only positional feedback there is, and it is enough.
      slot.dataset.state = i === typed.length ? 'next' : 'empty';
    }
  }
}

/**
 * Whichever rung is current: 'strategy' shows the text, 'blocks' draws the
 * array, 'clean' and 'reveal' show nothing here. Both children stay in the DOM
 * and are only toggled, so the reserved region never changes size.
 */
function renderHint(screen, state) {
  const strategy = find(screen, 'strategy');
  const blocks = find(screen, 'blocks');

  if (state.stage === 'strategy') {
    // The ladder only includes this rung when strategyFor is non-null, but the
    // fallback keeps a bad ladder from rendering the word "null" at a child.
    strategy.textContent = strategyFor(state.fact) ?? '';
    strategy.hidden = false;
    blocks.hidden = true;
    return;
  }

  if (state.stage === 'blocks') {
    strategy.hidden = true;
    renderBlocks(blocks, state.fact);
    blocks.hidden = false;
    return;
  }

  strategy.hidden = true;
  blocks.hidden = true;
}

/**
 * `a` rows of `b` squares — the array as it is spoken: "6 groups of 7".
 *
 * An operand of 0 draws an empty grid, which is the honest picture of "zero
 * groups of 5" and is the only case that reaches this rung with nothing in it.
 * Rebuilt only when the shape changes.
 */
function renderBlocks(blocks, fact) {
  const rows = fact.a;
  const cols = fact.b;
  const total = rows * cols;

  if (blocks.dataset.shape !== `${rows}x${cols}`) {
    blocks.dataset.shape = `${rows}x${cols}`;
    blocks.style.setProperty('--cols', String(Math.max(cols, 1)));
    blocks.textContent = '';
    const frag = document.createDocumentFragment();
    for (let i = 0; i < total; i += 1) {
      frag.append(el('span', 'block'));
    }
    blocks.append(frag);
  }
}

/**
 * The wrong-answer flash — and the one genuinely subtle thing in this file.
 *
 * FIRE ON THE TRANSITION, NOT ON THE STATE. `state.pulse` is not a "flash now"
 * flag that something clears; it stays true on the state object until the next
 * transition replaces it. Worse, engine.tick returns the SAME OBJECT BY
 * REFERENCE when nothing happened, so a polling loop calling
 * `tick -> renderProblem` hands us that same pulsing state over and over. Render
 * the animation whenever `state.pulse` is true and the amber re-fires at the
 * polling rate for as long as the kid sits there — a strobe, not a pulse.
 *
 * So the guard is object IDENTITY against the last state rendered into this
 * container: flash only when this is a state we have not rendered before and it
 * is pulsing. That is exactly the set of wrong answers, including two wrong
 * answers in a row on a one-digit fact, which really are two distinct pulsing
 * objects and really should flash twice.
 *
 * The attribute is removed and re-set with a forced reflow in between, because
 * a CSS animation does not replay on an element that already has it applied.
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
