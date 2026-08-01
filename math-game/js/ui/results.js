// Results screen: the session summary and the 11 x 11 mastery grid.
//
// This module renders and nothing else. It holds no game state beyond which
// cell the kid last tapped, which lives for exactly as long as the rendered
// screen does. Everything it shows is read from the MasteryModel and the
// SessionSummary it is handed.
//
// THE GRID IS NOT SYMMETRIC AND THAT IS THE POINT (spec §11). 6x7 and 7x6 are
// separate facts with separate ids, separate latency histories and separate
// buckets, so their two cells can and do differ. A cell hot at 6x7 and cold at
// 7x6 says the fact is known in one direction only, and names the exact thing
// to drill. Reading across the diagonal is how that is spotted, so the diagonal
// is drawn, mirror-mismatched cells are flagged, and selecting any cell also
// marks its transpose. Nothing here averages, folds, or tidies the two
// orientations into one.
//
// What deliberately does NOT appear: any speed score, any words-per-minute
// equivalent, any target or age norm, any comparison to another person, and any
// countdown or clock. Latency is reported as "your typical time" and as a
// bucket colour, never as a score to beat. Speed is a result of accuracy; a kid
// pushed on speed invents hunt-and-peck and keeps it. The motivator on this
// screen is the cold-cell count: a small, concrete, visibly shrinking set of
// remaining work.
//
// Exactly ONE comparison is permitted, and it is the kid against their own
// previous session's median — `summary.previousMedianMs`. See comparisonNote.

import { allFacts, answerOf, factId, parseFactId, transposeId } from '../facts.js';

const OPERANDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// cold < warm < hot. Used only to tell a promotion from a regression when
// rendering `moved`; movement is NOT monotonic, so `from` may outrank `to`.
const BUCKET_RANK = { cold: 0, warm: 1, hot: 2 };

const BUCKET_WORD = {
  cold: 'not started',
  warm: 'getting there',
  hot: 'from memory',
};

// Long form, for the detail panel.
const STAGE_TEXT = {
  clean: 'straight from memory',
  strategy: 'after a strategy hint',
  blocks: 'after the blocks',
  reveal: 'after the answer showed',
};

// Short form, for the attempt chips.
const STAGE_CHIP = {
  clean: 'clean',
  strategy: 'hint',
  blocks: 'blocks',
  reveal: 'shown',
};

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
 * Latency for display. The model's medians are unrounded and can be fractional
 * — 1500 from a 1400/1600 pair — so rounding happens here, at the edge, and
 * never in the model.
 *
 * @param {number | null | undefined} ms
 * @returns {string}
 */
function formatMs(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) {
    return '—';
  }
  const seconds = ms / 1000;
  return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
}

/**
 * @param {number | null | undefined} rate 0..1
 * @returns {string}
 */
function formatRate(rate) {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) {
    return '—';
  }
  return `${Math.round(rate * 100)}%`;
}

/**
 * @param {{op: string, a: number, b: number}} fact
 * @returns {string} e.g. "6 × 7"
 */
function factLabel(fact) {
  return `${fact.a} × ${fact.b}`;
}

/**
 * A wrong answer is rarely random — `6 × 7 = 48` is interference from `6 × 8`.
 * If the wrong value is the product of a fact one step away on either operand,
 * name it. That single sentence is the whole diagnostic value of the confusion
 * set (spec §6).
 *
 * @param {{op: string, a: number, b: number}} fact
 * @param {number} wrong
 * @returns {string | null}
 */
function neighbourWithProduct(fact, wrong) {
  const candidates = [
    { a: fact.a, b: fact.b + 1 },
    { a: fact.a, b: fact.b - 1 },
    { a: fact.a + 1, b: fact.b },
    { a: fact.a - 1, b: fact.b },
  ];
  for (const candidate of candidates) {
    const inRange =
      candidate.a >= 0 && candidate.a <= 10 && candidate.b >= 0 && candidate.b <= 10;
    if (inRange && candidate.a * candidate.b === wrong) {
      return `${candidate.a} × ${candidate.b}`;
    }
  }
  return null;
}

