// The problem screen — the DOM half of the loop.
//
// RENDERING IS A PURE FUNCTION OF STATE. This module holds no game state of its
// own. It owns no timer, it never calls the engine, it never listens for a key.
// The wiring module (main.js) owns the clock, the randomness and the input, and
// calls in here whenever the state it holds has changed. Everything below is
// therefore idempotent: rendering the same ProblemState twice produces the same
// DOM and no side effects.
//
// That rule survives the reveal button. `onRevealClick` registers a callback and
// nothing more — the click does not call the engine from in here and does not
// mutate anything. main.js owns every state transition, including this one.
//
// The one deliberate exception is the wrong-answer pulse, which is an animation
// and so is inherently about a TRANSITION rather than about a state. See
// `renderPulse` — that comment is the important one in this file.
//
// TWO MODES, TWO SCREENS:
//
//   drill  problem, slots, and after the timer the answer greyed into the slots.
//          NO hint region at all — not an empty one, not a hidden one that still
//          takes space. Blocks and strategy text do not exist in this mode for
//          any of the 121 facts.
//   learn  strategy text and (where the product allows) a block array ALONGSIDE
//          it, both on screen from the first frame, plus a "Show me the answer"
//          button. No clock touches any of it.
//
// The reserved-space rule holds WITHIN each mode: nothing that appears or
// disappears during a problem may move the numerals. In drill that is trivial
// because nothing appears. In learn the strategy and blocks are up from the
// first frame and never change, and the button's row keeps its height when the
// button goes — so the only thing that ever changes mid-problem is the content
// of the slots.
//
// Exports: mountProblemScreen, renderProblem, renderProgress, onRevealClick.

import { answerOf, answerDigits } from '../facts.js';
import { strategyFor } from '../strategies.js';
import { blocksApply } from '../hints.js';
import { CONFIG } from '../config.js';

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

/**
 * The reveal handler registered for each container, and the set of containers
 * that already carry the delegated click listener.
 *
 * The listener is delegated to the CONTAINER rather than bound to the button
 * because `mountProblemScreen` empties the container and builds a fresh button
 * every time it runs. A listener on the button would be thrown away with it and
 * the wiring would silently stop working after the first remount, which is the
 * kind of bug that only shows up on the second session.
 *
 * @type {WeakMap<Element, () => void>}
 */
const revealHandlers = new WeakMap();

/** @type {WeakSet<Element>} */
const delegatedContainers = new WeakSet();

/** How long the amber pulse runs. Must match --pulse-ms in base.css. */
const PULSE_MS = 400;

/** Operator glyphs. `op` is the fact's own token, so this extends with it. */
const OP_GLYPHS = { '*': '×', '+': '+', '-': '−', '/': '÷' };

/**
 * Build the problem screen's skeleton inside `container`, replacing whatever
 * was there. Call once per screen; `renderProblem` calls it for you if the
 * skeleton is missing, so mounting is never a precondition you can get wrong.
 *
 * Every node the two modes need is built here and only ever shown or hidden
 * afterwards, so a render can never create or destroy a node mid-problem. The
 * whole skeleton starts hidden below the numerals and is opened up by
 * `renderProblem` according to the mode it is given — which means the default,
 * un-rendered screen is the drill screen: numerals, slots, nothing else.
 *
 * @param {Element} container
 * @returns {Element} the .problem-screen root
 */
export function mountProblemScreen(container) {
  container.textContent = '';

  const screen = el('section', 'problem-screen');
  screen.dataset.stage = 'clean';
  screen.dataset.mode = 'drill';

  const problem = el('div', 'problem');
  problem.append(
    el('span', 'problem__operand', { role: 'a' }),
    el('span', 'problem__op', { role: 'op' }),
    el('span', 'problem__operand', { role: 'b' }),
    el('span', 'problem__eq', { role: 'eq' }, '='),
    el('span', 'slots', { role: 'slots' }),
  );

  // The learn view. Strategy and blocks sit SIDE BY SIDE in one row rather than
  // stacked: they are alternative representations of the same fact for
  // different developmental stages (spec §3), not degrees of the same help, so
  // neither is above the other — and a row keeps both on screen without the
  // tall region a stack would need.
  const hint = el('div', 'hint', { role: 'hint' });
  const strategy = el('p', 'hint__strategy', { role: 'strategy' });
  const blocks = el('div', 'hint__blocks', { role: 'blocks' });
  hint.append(strategy, blocks);

  // The button's row keeps its height when the button goes, so the numerals do
  // not jump upward the moment the kid presses it.
  const revealBar = el('div', 'reveal-bar', { role: 'reveal-bar' });
  const revealButton = el('button', 'reveal-bar__button', { role: 'reveal' });
  revealButton.type = 'button';
  revealButton.textContent = 'Show me the answer';
  revealBar.append(revealButton);

  // Hidden until a render says otherwise. Drill never says otherwise.
  hint.hidden = true;
  strategy.hidden = true;
  blocks.hidden = true;
  revealBar.hidden = true;
  revealButton.hidden = true;

  screen.append(problem, hint, revealBar);
  container.append(screen);

  lastRendered.delete(container);
  return screen;
}

/**
 * Render one ProblemState. Safe to call on every animation frame — the same
 * state object rendered twice is a no-op, including for the pulse.
 *
 * `mode` is a parameter rather than being read off the state because the engine
 * deliberately has no mode field: what mode a problem is in is a property of the
 * SESSION, and main.js is the only thing that knows it. It defaults to 'drill'
 * so a caller that has not been taught about modes yet gets the hint-free
 * screen, which is the safe default — a missing argument can never leak a hint
 * into a fluency session.
 *
 * @param {Element} container the element mountProblemScreen was given
 * @param {object} state ProblemState from engine.js
 * @param {'drill'|'learn'} [mode] which screen to draw
 * @returns {void}
 */
