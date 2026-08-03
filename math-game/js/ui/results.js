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
//
// This screen is a HUB, not a terminus. A session is about three minutes and a
// good sitting is ten to fifteen, and the mechanism for the longer sitting is
// frictionless continuation rather than a longer bar — so both continuations
// are offered after BOTH modes, one click away, and neither is taken
// automatically. The renderer never navigates or starts anything itself; it
// reports which button was pressed through onResultsAction and main.js decides.

import { allFacts, answerOf, factId, parseFactId, transposeId } from '../facts.js';
import { isLearnable } from '../learn.js';
import { tableProgress } from '../ordered.js';

const OPERANDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// cold < warm < hot. Used only to tell a promotion from a regression when
// rendering `moved`; movement is NOT monotonic, so `from` may outrank `to`.
const BUCKET_RANK = { cold: 0, warm: 1, hot: 2 };

// FOUR DISPLAY STATES OVER THREE BUCKETS (spec §6).
//
// `bucket` in the mastery model is still exactly cold | warm | hot and nothing
// here changes that — the scheduler and the mastery thresholds are untouched.
// "Shown how" is a DISPLAY state, derived from `bucket === 'cold' && taught`:
// the fact has a route the kid has been walked through in learn mode but no
// clean drill answers yet. Three states cannot separate "no idea where to
// start" from "has a route, needs reps", and that difference is exactly what
// says which mode to run next, so the grid says it.
//
// `taught` only ever modifies the cold case. A warm or hot fact very often has
// `taught: true` as well — that is the normal path — and it must still render
// as getting there / from memory. Mastery outranks instruction.
const STATE_WORD = {
  cold: 'not started',
  shown: 'shown how',
  warm: 'getting there',
  hot: 'from memory',
};

/**
 * The display state of one fact. See STATE_WORD.
 *
 * @param {{bucket: string, taught: boolean}} stats
 * @returns {'cold' | 'shown' | 'warm' | 'hot'}
 */
function displayStateOf(stats) {
  return stats.bucket === 'cold' && stats.taught === true ? 'shown' : stats.bucket;
}

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
 * Counts are per DISPLAY state, so `cold` here means not-started-and-untaught.
 * `coldTotal` is the two cold states together, which is what the headline
 * counts — see renderResults.
 *
 * @param {import('../mastery.js').MasteryModel} model
 * @returns {{cold: number, shown: number, warm: number, hot: number, coldTotal: number}}
 */