/**
 * The headline: how much is left, stated as a countable set rather than a
 * percentage. "Nine cold squares left" is a finishable job; "84%" is a grade.
 *
 * @param {import('../mastery.js').MasteryModel} model
 * @returns {{cold: number, warm: number, hot: number}}
 */
function countBuckets(model) {
  const counts = { cold: 0, warm: 0, hot: 0 };
  for (const fact of allFacts()) {
    counts[model.byId.get(factId(fact)).bucket] += 1;
  }
  return counts;
}

/**
 * One stat block in the summary strip.
 *
 * @param {string} value
 * @param {string} label
 * @param {string} [note]
 * @param {string} [noteTone] modifier suffix for the note's class
 * @returns {HTMLElement}
 */
function statBlock(value, label, note, noteTone) {
  const block = el('div', 'results__stat');
  block.append(el('div', 'results__stat-value', value));
  block.append(el('div', 'results__stat-label', label));
  if (note !== undefined) {
    const className =
      noteTone === undefined
        ? 'results__stat-note'
        : `results__stat-note results__stat-note--${noteTone}`;
    block.append(el('div', className, note));
  }
  return block;
}

/**
 * The one comparison this screen is allowed to make: the kid against their own
 * previous session.
 *
 * Every other reference point is forbidden by the design — no target time, no
 * age norm, no other kid — and without this one the median is a number with
 * nothing to mean. So it is the only one, and it is deliberately lopsided in
 * tone: a faster session is celebrated, a slower session is stated and shrugged
 * off. A slower median is frequently not a worse session. The retain window
 * means an improving kid who has just been promoted onto harder facts posts a
 * slower median for entirely boring statistical reasons, and beyond that, kids
 * have bad days. Reading that back to them as failure would teach them to chase
 * the clock, which is the one habit this whole game exists to avoid.
 *
 * The comparison is made on the values as they will be DISPLAYED, not on the
 * raw ones, so the sentence can never contradict the two numbers next to it by
 * calling 1.44s and 1.35s different when both render as "1.4s".
 *
 * @param {number | null | undefined} medianMs this session
 * @param {number | null | undefined} previousMedianMs last session, null on a first run
 * @returns {{text: string, tone: string}}
 */
function comparisonNote(medianMs, previousMedianMs) {
  if (!Number.isFinite(medianMs)) {
    return { text: 'your middle answer today', tone: 'plain' };
  }
  if (previousMedianMs === null || !Number.isFinite(previousMedianMs)) {
    return { text: 'first session — this is your starting point', tone: 'first' };
  }

  const now = formatMs(medianMs);
  const before = formatMs(previousMedianMs);
  if (now === before) {
    return { text: `about the same as last time (${before})`, tone: 'same' };
  }
  if (medianMs < previousMedianMs) {
    return { text: `quicker than last time (${before})`, tone: 'quicker' };
  }
  return { text: `a bit slower than last time (${before}) — that happens`, tone: 'slower' };
}

/**
 * The session strip: problems done, clean rate, typical time.
 *
 * @param {object} summary SessionSummary
 * @returns {HTMLElement}
 */
function renderSummaryStrip(summary) {
  const items = Number.isFinite(summary?.items) ? summary.items : 0;
  const cleanRate = summary?.cleanRate;
  const strip = el('div', 'results__stats');

  strip.append(statBlock(String(items), 'problems', 'done this session'));

  const cleanNote =
    Number.isFinite(cleanRate) && items > 0
      ? `${Math.round(cleanRate * items)} of ${items} before any hint`
      : 'answered before any hint';
  strip.append(statBlock(formatRate(cleanRate), 'from memory', cleanNote));

  // The only comparison on this screen: the kid's own previous session.
  const comparison = comparisonNote(summary?.medianMs, summary?.previousMedianMs ?? null);
  strip.append(
    statBlock(formatMs(summary?.medianMs), 'typical time', comparison.text, comparison.tone),
  );

  return strip;
}

/**
 * Bucket movements this session.
 *
 * Movement is NOT one-way. A fact drops back when its clean attempts age out of
 * the retain window, so hot -> cold is a real and expected transition and is
 * rendered as plainly as a promotion — just without the celebration, and with a
 * word about why it happened. Direction is computed from the two buckets; `from`
 * is never assumed to be the worse one.
 *
 * @param {object} summary SessionSummary
 * @returns {HTMLElement}
 */