export function renderProblem(container, state, mode = 'drill') {
  const screen =
    container.querySelector('.problem-screen') ?? mountProblemScreen(container);

  const { fact } = state;
  const learning = mode === 'learn';

  screen.dataset.stage = state.stage;
  screen.dataset.mode = learning ? 'learn' : 'drill';
  find(screen, 'a').textContent = String(fact.a);
  find(screen, 'op').textContent = OP_GLYPHS[fact.op] ?? fact.op;
  find(screen, 'b').textContent = String(fact.b);

  renderSlots(screen, state);
  renderHint(screen, state, learning);
  renderReveal(screen, state, learning);
  renderPulse(container, screen, state);
}

/**
 * Register the handler for the learn-mode "Show me the answer" button. Call once
 * per container, at wiring time; it survives every remount of the screen.
 *
 * THE HANDLER IS CALLED WITH NO ARGUMENTS AND ITS RETURN VALUE IS IGNORED. This
 * module does not hold the ProblemState and must not be handed one — main.js
 * owns the state, calls `revealAnswer` itself, and renders the result. Passing
 * state in here so the UI could transition it would put a second writer on the
 * game's only mutable value and would break the pulse identity guard the moment
 * the two disagreed about which object is current.
 *
 * The listener is delegated to the container, so registering before the first
 * mount is fine and re-mounting does not lose the wiring. Registering twice
 * replaces the handler rather than stacking a second one.
 *
 * @param {Element} container the element mountProblemScreen was given
 * @param {() => void} handler called on each click of the reveal button
 * @returns {void}
 */
export function onRevealClick(container, handler) {
  revealHandlers.set(container, handler);

  if (delegatedContainers.has(container)) {
    return;
  }
  delegatedContainers.add(container);

  container.addEventListener('click', (event) => {
    const target = event.target;
    if (target === null || typeof target.closest !== 'function') {
      return;
    }
    const button = target.closest('[data-role="reveal"]');
    if (button === null || !container.contains(button)) {
      return;
    }
    const current = revealHandlers.get(container);
    if (typeof current === 'function') {
      current();
    }
  });
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
 * kid is already looking (spec §5). This is the same in both modes — what
 * differs is how the stage was reached: a timer in drill, the kid's own button
 * press in learn.
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
 * The learn view's help, or nothing at all.
 *
 * DRILL RENDERS NO HINTS, EVER. Not for the 53 facts small enough to draw, not
 * at the last stage, not for one frame. The whole region is taken out of the
 * layout, so the numerals sit in the same place at 'clean' and at 'reveal' and
 * the screen holds still while the kid is trying to retrieve (spec §1).
 *
 * LEARN RENDERS BOTH AT ONCE, FROM THE FIRST FRAME. Strategy text and, where the
 * product allows, a block array beside it — not instead of it. Neither is a
 * stage in v2, so nothing here reads `state.stage`: the help is a property of
 * the FACT, and it is up before the kid has done anything and stays up through
 * the reveal. That is the point of the whole redesign; an answer that arrives
 * without its derivation is the flashcard we are not building (spec §2).
 *
 * The two predicates are INDEPENDENT and both-empty is a real combination —
 * `0 x 7` has no strategy text and no drawable array. The learn selector never
 * offers such a fact, but this function is a pure function of its arguments and
 * has to survive being handed one, so an empty region collapses out of the
 * layout rather than reserving a blank box under the problem.
 */
function renderHint(screen, state, learning) {
  const hint = find(screen, 'hint');
  const strategy = find(screen, 'strategy');
  const blocks = find(screen, 'blocks');

  if (!learning) {
    hint.hidden = true;
    strategy.hidden = true;
    blocks.hidden = true;
    return;
  }

  const text = strategyFor(state.fact);
  const drawBlocks = blocksApply(state.fact, CONFIG);

  strategy.textContent = text ?? '';
  strategy.hidden = text === null;

  if (drawBlocks) {
    renderBlocks(blocks, state.fact);
  }
  blocks.hidden = !drawBlocks;

  hint.hidden = text === null && !drawBlocks;
}

/**
 * The "Show me the answer" button — learn mode only, and gone once it has been
 * used. Drill has no button because drill has no help to ask for; the answer
 * arrives on the clock and there is nothing for the kid to decide.
 *
 * The row it sits in keeps its height when the button is hidden, so pressing it
 * does not yank the numerals upward at the exact moment the kid is reading the
 * answer that appeared in the slots.
 *
 * `state.revealed` is the contract flag, but the terminal stage is checked too:
 * offering to show an answer that is already on screen would be nonsense however
 * the state got there.
 */
function renderReveal(screen, state, learning) {
  const bar = find(screen, 'reveal-bar');
  const button = find(screen, 'reveal');

  if (!learning) {
    bar.hidden = true;
    button.hidden = true;
    return;
  }

  bar.hidden = false;
  button.hidden = state.revealed === true || state.stage === 'reveal';
}

/**
 * `a` rows of `b` squares — the array as it is spoken: "6 groups of 7".
 *
 * Never called for a zero product: `blocksApply` screens those out precisely so
 * this cannot draw an empty grid, which would be a blank box where a picture
 * should be. Rebuilt only when the shape changes.
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