function countStates(model) {
  const counts = { cold: 0, shown: 0, warm: 0, hot: 0, coldTotal: 0 };
  for (const fact of allFacts()) {
    counts[displayStateOf(model.byId.get(factId(fact)))] += 1;
  }
  counts.coldTotal = counts.cold + counts.shown;
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
 * How far the table an ordered session walked has peeled, or null when there is
 * no table to ask about.
 *
 * The number comes from `tableProgress`, the same function the menu's bars come
 * from, so the strip and the bar the kid is about to look at cannot disagree. It
 * counts the PEELED FRONT rather than every cleared fact in the row — see
 * `tableProgress` — which is the number that predicts how long the next run is.
 *
 * @param {import('../mastery.js').MasteryModel} model
 * @param {number | null | undefined} table
 * @returns {{table: number, cleared: number, total: number} | null}
 */
function progressForTable(model, table) {
  if (!Number.isInteger(table)) {
    return null;
  }
  return tableProgress(model).find((row) => row.table === table) ?? null;
}

/**
 * The session strip.
 *
 * DRILL: problems done, clean rate, typical time — unchanged from v1.
 *
 * NEITHER INSTRUCTION MODE GETS THE DRILL STRIP, and the reason is one reason
 * rather than two. Both instruction ladders are ['strategy', 'reveal'], so
 * neither mode has a `clean` rung AT ALL: their clean rate is not low, it is
 * structurally zero, and "0% from memory" is a failure grade handed to a session
 * that could not have scored anything else. Their medians are the same kind of
 * lie — time spent working an answer out is a different scale from retrieval
 * speed (spec §5), so setting one beside `previousMedianMs` would make exactly
 * the comparison §5 forbids. `previousSessionMedian` already refuses to record
 * an instruction session as the bar; this is the other half, refusing to measure
 * one against the bar.
 *
 * LEARN shows what it actually did: how many problems were worked through, and
 * how many squares now have a route.
 *
 * ORDERED shows the three numbers a kid marching a table wants: how many answers
 * she got through, how many of them she produced without pressing the button,
 * and how much of the eleven she can now start past. The third is what makes the
 * next visit shorter, so it is the one that means progress.
 *
 * @param {object} summary SessionSummary
 * @param {{cold: number, shown: number, warm: number, hot: number}} counts
 * @param {import('../mastery.js').MasteryModel} model for the table's progress
 * @returns {HTMLElement}
 */
function renderSummaryStrip(summary, counts, model) {
  const items = Number.isFinite(summary?.items) ? summary.items : 0;
  const cleanRate = summary?.cleanRate;
  const strip = el('div', 'results__stats');

  if (summary?.mode === 'ordered') {
    strip.append(statBlock(String(items), 'answers', 'worked through, in table order'));

    const unaided = Number.isFinite(summary?.unaided) ? summary.unaided : 0;
    strip.append(
      statBlock(
        String(unaided),
        'unaided',
        unaided === items
          ? 'every one of them right first time, no button'
          : 'right first time, without the button',
      ),
    );

    // Absent only if a table somehow reached here that ordered.js does not
    // serve. Two blocks then, rather than a block reading "— of —".
    const progress = progressForTable(model, summary?.table);
    if (progress !== null) {
      strip.append(
        statBlock(
          `${progress.cleared} of ${progress.total}`,
          `the ${progress.table}s`,
          // Zero needs its own sentence. A first visit to a table ends here
          // however well it went, because a fact peels on the SECOND unaided
          // run and not the first — so "you can start past these now" would be
          // a flat lie over a 0, at the end of a session the kid may have got
          // every single answer right.
          progress.cleared === 0
            ? 'a fact drops off after two clean times through'
            : progress.cleared >= progress.total
              ? 'the whole table — this row is done'
              : 'you can start past these now',
        ),
      );
    }
    return strip;
  }

  if (summary?.mode === 'learn') {
    strip.append(statBlock(String(items), 'answers', 'worked through with the strategy on screen'));
    strip.append(
      statBlock(
        String(counts.shown),
        'shown how',
        counts.shown === 1
          ? 'square has a route now — drill is what warms it up'
          : 'squares have a route now — drill is what warms them up',
      ),
    );
    return strip;
  }

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
 * @param {import('../mastery.js').MasteryModel} model
 * @param {object} summary SessionSummary
 * @returns {HTMLElement}
 */
function renderMoves(model, summary) {
  const section = el('section', 'results__moves');
  section.append(el('h2', 'results__h2', 'What moved'));

  const moved = Array.isArray(summary?.moved) ? summary.moved : [];
  if (moved.length === 0) {
    section.append(
      el(
        'p',
        'results__empty',
        // Both instruction modes, not just learn. Neither can move a colour —
        // their attempts are excluded from the buckets by construction — so
        // "that happens" would be telling a kid an empty list was bad luck
        // after a session that could not have produced a full one.
        summary?.mode === 'learn' || summary?.mode === 'ordered'
          ? 'These sessions never move the colours — they hand you the route. Drill is what turns a square from shown how to getting there.'
          : 'No squares changed colour this session. That happens — the colours only move when the last five tries say so.',
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

    // Movement is between BUCKETS; the words are DISPLAY states. A taught fact
    // that drops back to cold reads "getting there → shown how", not "→ not
    // started", because the route it was taught did not evaporate.
    const taught = model.byId.get(move.id)?.taught === true;
    const stateOf = (bucket) => (bucket === 'cold' && taught ? 'shown' : bucket);

    const item = el('li', `results__move results__move--${direction}`);
    item.append(el('span', 'results__move-arrow', up ? '↑' : down ? '↓' : '→'));
    item.append(el('span', 'results__move-fact', `${factLabel(fact)} = ${answerOf(fact)}`));

    const fromState = stateOf(move.from);
    const toState = stateOf(move.to);
    const from = el('span', `results__pill results__pill--${fromState}`, STATE_WORD[fromState]);
    const to = el('span', `results__pill results__pill--${toState}`, STATE_WORD[toState]);
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
      // Mismatch stays a BUCKET comparison. Two cold cells where only one has
      // been taught are not a drilling finding — the wedge means "these two
      // orientations are at different levels of mastery", and instruction is
      // not mastery.
      const mismatched = a !== b && mirror.bucket !== stats.bucket;
      const state = displayStateOf(stats);

      const cell = el('div', `results__cell results__cell--${state}`);
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
        `${a} times ${b} is ${answerOf(fact)}, ${STATE_WORD[state]}${
          mismatched ? `, but ${b} times ${a} is ${STATE_WORD[displayStateOf(mirror)]}` : ''
        }`,
      );
      row.append(cell);
    }
    grid.append(row);
  }

  return grid;
}

// THE THREE RUNGS (spec §3). The three modes are not three parallel
// measurements — they are ONE measurement, can she produce this answer, taken at
// three levels of scaffolding:
//
//   in order   strategy on screen, and she knows the last one was 2x6, so the
//              sequence is carrying her            WEAKEST evidence
//   learn      strategy on screen, randomized, nothing to lean on
//   drill      no hints, randomized, against a clock  STRONGEST evidence
//
// So the useful question is not "did she get it" but AT WHICH LEVEL OF SUPPORT
// can she still get it. The lines are drawn in that order, weakest first, which
// is what makes the block readable at a glance: the boundary between the ticks
// and the dots is her current level of support, and it says which mode to run
// next.
//
// `never` is a third state and not a variety of `not yet`. "She has been through
// the 2s twice and still needs the button" and "she has never been through the
// 2s" say opposite things about what to do, and one glyph for both would hide
// the difference in the case a parent most wants to see.
const RUNG_MARK = { cleared: '✓', tried: '·', never: '—' };

// For the aria-label, where a glyph reads as nothing useful.
const RUNG_STATE_WORD = { cleared: 'cleared', tried: 'not yet', never: 'never tried' };

/**
 * @param {number} n
 * @param {string} one
 * @param {string} many
 * @returns {string} e.g. "1 time" / "3 times"
 */
function count(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * One line of the three-rung block.
 *
 * @param {string} name the rung, as the kid sees it
 * @param {'cleared' | 'tried' | 'never'} state
 * @param {string} note what the numbers say
 * @returns {HTMLElement}
 */
function rungLine(name, state, note) {
  const item = el('li', `results__rung results__rung--${state}`);
  item.setAttribute('aria-label', `${name}: ${RUNG_STATE_WORD[state]}. ${note}`);
  const mark = el('span', 'results__rung-mark', RUNG_MARK[state]);
  mark.setAttribute('aria-hidden', 'true');
  item.append(mark);
  item.append(el('span', 'results__rung-name', name));
  item.append(el('span', 'results__rung-note', note));
  return item;
}

/**
 * The three-rung block: at which level of support can she still produce this?
 *
 * TWO NUMBERS NAMED `attempts` MEAN DIFFERENT THINGS, and the copy has to keep
 * them apart. `learn.attempts` counts ATTEMPTS — a learn session cycles its few
 * facts and each pass is a separate ask. `ordered.attempts` counts RUNS, whole
 * walks of the table, because an ordered run serves each fact exactly once and
 * two attempts inside one run are one occasion seen twice. Hence "times
 * through" on the ordered line and "tries" on the learn one. Rendering the
 * ordered number as answers typed would be wrong today only in wording, and
 * wrong in fact the moment a run stops serving each fact once.
 *
 * `taughtCount` is deliberately not rendered anywhere here. It counts
 * INSTRUCTION OCCASIONS OF EITHER KIND now that ordered attempts set `taught`,
 * so three ordered runs plus one learn session reads 4 — and any copy calling
 * that a number of lessons is now wrong.
 *
 * Drill's line reports the numbers it already had and clears on `bucket ===
 * 'hot'`, the rule it has always had. It is the only rung that DECAYS, and the
 * only one whose tick is a claim that she knows the fact.
 *
 * @param {import('../mastery.js').FactStats} stats
 * @returns {HTMLElement}
 */
function renderRungs(stats) {
  const block = el('div', 'results__block');
  block.append(el('h4', 'results__h4', 'How much help you still need'));

  const list = el('ul', 'results__rungs');

  const ordered = stats.ordered;
  const orderedRuns = count(ordered.attempts, 'time', 'times');
  list.append(
    rungLine(
      'in order',
      ordered.cleared ? 'cleared' : ordered.attempts === 0 ? 'never' : 'tried',
      ordered.attempts === 0
        ? 'this table has not been walked through yet'
        : ordered.cleared
          ? `on your own ${ordered.unaided} of ${orderedRuns} through — the run starts past it now`
          : `on your own ${ordered.unaided} of ${orderedRuns} through`,
    ),
  );

  const learn = stats.learn;
  const learnTries = count(learn.attempts, 'try', 'tries');
  list.append(
    rungLine(
      'learn',
      learn.cleared ? 'cleared' : learn.attempts === 0 ? 'never' : 'tried',
      learn.attempts === 0
        ? 'learn mode has not shown you this one yet'
        : `on your own ${learn.unaided} of ${learnTries} with the strategy up`,
    ),
  );

  const drilled = stats.attempts.length > 0;
  list.append(
    rungLine(
      'drill',
      stats.bucket === 'hot' ? 'cleared' : drilled ? 'tried' : 'never',
      !drilled
        ? 'not drilled yet'
        : stats.cleanCount === 0
          ? 'no answers straight from memory yet'
          : `${stats.cleanCount} straight from memory, typically ${formatMs(stats.medianCleanMs)}`,
    ),
  );

  block.append(list);
  block.append(el('p', 'results__caption', 'most help at the top'));
  return block;
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

  const state = displayStateOf(stats);

  const heading = el('h3', 'results__detail-title');
  heading.append(el('span', 'results__detail-fact', `${factLabel(fact)} = ${answerOf(fact)}`));
  heading.append(el('span', `results__pill results__pill--${state}`, STATE_WORD[state]));
  panel.append(heading);

  // The clean count and the typical time used to be a standalone line here.
  // They are drill's rung and nothing else, so they moved onto drill's line
  // rather than being said twice a few pixels apart.
  panel.append(renderRungs(stats));

  // Which mode to send this fact to next — the whole reason the fourth state
  // exists. Eligibility is asked of learn.js rather than re-derived here.
  if (state === 'shown') {
    panel.append(
      el(
        'p',
        'results__detail-line',
        'You have been shown a way to work this one out. Drill is what makes it quick.',
      ),
    );
  } else if (state === 'cold' && isLearnable(fact)) {
    panel.append(
      el('p', 'results__detail-line', 'Learn mode can show you a way to work this one out.'),
    );
  }

  // The mirror. Only interesting when the two orientations disagree, which is
  // exactly the case the grid is built to make visible.
  if (fact.a !== fact.b) {
    const mirror = model.byId.get(transposeId(fact));
    const mirrorState = displayStateOf(mirror);
    const mirrorLine = el('p', 'results__mirror');
    if (mirror.bucket !== stats.bucket) {
      // The finding: different levels of mastery in the two directions.
      mirrorLine.classList.add('is-mismatched');
      mirrorLine.textContent = `Same numbers the other way round, ${factLabel(mirror.fact)}, is ${STATE_WORD[mirrorState]}. Worth drilling the slower direction.`;
    } else if (mirrorState === state) {
      mirrorLine.textContent = `${factLabel(mirror.fact)} is ${STATE_WORD[mirrorState]} too — both ways round match.`;
    } else {
      // Same bucket, different display state: one direction has been taught and
      // the other has not. Not a drilling finding, so it is stated flatly.
      mirrorLine.textContent = `${factLabel(mirror.fact)} is at the same level — ${STATE_WORD[mirrorState]}.`;
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
 * Which table the ordered continuation should offer, or null when there is none.
 *
 * Three cases, in order:
 *
 * - The table just walked still has facts left — offer it AGAIN. A run gets
 *   shorter across visits rather than within one, so "again" is the normal way
 *   to finish a table and not a repeat of anything.
 * - It finished, or the session was not an ordered one — offer the next
 *   unfinished table, wrapping past the tens back to the twos. Wrapping matters:
 *   a kid who finishes the 9s should be handed the 3s she left half done, not
 *   nothing.
 * - Every table is done — null, and the caller renders no button at all. Same
 *   rule `canLearn` already enforces for learn: a button that starts a session
 *   with nothing in it is worse than no button.
 *
 * `current` is only ever a table when an ordered session just ended; after drill
 * and learn it is null and the lowest unfinished table is offered.
 *
 * @param {import('../mastery.js').MasteryModel} model
 * @param {number | null} current the table just played, or null
 * @returns {number | null}
 */
function nextOrderedTable(model, current) {
  const unfinished = tableProgress(model).filter((row) => row.cleared < row.total);
  if (unfinished.length === 0) {
    return null;
  }
  if (!Number.isInteger(current)) {
    return unfinished[0].table;
  }
  const again = unfinished.find((row) => row.table === current);
  if (again !== undefined) {
    return again.table;
  }
  return (unfinished.find((row) => row.table > current) ?? unfinished[0]).table;
}

/**
 * The continuation row. Every continuation appears after EVERY mode: the screen
 * that ends a session is also the one that starts the next, because the way to
 * a fifteen-minute sitting is one more three-minute block, not a longer bar. The
 * table button shows after a drill and after a learn session too — which mode is
 * the better next step depends on the kid, not on which one just finished, and
 * the screen does not presume to know.
 *
 * Nothing here starts anything. The buttons carry a `data-results-action` and a
 * `data-table` where there is one, and that is all; main.js owns every state
 * transition and decides what "learn" means. See onResultsAction.
 *
 * TWO BUTTONS CAN VANISH, both for the same reason. Learn goes when
 * `summary.canLearn` is explicitly false — every strategy-bearing fact is
 * already hot and there is nothing left to teach. The table goes when every
 * table is done. In both cases the alternative is a button that leads to a
 * session with nothing in it.
 *
 * @param {object} summary SessionSummary
 * @param {import('../mastery.js').MasteryModel} model
 * @returns {HTMLElement}
 */
function renderActions(summary, model) {
  const row = el('nav', 'results__actions');
  row.setAttribute('aria-label', 'What next');

  const button = (action, label, kind) => {
    const node = el('button', `results__action results__action--${kind}`, label);
    node.type = 'button';
    node.dataset.resultsAction = action;
    return node;
  };

  if (summary?.canLearn !== false) {
    row.append(button('learn', 'Learn 3 facts', 'go'));
  }

  const played = summary?.mode === 'ordered' ? summary?.table : null;
  const table = nextOrderedTable(model, Number.isInteger(played) ? played : null);
  if (table !== null) {
    const node = button(
      'ordered',
      table === played ? `The ${table}s again` : `The ${table}s`,
      'go',
    );
    // The one action that carries a payload. onResultsAction reads it back off
    // the button, so the row stays the only place that decides which table.
    node.dataset.table = String(table);
    row.append(node);
  }

  row.append(button('drill', 'Drill 20', 'go'));
  row.append(button('done', 'Done', 'quiet'));

  return row;
}

/** @type {WeakMap<HTMLElement, (event: Event) => void>} */
const ACTION_LISTENERS = new WeakMap();

/**
 * Register the handler for the continuation row. Delegated on `container`, so it
 * survives any number of re-renders of the screen inside it, and re-registering
 * REPLACES the previous handler rather than stacking a second one.
 *
 * The handler is called with `(action, table)`, where `table` is a number for
 * `'ordered'` and null for everything else — the same shape onMenuAction hands
 * over, because main.js's `onAction` serves both screens.
 *
 * `'done'` is kept as the name of the Done button. main.js accepts it and
 * `'menu'` as the same thing, and renaming it here would be a change to a wire
 * name for no gain.
 *
 * @param {HTMLElement} container
 * @param {(action: 'learn' | 'drill' | 'ordered' | 'done', table: number | null) => void} handler
 * @returns {void}
 */
export function onResultsAction(container, handler) {
  const existing = ACTION_LISTENERS.get(container);
  if (existing !== undefined) {
    container.removeEventListener('click', existing);
  }
  const listener = (event) => {
    const button = event.target.closest('[data-results-action]');
    if (button !== null && container.contains(button)) {
      // `dataset.table` is absent on every button but the ordered one, and
      // `parseInt(undefined)` is NaN — which `isTable` in main.js refuses. Null
      // is handed over instead, so "this action has no table" is one value
      // rather than two.
      const raw = button.dataset.table;
      handler(button.dataset.resultsAction, raw === undefined ? null : Number.parseInt(raw, 10));
    }
  };
  ACTION_LISTENERS.set(container, listener);
  container.addEventListener('click', listener);
}

/**
 * The headline over the grid.
 *
 * It counts BOTH cold states, because both mean the same thing about the fact:
 * it has never come back from memory. "Shown how" is progress, not completion,
 * and shrinking the headline for it would be claiming a fact is done when the
 * kid has only watched it being worked out — the number would stop meaning
 * "work left" and the grid would stop being trustworthy.
 *
 * The learn session still visibly registers, because the two cold states are
 * named separately underneath: after a learn session three squares move from
 * not started to shown how and both halves of the sentence change, even though
 * the total does not.
 *
 * @param {{cold: number, shown: number, coldTotal: number}} counts
 * @returns {string}
 */
function headline(counts) {
  const { cold, shown, coldTotal } = counts;
  if (coldTotal === 0) {
    return 'No cold squares left. Every fact has been answered from memory at least once.';
  }
  const total = `${coldTotal} cold ${coldTotal === 1 ? 'square' : 'squares'} left`;
  if (shown === 0) {
    return `${total}.`;
  }
  if (cold === 0) {
    return `${total} — all of them shown how, ready to drill.`;
  }
  return `${total} — ${shown} shown how, ${cold} not started.`;
}

/**
 * Which session just ended, under the title.
 *
 * Ordered mode names its row, because "In order" alone would be the one mode
 * whose session you cannot identify afterwards — there are nine of them and
 * they differ only by which table was walked.
 *
 * @param {object} summary SessionSummary
 * @returns {string}
 */
function subtitle(summary) {
  if (summary?.mode === 'ordered') {
    return Number.isInteger(summary?.table)
      ? `In order · the ${summary.table}s`
      : 'In order';
  }
  return summary?.mode === 'learn' ? 'Learn session' : 'Drill session';
}

/**
 * Render the results screen into `container`, replacing whatever was there.
 *
 * @param {HTMLElement} container
 * @param {import('../mastery.js').MasteryModel} model total over all 121 facts
 * @param {object} summary SessionSummary — { session, mode, table, items,
 *   cleanRate, unaided, medianMs, previousMedianMs, moved, canLearn }.
 *   `previousMedianMs` is null on a first run; `table` is a number for ordered
 *   sessions and null otherwise.
 * @returns {void}
 */
export function renderResults(container, model, summary) {
  const root = el('section', 'results');
  const counts = countStates(model);

  const header = el('header', 'results__header');
  header.append(el('h1', 'results__title', 'Session done'));
  header.append(el('p', 'results__subtitle', subtitle(summary)));
  root.append(header);

  root.append(renderSummaryStrip(summary, counts, model));
  root.append(renderActions(summary, model));
  root.append(renderMoves(model, summary));

  const gridSection = el('section', 'results__grid-section');
  const gridHead = el('div', 'results__grid-head');
  gridHead.append(el('h2', 'results__h2', 'Your table'));
  gridHead.append(el('p', 'results__coldcount', headline(counts)));
  gridSection.append(gridHead);

  const legend = el('div', 'results__legend');
  for (const state of ['cold', 'shown', 'warm', 'hot']) {
    const entry = el('span', 'results__legend-entry');
    entry.append(el('span', `results__swatch results__swatch--${state}`));
    entry.append(el('span', 'results__legend-text', `${STATE_WORD[state]} (${counts[state]})`));
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