function renderMoves(summary) {
  const section = el('section', 'results__moves');
  section.append(el('h2', 'results__h2', 'What moved'));

  const moved = Array.isArray(summary?.moved) ? summary.moved : [];
  if (moved.length === 0) {
    section.append(
      el(
        'p',
        'results__empty',
        'No squares changed colour this session. That happens — the colours only move when the last five tries say so.',
      ),
    );
    return section;
  }

  const list = el('ul', 'results__move-list');
  for (const move of moved) {
    const fact = parseFactId(move.id);
    const up = BUCKET_RANK[move.to] > BUCKET_RANK[move.from];
    const down = BUCKET_RANK[move.to] < BUCKET_RANK[move.from];
    const direction = up ? 'up' : down ? 'down' : 'flat';

    const item = el('li', `results__move results__move--${direction}`);
    item.append(el('span', 'results__move-arrow', up ? '↑' : down ? '↓' : '→'));
    item.append(el('span', 'results__move-fact', `${factLabel(fact)} = ${answerOf(fact)}`));

    const from = el('span', `results__pill results__pill--${move.from}`, BUCKET_WORD[move.from]);
    const to = el('span', `results__pill results__pill--${move.to}`, BUCKET_WORD[move.to]);
    const change = el('span', 'results__move-change');
    change.append(from, el('span', 'results__move-to', '→'), to);
    item.append(change);

    if (down) {
      item.append(
        el('span', 'results__move-why', 'slipped back — older quick answers dropped out'),
      );
    }
    list.append(item);
  }
  section.append(list);
  return section;
}

/**
 * Build the 11 x 11 grid. Row = first operand, column = second operand, so the
 * cell at row 6 / column 7 is 6 x 7 and the cell at row 7 / column 6 is 7 x 6.
 * They are different cells because they are different facts.
 *
 * @param {import('../mastery.js').MasteryModel} model
 * @returns {HTMLElement}
 */
function renderGrid(model) {
  const grid = el('div', 'results__grid');
  grid.setAttribute('role', 'grid');
  grid.setAttribute('aria-label', 'Multiplication facts, first number down the side, second number across the top');

  const headRow = el('div', 'results__row');
  headRow.setAttribute('role', 'row');
  const corner = el('div', 'results__corner', '×');
  corner.setAttribute('role', 'columnheader');
  headRow.append(corner);
  for (const b of OPERANDS) {
    const head = el('div', 'results__head results__head--col', String(b));
    head.setAttribute('role', 'columnheader');
    headRow.append(head);
  }
  grid.append(headRow);

  for (const a of OPERANDS) {
    const row = el('div', 'results__row');
    row.setAttribute('role', 'row');

    const rowHead = el('div', 'results__head results__head--row', String(a));
    rowHead.setAttribute('role', 'rowheader');
    row.append(rowHead);

    for (const b of OPERANDS) {
      const fact = { op: '*', a, b };
      const id = factId(fact);
      const stats = model.byId.get(id);
      const mirror = model.byId.get(transposeId(fact));
      const mismatched = a !== b && mirror.bucket !== stats.bucket;

      const cell = el('div', `results__cell results__cell--${stats.bucket}`);
      cell.setAttribute('role', 'gridcell');
      cell.tabIndex = -1;
      cell.dataset.id = id;
      cell.dataset.a = String(a);
      cell.dataset.b = String(b);
      if (a === b) {
        cell.classList.add('is-diagonal');
      }
      if (mismatched) {
        // The finding the grid exists to surface: this orientation and its
        // mirror disagree.
        cell.classList.add('is-mismatched');
      }
      cell.textContent = String(answerOf(fact));
      cell.setAttribute(
        'aria-label',
        `${a} times ${b} is ${answerOf(fact)}, ${BUCKET_WORD[stats.bucket]}${
          mismatched ? `, but ${b} times ${a} is ${BUCKET_WORD[mirror.bucket]}` : ''
        }`,
      );
      row.append(cell);
    }
    grid.append(row);
  }

  return grid;
}

