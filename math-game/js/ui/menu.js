// The menu screen: the game's own home, and the only place all four routes are
// visible at once.
//
// This module RENDERS AND NOTHING ELSE. It holds no state at all — not even the
// one cell's worth results.js keeps — it starts no session, it navigates
// nowhere, and it never touches the log. It is handed a MasteryModel and reports
// which control was pressed through onMenuAction; main.js owns every transition
// that follows. Same contract as ui/results.js, for the same reason: the thing
// that draws a button must not also be the thing that decides what it means.
//
// A SCREEN, NOT A PAGE (spec §1). index.html already holds #stage and #results
// and swaps between them with `hidden`; #menu is the third region beside them. A
// separate HTML file would fetch the log tail to draw these bars and then
// navigate to index.html, which fetches the same tail a second later — and it
// would put a page load between a kid and a game, in an app whose results screen
// already goes to the trouble of starting sessions with no reload at all.
//
// THE TABLE LIST IS WHAT EARNS THIS SCREEN ITS EXISTENCE. Without the nine rows
// it is a router, and a router is one more click for no return. With them the
// whole curriculum is visible at once and progress is legible BEFORE she starts
// anything, which is the sense of place ordered mode exists to provide.
//
// EVERY NUMBER HERE COMES FROM `tableProgress(model)`. Nothing is counted in
// this file, and mastery.js is deliberately not imported: a second copy of "how
// far has this table got" would be free to drift from the one `runFor` peels by,
// and the bar would then disagree with the run it is a bar for.
//
// Pure presentation: no clock, no randomness, no network.

import { tableProgress } from '../ordered.js';

/**
 * The two scheduler-driven routes. Copy is spec §1's, and it describes them as
 * DIFFERENT ACTIVITIES rather than difficulty levels — "in order" is not the
 * easy one and drill is not the hard one. Drill teaches nothing, which is why it
 * cannot be a default buried behind a toggle, and why all three sit here as
 * peers.
 *
 * @type {{action: string, icon: string, name: string, note: string}[]}
 */
const ROUTES = [
  {
    action: 'learn',
    icon: '💡',
    name: 'Learn 3 facts',
    note: 'Shows you a way to work out three tricky ones.',
  },
  {
    action: 'drill',
    icon: '✖️',
    name: 'Drill',
    note: 'Practice what you already have a way to work out.',
  },
];

/**
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className !== undefined) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

/**
 * The bar itself. Decorative, and marked so: the count beside it says the same
 * thing in words, and two announcements of one number is noise to a screen
 * reader. The state lives on the control's aria-label instead.
 *
 * @param {number} cleared
 * @param {number} total
 * @returns {HTMLElement}
 */
function progressBar(cleared, total) {
  const bar = el('span', 'menu__bar');
  bar.setAttribute('aria-hidden', 'true');
  const fill = el('span', 'menu__bar-fill');
  fill.style.setProperty('--menu-progress', String(total === 0 ? 0 : cleared / total));
  bar.append(fill);
  return bar;
}

/**
 * One row of the table list.
 *
 * A FINISHED TABLE IS NOT A CONTROL. When every fact in the row has cleared the
 * run is empty, so the row renders as a plain element carrying no
 * `data-menu-action` — no button, no link, nothing to press. A button that
 * starts a session with nothing in it is the same failure the `canLearn` guard
 * already exists to prevent (spec §1), and the completed row is already the
 * reward. There is no victory-lap replay.
 *
 * The count is the PEELED FRONT, not every cleared fact in the row — see
 * `tableProgress`. It is a promise about the button under it: "4 of 11" here
 * means the run below is seven problems long.
 *
 * @param {{table: number, cleared: number, total: number}} progress
 * @returns {HTMLElement}
 */
function renderTableRow({ table, cleared, total }) {
  const done = cleared >= total;
  const item = el('li', 'menu__table-item');

  const row = el(done ? 'div' : 'button', `menu__table${done ? ' menu__table--done' : ''}`);
  if (done) {
    row.setAttribute('aria-label', `the ${table}s, done`);
  } else {
    row.type = 'button';
    row.dataset.menuAction = 'ordered';
    row.dataset.table = String(table);
    row.setAttribute('aria-label', `the ${table}s, ${cleared} of ${total} done`);
  }

  row.append(el('span', 'menu__table-name', `the ${table}s`));
  row.append(progressBar(cleared, total));
  row.append(el('span', 'menu__table-count', done ? 'done ✓' : `${cleared} of ${total}`));

  item.append(row);
  return item;
}