/**
 * @param {import('../mastery.js').MasteryModel} model
 * @param {string} id FactId
 * @returns {HTMLElement}
 */
function renderDetail(model, id) {
  const stats = model.byId.get(id);
  const fact = stats.fact;
  const panel = el('div', 'results__detail-body');

  const heading = el('h3', 'results__detail-title');
  heading.append(el('span', 'results__detail-fact', `${factLabel(fact)} = ${answerOf(fact)}`));
  heading.append(
    el('span', `results__pill results__pill--${stats.bucket}`, BUCKET_WORD[stats.bucket]),
  );
  panel.append(heading);

  const line =
    stats.cleanCount === 0
      ? 'No answers straight from memory yet.'
      : `${stats.cleanCount} straight from memory, typically ${formatMs(stats.medianCleanMs)}.`;
  panel.append(el('p', 'results__detail-line', line));

  // The mirror. Only interesting when the two orientations disagree, which is
  // exactly the case the grid is built to make visible.
  if (fact.a !== fact.b) {
    const mirror = model.byId.get(transposeId(fact));
    const mirrorLine = el('p', 'results__mirror');
    if (mirror.bucket === stats.bucket) {
      mirrorLine.textContent = `${factLabel(mirror.fact)} is ${BUCKET_WORD[mirror.bucket]} too — both ways round match.`;
    } else {
      mirrorLine.classList.add('is-mismatched');
      mirrorLine.textContent = `Same numbers the other way round, ${factLabel(mirror.fact)}, is ${BUCKET_WORD[mirror.bucket]}. Worth drilling the slower direction.`;
    }
    panel.append(mirrorLine);
  }

  // Recent attempts, oldest first — `attempts` is most-recent-LAST.
  const attemptsBlock = el('div', 'results__block');
  attemptsBlock.append(el('h4', 'results__h4', 'Last few tries'));
  if (stats.attempts.length === 0) {
    attemptsBlock.append(el('p', 'results__empty', 'Not seen yet.'));
  } else {
    const chips = el('ul', 'results__chips');
    stats.attempts.forEach((attempt, index) => {
      const chip = el('li', `results__chip results__chip--${attempt.stage}`);
      chip.append(el('span', 'results__chip-ms', formatMs(attempt.ms)));
      chip.append(el('span', 'results__chip-stage', STAGE_CHIP[attempt.stage] ?? attempt.stage));
      if (attempt.wrong.length > 0) {
        chip.append(
          el('span', 'results__chip-wrong', `tried ${attempt.wrong.join(', ')}`),
        );
      }
      chip.title = `${formatMs(attempt.ms)}, ${STAGE_TEXT[attempt.stage] ?? attempt.stage}`;
      if (index === stats.attempts.length - 1) {
        chip.classList.add('is-latest');
      }
      chips.append(chip);
    });
    attemptsBlock.append(chips);
    attemptsBlock.append(el('p', 'results__caption', 'oldest → most recent'));
  }
  panel.append(attemptsBlock);

  // Confusions come from the whole log, not just the retained window.
  const wrongBlock = el('div', 'results__block');
  wrongBlock.append(el('h4', 'results__h4', 'Answers given that were not right'));
  const wrong = [...model.confusions.get(id)].sort((x, y) => x - y);
  if (wrong.length === 0) {
    wrongBlock.append(el('p', 'results__empty', 'None — every answer here has been right.'));
  } else {
    const list = el('ul', 'results__wrongs');
    for (const value of wrong) {
      const item = el('li', 'results__wrong');
      item.append(el('span', 'results__wrong-value', String(value)));
      const note = neighbourWithProduct(fact, value);
      if (note !== null) {
        item.append(el('span', 'results__wrong-note', `that's ${note}`));
      }
      list.append(item);
    }
    wrongBlock.append(list);
  }
  panel.append(wrongBlock);

  return panel;
}

/**
 * Render the results screen into `container`, replacing whatever was there.
 *
 * @param {HTMLElement} container
 * @param {import('../mastery.js').MasteryModel} model total over all 121 facts
 * @param {object} summary SessionSummary — { session, items, cleanRate, medianMs,
 *   previousMedianMs, moved }. `previousMedianMs` is null on a first run.
 * @returns {void}
 */
export function renderResults(container, model, summary) {
  const root = el('section', 'results');

  const header = el('header', 'results__header');
  header.append(el('h1', 'results__title', 'Session done'));
  root.append(header);

  root.append(renderSummaryStrip(summary));
  root.append(renderMoves(summary));

  const gridSection = el('section', 'results__grid-section');
  const counts = countBuckets(model);
  const gridHead = el('div', 'results__grid-head');
  gridHead.append(el('h2', 'results__h2', 'Your table'));
  gridHead.append(
    el(
      'p',
      'results__coldcount',
      counts.cold === 0
        ? 'No cold squares left. Every fact has been answered from memory at least once.'
        : `${counts.cold} cold ${counts.cold === 1 ? 'square' : 'squares'} left.`,
    ),
  );
  gridSection.append(gridHead);

  const legend = el('div', 'results__legend');
  for (const bucket of ['cold', 'warm', 'hot']) {
    const entry = el('span', 'results__legend-entry');
    entry.append(el('span', `results__swatch results__swatch--${bucket}`));
    entry.append(el('span', 'results__legend-text', `${BUCKET_WORD[bucket]} (${counts[bucket]})`));
    legend.append(entry);
  }
  const mismatchKey = el('span', 'results__legend-entry');
  mismatchKey.append(el('span', 'results__swatch results__swatch--mismatch'));
  mismatchKey.append(
    el('span', 'results__legend-text', 'the other way round is different'),
  );
  legend.append(mismatchKey);
  gridSection.append(legend);

  const board = el('div', 'results__board');
  board.append(el('div', 'results__axis results__axis--side', 'first number'));

  const gridStack = el('div', 'results__grid-stack');
  gridStack.append(el('div', 'results__axis results__axis--top', 'second number'));
  const grid = renderGrid(model);
  gridStack.append(grid);
  board.append(gridStack);
  gridSection.append(board);

  const detail = el('div', 'results__detail');
  detail.append(
    el(
      'p',
      'results__detail-hint',
      'Tap any square to see how that one is going.',
    ),
  );
  gridSection.append(detail);
  root.append(gridSection);

  // --- interaction -------------------------------------------------------
  // Selection lives here, for exactly as long as this rendered screen does.

  let focused = grid.querySelector('.results__cell');
  if (focused !== null) {
    focused.tabIndex = 0;
  }

  const select = (cell) => {
    for (const marked of grid.querySelectorAll('.is-selected, .is-mirror')) {
      marked.classList.remove('is-selected', 'is-mirror');
    }
    cell.classList.add('is-selected');

    const fact = parseFactId(cell.dataset.id);
    const mirrorCell = grid.querySelector(`[data-a="${fact.b}"][data-b="${fact.a}"]`);
    if (mirrorCell !== null && mirrorCell !== cell) {
      mirrorCell.classList.add('is-mirror');
    }

    detail.replaceChildren(renderDetail(model, cell.dataset.id));
  };

  const focus = (cell) => {
    if (focused !== null) {
      focused.tabIndex = -1;
    }
    focused = cell;
    cell.tabIndex = 0;
    cell.focus();
  };

  grid.addEventListener('click', (event) => {
    const cell = event.target.closest('.results__cell');
    if (cell !== null) {
      focus(cell);
      select(cell);
    }
  });

  // Arrow keys walk the grid, which is also how you read across the diagonal.
  grid.addEventListener('keydown', (event) => {
    const cell = event.target.closest('.results__cell');
    if (cell === null) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select(cell);
      return;
    }
    const steps = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const step = steps[event.key];
    if (step === undefined) {
      return;
    }
    const a = Number(cell.dataset.a) + step[0];
    const b = Number(cell.dataset.b) + step[1];
    if (a < 0 || a > 10 || b < 0 || b > 10) {
      return;
    }
    event.preventDefault();
    const next = grid.querySelector(`[data-a="${a}"][data-b="${b}"]`);
    if (next !== null) {
      focus(next);
      select(next);
    }
  });

  container.replaceChildren(root);
}