/** @type {WeakMap<HTMLElement, (event: Event) => void>} */
const ACTION_LISTENERS = new WeakMap();

/**
 * Register the handler for every control on the menu. Delegated on `container`,
 * so it survives any number of re-renders of the screen inside it, and
 * re-registering REPLACES the previous handler rather than stacking a second
 * one. Copy of onResultsAction, deliberately — the menu is re-rendered every
 * time it is shown, and a listener bound per render would fire the same action
 * once per sitting-so-far.
 *
 * The handler is called with `(action, table)`, where `table` is a number for
 * `'ordered'` and null for everything else.
 *
 * @param {HTMLElement} container
 * @param {(action: 'learn' | 'drill' | 'ordered' | 'games', table: number | null) => void} handler
 * @returns {void}
 */
export function onMenuAction(container, handler) {
  const existing = ACTION_LISTENERS.get(container);
  if (existing !== undefined) {
    container.removeEventListener('click', existing);
  }
  const listener = (event) => {
    const control = event.target.closest('[data-menu-action]');
    if (control === null || !container.contains(control)) {
      return;
    }
    // `dataset.table` is absent on everything but an ordered row, and
    // `parseInt(undefined)` is NaN — which `isTable` in main.js refuses. Null is
    // handed over instead, so "this action has no table" is one value rather
    // than two.
    const raw = control.dataset.table;
    const table = raw === undefined ? null : Number.parseInt(raw, 10);
    handler(control.dataset.menuAction, table);
  };
  ACTION_LISTENERS.set(container, listener);
  container.addEventListener('click', listener);
}

/**
 * Render the menu into `container`, replacing whatever was there.
 *
 * Re-rendered from the CURRENT model every time the menu is shown, which is what
 * makes a run finished this sitting move its bar without a reload.
 *
 * @param {HTMLElement} container
 * @param {import('../mastery.js').MasteryModel} model
 * @returns {void}
 */
export function renderMenu(container, model) {
  const root = el('section', 'menu');

  const header = el('header', 'menu__header');
  header.append(el('h1', 'menu__title', 'Numbers'));
  header.append(el('p', 'menu__subtitle', 'Three ways to play. Pick one.'));
  root.append(header);

  const routes = el('nav', 'menu__routes');
  routes.setAttribute('aria-label', 'What to play');
  for (const route of ROUTES) {
    const button = el('button', 'menu__route');
    button.type = 'button';
    button.dataset.menuAction = route.action;
    button.append(el('span', 'menu__route-icon', route.icon));
    const text = el('span', 'menu__route-text');
    text.append(el('span', 'menu__route-name', route.name));
    text.append(el('span', 'menu__route-note', route.note));
    button.append(text);
    routes.append(button);
  }
  root.append(routes);

  const ordered = el('section', 'menu__ordered');
  const orderedHead = el('div', 'menu__ordered-head');
  orderedHead.append(el('span', 'menu__route-icon', '🔢'));
  const orderedText = el('span', 'menu__route-text');
  orderedText.append(el('h2', 'menu__route-name', 'In order'));
  orderedText.append(
    el('span', 'menu__route-note', 'Straight through a table, start to finish.'),
  );
  orderedHead.append(orderedText);
  ordered.append(orderedHead);

  const tables = el('ul', 'menu__tables');
  for (const progress of tableProgress(model)) {
    tables.append(renderTableRow(progress));
  }
  ordered.append(tables);
  root.append(ordered);

  // The one place a real navigation still happens. main.js owns the URL.
  const footer = el('nav', 'menu__footer');
  footer.setAttribute('aria-label', 'Leave');
  const back = el('button', 'menu__back', 'Back to all games');
  back.type = 'button';
  back.dataset.menuAction = 'games';
  footer.append(back);
  root.append(footer);

  container.replaceChildren(root);
}
