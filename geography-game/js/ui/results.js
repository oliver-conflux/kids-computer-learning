// Results screen: the session summary, the frontier, and the countries in play.
//
// This module renders and nothing else. It holds no game state beyond which chip
// the kid last tapped, which lives for exactly as long as the rendered screen
// does. Everything it shows is read from the MasteryModel and the SessionSummary
// it is handed, and it never navigates or starts anything itself.
//
// MODELLED ON spelling-game/js/ui/results.js, and shorter than it by exactly the
// two things this game does not have: there is no learn mode, so there is no
// fourth "shown how" display state and no second continuation button, and there
// is no pattern table, so a country's detail panel has nothing to say about
// routes. What remains is the same screen with the same vocabulary, which is the
// point — a kid moving between the games reads the same four words for the same
// states.
//
// THE ITEM IS A COUNTRY *AND A PROMPT*. `Belize` appears twice, once as a map
// and once as a flag, and they carry separate mastery on purpose (js/space.js).
// So every chip and every heading names both. A screen that showed the country
// alone would merge two records that the whole spine exists to keep apart, and
// the parent looking at it could not tell which half is weak.
//
// What deliberately does NOT appear: any speed score, any countries-per-minute,
// any target or age norm, any comparison to another person, any streak, and any
// countdown or clock. Time is measured relentlessly and never shown as a score.
// Latency appears once, as "your typical time", phrased as an observation.
// `config.hotMs` is deliberately NOT rendered anywhere: telling a kid that four
// seconds is the bar turns the one latency line on this screen into a target to
// beat, which is the habit the whole game is built to avoid.
//
// TWO comparisons are permitted and both are the kid against her own previous
// session — the median (see comparisonNote) and the frontier (see frontierNote).
// There is no third reference point anywhere in this file.
//
// This screen is a HUB, not a terminus. A session is a few minutes and a good
// sitting is ten to fifteen, and the mechanism for the longer sitting is
// frictionless continuation rather than a longer bar. The renderer reports which
// button was pressed through onResultsAction and main.js decides what it means.

// cold < warm < hot. Used only to tell a promotion from a regression when
// rendering `moved`; movement is NOT monotonic, so `from` may outrank `to`.
const BUCKET_RANK = { cold: 0, warm: 1, hot: 2 };

// THE SAME WORDS THE SPELLING AND MATH SCREENS USE, on purpose. A kid moving
// between the games should not have to learn a second vocabulary for the same
// idea. There are three rather than four because this game has no learn mode and
// therefore nothing that is "shown how" — `taught` is false for every item here
// by construction, and inventing a state nothing can reach would be a legend
// entry that never lights up.
const STATE_WORD = {
  cold: 'not started',
  warm: 'getting there',
  hot: 'from memory',
};

const STATES = ['cold', 'warm', 'hot'];

// What each prompt is called on this screen. The spine's `kind` is `shape`, but
// nothing a kid sees should say "shape" — what is on screen is a map.
const KIND_WORD = { shape: 'map', flag: 'flag' };

// A stage is `clean` or `rN`, where N is how many letters had greyed into the
// slots when the name landed. The ladder itself belongs to the country screen
// and is not restated here — this only has to READ what the log recorded, months
// after the ladder that produced it may have changed shape.
const REVEAL_STAGE = /^r(\d+)$/;

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

/** What this item is called in a sentence: `Belize (map)`. */
function labelOf(item) {
  return `${item.name} (${KIND_WORD[item.kind] ?? item.kind})`;
}

/**
 * Latency for display. The model's medians are unrounded and can be fractional
 * — 4500 from a 4400/4600 pair — so rounding happens here, at the edge, and
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
 * @param {number} value
 * @returns {string} grouped, so a three-digit spine position reads as a number
 *   rather than a serial code
 */
function formatCount(value) {
  return Number.isFinite(value) ? value.toLocaleString('en-GB') : '—';
}

/**
 * The short chip under an attempt's latency.
 *
 * Exported for tests: this is the one piece of the log the screen has to
 * INTERPRET rather than display, and the stage vocabulary is written by another
 * module into a file that outlives both.
 *
 * @param {string} stage
 * @returns {string}
 */
export function stageChip(stage) {
  if (stage === 'clean') {
    return 'clean';
  }
  const revealed = REVEAL_STAGE.exec(String(stage));
  if (revealed !== null) {
    return `${revealed[1]} shown`;
  }
  // Anything else falls through to itself rather than being guessed at. The
  // rungs are the country screen's to name, and a stage this file does not
  // recognise is more likely a ladder that changed shape than a bug here.
  return String(stage);
}

/**
 * The long form, for the chip's tooltip. Exported for tests alongside stageChip.
 *
 * @param {string} stage
 * @returns {string}
 */
export function stageText(stage) {
  if (stage === 'clean') {
    return 'straight from memory, no letters given';
  }
  const revealed = REVEAL_STAGE.exec(String(stage));
  if (revealed !== null) {
    const count = Number(revealed[1]);
    return `after ${count} ${count === 1 ? 'letter' : 'letters'} showed`;
  }
  return String(stage);
}

/**
 * Name what a wrong answer actually was.
 *
 * This is the geography analogue of the math screen's "that's 6 × 8" note and
 * the spelling screen's "the right letters, two swapped over", and it exists for
 * the same reason: a wrong answer is rarely random, and saying what kind of
 * wrong it was turns a list of junk strings into the one diagnostic sentence a
 * parent can act on. `guatemala` typed for Belize is not a kid who knows
 * nothing — it is a kid who has the right region and the wrong country, and that
 * is a completely different lesson from `belgium`.
 *
 * ONLY THE ONE HONEST CLAIM IS MADE. If the typed letters are another country's
 * name, that country is named. Anything else gets no note at all rather than a
 * guess, because the note is the part a parent will believe.
 *
 * Pure. Exported for tests, and takes the lookup as a parameter so the test does
 * not have to reason about the shipped spine.
 *
 * @param {unknown} typed what was entered, letters only
 * @param {Map<string, string>} nameByTarget target -> display name
 * @returns {string | null} a short phrase, or null when nothing honest can be said
 */
export function describeWrong(typed, nameByTarget) {
  if (typeof typed !== 'string' || typed === '') {
    return null;
  }
  const name = nameByTarget.get(typed);
  return name === undefined ? null : `that is ${name}`;
}

/**
 * State counts across the WHOLE spine.
 *
 * `model.byId` is total over the item space by contract, so this counts every
 * item the game knows about without importing the spine — the model is the only
 * thing this screen is handed and the only thing it should need.
 *
 * @param {import('../../../core/mastery.js').MasteryModel} model
 * @returns {{cold: number, warm: number, hot: number, total: number}}
 */
function countStates(model) {
  const counts = { cold: 0, warm: 0, hot: 0, total: 0 };
  for (const stats of model.byId.values()) {
    counts[stats.bucket] += 1;
    counts.total += 1;
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
 * The first of the two permitted comparisons: this session's median against the
 * kid's own previous session.
 *
 * Every other reference point is forbidden by the design — no target time, no
 * age norm, no other kid — and without this one the median is a number with
 * nothing to mean. So it is one of exactly two, and it is deliberately lopsided
 * in tone: a faster session is celebrated, a slower session is stated and
 * shrugged off. A slower median is frequently not a worse session. The retain
 * window means an improving kid who has just advanced onto longer names posts a
 * slower median for entirely boring statistical reasons, and beyond that, kids
 * have bad days. Reading that back as failure would teach them to chase the
 * clock, which is the one habit this game exists to avoid.
 *
 * The comparison is made on the values as they will be DISPLAYED, not on the raw
 * ones, so the sentence can never contradict the two numbers next to it by
 * calling 4.44s and 4.35s different when both render as "4.4s".
 *
 * Pure. Exported for tests.
 *
 * @param {number | null | undefined} medianMs this session
 * @param {number | null | undefined} previousMedianMs last session, null on a first run
 * @returns {{text: string, tone: string}}
 */
export function comparisonNote(medianMs, previousMedianMs) {
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
 * The second permitted comparison: where the frontier sits now against where it
 * sat at the end of the previous session.
 *
 * THE FRONTIER CAN MOVE BACKWARDS and that is not a bug. A hot item cools when
 * its clean answers age out of the retain window, at which point it re-enters
 * the active window and pulls the far edge back with it. That is the mastery
 * model working exactly as designed, so it is reported as plainly as a promotion
 * — no red, no apology, and with a word about why.
 *
 * Pure. Exported for tests.
 *
 * @param {number} frontier spine index reached this session
 * @param {number | null | undefined} previousFrontier the same number last session
 * @returns {{text: string, tone: string}}
 */
export function frontierNote(frontier, previousFrontier) {
  if (!Number.isFinite(frontier)) {
    return { text: 'where you are up to on the list', tone: 'plain' };
  }
  if (previousFrontier === null || !Number.isFinite(previousFrontier)) {
    return { text: 'first session — this is your starting point', tone: 'first' };
  }
  const moved = frontier - previousFrontier;
  if (moved === 0) {
    return { text: 'same place as last time', tone: 'same' };
  }
  if (moved > 0) {
    return {
      text: `${moved} ${moved === 1 ? 'step' : 'steps'} further along than last time`,
      tone: 'forward',
    };
  }
  const back = -moved;
  return {
    text: `${back} came back round — they do that when it has been a while`,
    tone: 'back',
  };
}

/**
 * The session strip: countries done, clean rate, typical time.
 *
 * @param {object} summary SessionSummary
 * @returns {HTMLElement}
 */
function renderSummaryStrip(summary) {
  const items = Number.isFinite(summary?.items) ? summary.items : 0;
  const cleanRate = summary?.cleanRate;
  const strip = el('div', 'results__stats');

  strip.append(statBlock(String(items), 'named', 'this session'));

  const cleanNote =
    Number.isFinite(cleanRate) && items > 0
      ? `${Math.round(cleanRate * items)} of ${items} with no letters given`
      : 'named before any letter showed';
  strip.append(statBlock(formatRate(cleanRate), 'from memory', cleanNote));

  const comparison = comparisonNote(summary?.medianMs, summary?.previousMedianMs ?? null);
  strip.append(
    statBlock(formatMs(summary?.medianMs), 'typical time', comparison.text, comparison.tone),
  );

  return strip;
}

/**
 * The continuation row. The screen that ends a session is also the one that
 * starts the next, because the way to a fifteen-minute sitting is one more short
 * session, not a longer bar.
 *
 * Nothing in this row starts anything. The buttons carry a `data-results-action`
 * and that is all; main.js owns every state transition. See onResultsAction.
 *
 * @param {{sessionLength: number}} config
 * @returns {HTMLElement}
 */
function renderActions(config) {
  const row = el('nav', 'results__actions');
  row.setAttribute('aria-label', 'What next');

  const button = (action, label, kind) => {
    const node = el('button', `results__action results__action--${kind}`, label);
    node.type = 'button';
    node.dataset.resultsAction = action;
    return node;
  };

  row.append(button('play', `Name ${config.sessionLength} more`, 'go'));
  // Quiet, so stopping is easy and unpunished but never the thing the eye lands
  // on.
  row.append(button('done', 'Done', 'quiet'));

  return row;
}

/**
 * Bucket movements this session.
 *
 * Movement is NOT one-way. An item drops back when its clean answers age out of
 * the retain window, so hot -> cold is a real and expected transition and is
 * rendered as plainly as a promotion — just without the celebration, and with a
 * word about why it happened. Direction is computed from the two buckets; `from`
 * is never assumed to be the worse one.
 *
 * @param {import('../../../core/mastery.js').MasteryModel} model
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
        'Nothing changed colour this session. That happens — the colours only move when the last few tries say so.',
      ),
    );
    return section;
  }

  const list = el('ul', 'results__move-list');
  for (const move of moved) {
    const stats = model.byId.get(move.id);
    if (stats === undefined) {
      continue; // an item that has left the spine; nothing truthful to draw
    }
    const up = BUCKET_RANK[move.to] > BUCKET_RANK[move.from];
    const down = BUCKET_RANK[move.to] < BUCKET_RANK[move.from];
    const direction = up ? 'up' : down ? 'down' : 'flat';

    const item = el('li', `results__move results__move--${direction}`);
    item.append(el('span', 'results__move-arrow', up ? '↑' : down ? '↓' : '→'));
    item.append(el('span', 'results__move-name', labelOf(stats.item)));

    const from = el('span', `results__pill results__pill--${move.from}`, STATE_WORD[move.from]);
    const to = el('span', `results__pill results__pill--${move.to}`, STATE_WORD[move.to]);
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
 * The frontier: how far down the spine the active window has reached.
 *
 * There is no stored level in this game and no placement test — the window is
 * recomputed from the log every load (core/frontier.js). That makes progress
 * real but invisible, and this section is the only place it is ever shown. It is
 * the reason the session event carries `frontier`.
 *
 * The bar is a POSITION, not a timer and not a score. It carries a mark at last
 * session's position so the movement is visible rather than asserted, and it
 * counts items — never seconds.
 *
 * @param {object} summary SessionSummary
 * @param {{cold: number, warm: number, hot: number, total: number}} counts
 * @returns {HTMLElement}
 */
function renderFrontier(summary, counts) {
  const section = el('section', 'results__frontier');
  section.append(el('h2', 'results__h2', 'Where you are up to'));

  const total = counts.total;
  const frontier = Number.isFinite(summary?.frontier) ? summary.frontier : 0;
  // `frontier` is a spine INDEX, so the item at it is the (index + 1)th. Clamped
  // because a finished spine reports an index one past the end.
  const position = Math.max(0, Math.min(frontier + 1, total));
  const previous = Number.isFinite(summary?.previousFrontier) ? summary.previousFrontier : null;

  const line = el('p', 'results__frontier-line');
  line.append(el('span', 'results__frontier-position', formatCount(position)));
  line.append(el('span', 'results__frontier-of', `of ${formatCount(total)}`));
  section.append(line);

  const note = frontierNote(frontier, previous);
  section.append(el('p', `results__frontier-note results__frontier-note--${note.tone}`, note.text));

  const track = el('div', 'results__spine');
  track.setAttribute('role', 'img');
  track.setAttribute('aria-label', `${position} of ${total} on the list. ${note.text}.`);
  const fill = el('div', 'results__spine-fill');
  fill.style.setProperty('--reached', total > 0 ? String(position / total) : '0');
  track.append(fill);
  if (previous !== null && total > 0) {
    const mark = el('div', 'results__spine-mark');
    const at = Math.max(0, Math.min(previous + 1, total)) / total;
    mark.style.setProperty('--at', String(at));
    track.append(mark);
  }
  section.append(track);

  // Stated as a countable set rather than a percentage. "Forty from memory" is
  // an achievement; "12%" of a list nobody finishes is a grade.
  section.append(
    el(
      'p',
      'results__frontier-mastered',
      counts.hot === 1
        ? '1 you can name from memory so far.'
        : `${formatCount(counts.hot)} you can name from memory so far.`,
    ),
  );

  return section;
}

/**
 * One chip in the active window. Names the country AND the prompt, because they
 * are separate items with separate mastery.
 *
 * @param {object} stats ItemStats
 * @returns {HTMLElement}
 */
function itemChip(stats) {
  const state = stats.bucket;
  const kind = KIND_WORD[stats.item.kind] ?? stats.item.kind;
  const chip = el('button', `results__item results__item--${state}`);
  chip.type = 'button';
  chip.tabIndex = -1;
  chip.dataset.id = stats.id;
  chip.append(el('span', 'results__item-name', stats.item.name));
  chip.append(el('span', 'results__item-kind', kind));
  chip.setAttribute('aria-label', `${stats.item.name}, ${kind}, ${STATE_WORD[state]}`);
  return chip;
}

/**
 * The items currently in play — the active window, in spine order.
 *
 * This is the small, concrete, visibly shrinking set of work that the math
 * game's cold-cell count provides, and it is scoped to the window rather than
 * the spine for the same reason the window exists: 344 items is not a job, and
 * twelve is.
 *
 * @param {import('../../../core/mastery.js').MasteryModel} model
 * @param {string[]} windowIds ids, spine order. Not named `window` — this is a
 *   browser module and shadowing the global there is a trap for the next reader.
 * @returns {{section: HTMLElement, list: HTMLElement | null}}
 */
function renderWindow(model, windowIds) {
  const section = el('section', 'results__window');
  const head = el('div', 'results__window-head');
  head.append(el('h2', 'results__h2', 'The ones you are on'));
  section.append(head);

  if (windowIds.length === 0) {
    // Reachable, and a real state rather than an error: everything in the spine
    // is hot. Say so as the finish it is.
    section.append(
      el(
        'p',
        'results__empty',
        'Nothing left in the window — every country on the list has come back from memory. That is the whole list.',
      ),
    );
    return { section, list: null };
  }

  const list = el('div', 'results__items');
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', 'In play now, nearest home first');
  for (const id of windowIds) {
    const stats = model.byId.get(id);
    if (stats !== undefined) {
      list.append(itemChip(stats));
    }
  }
  section.append(list);

  return { section, list };
}

/**
 * The detail panel for one item.
 *
 * @param {import('../../../core/mastery.js').MasteryModel} model
 * @param {string} id
 * @param {{retain: number}} config
 * @param {Map<string, string>} nameByTarget
 * @returns {HTMLElement}
 */
function renderDetail(model, id, config, nameByTarget) {
  const stats = model.byId.get(id);
  const panel = el('div', 'results__detail-body');
  const state = stats.bucket;

  const heading = el('h3', 'results__detail-title');
  heading.append(el('span', 'results__detail-name', labelOf(stats.item)));
  heading.append(el('span', `results__pill results__pill--${state}`, STATE_WORD[state]));
  panel.append(heading);

  const line =
    stats.cleanCount === 0
      ? 'Not yet named with no letters given.'
      : `${stats.cleanCount} named straight from memory, typically ${formatMs(stats.medianCleanMs)}.`;
  panel.append(el('p', 'results__detail-line', line));

  // The sibling prompt. The whole reason shape and flag are separate items is
  // that one can be solid while the other is not, and this is the only place
  // that shows up — otherwise a parent sees "Belize, getting there" twice and
  // has to hold the pair in their head.
  const sibling = model.byId.get(siblingIdOf(id));
  if (sibling !== undefined) {
    const kind = KIND_WORD[sibling.item.kind] ?? sibling.item.kind;
    panel.append(
      el('p', 'results__detail-line', `Its ${kind}: ${STATE_WORD[sibling.bucket]}.`),
    );
  }

  // Recent attempts, oldest first — `attempts` is most-recent-LAST.
  const attemptsBlock = el('div', 'results__block');
  attemptsBlock.append(el('h4', 'results__h4', `Last ${config.retain} tries`));
  if (stats.attempts.length === 0) {
    attemptsBlock.append(el('p', 'results__empty', 'Not asked yet.'));
  } else {
    const chips = el('ul', 'results__chips');
    stats.attempts.forEach((attempt, index) => {
      const chip = el(
        'li',
        `results__chip results__chip--${attempt.stage === 'clean' ? 'clean' : 'helped'}`,
      );
      chip.append(el('span', 'results__chip-ms', formatMs(attempt.ms)));
      chip.append(el('span', 'results__chip-stage', stageChip(attempt.stage)));
      if (attempt.wrong.length > 0) {
        chip.append(el('span', 'results__chip-wrong', `typed ${attempt.wrong.join(', ')}`));
      }
      chip.title = `${formatMs(attempt.ms)}, ${stageText(attempt.stage)}`;
      if (index === stats.attempts.length - 1) {
        chip.classList.add('is-latest');
      }
      chips.append(chip);
    });
    attemptsBlock.append(chips);
    attemptsBlock.append(el('p', 'results__caption', 'oldest → most recent'));
  }
  panel.append(attemptsBlock);

  // Wrong answers come from the whole log, not just the retained window: a
  // country named wrongly three weeks ago is still what this shape looks like in
  // the kid's head, and it must not age out just because it has been asked since.
  const wrongBlock = el('div', 'results__block');
  wrongBlock.append(el('h4', 'results__h4', 'Names that were not right'));
  const wrong = [...(model.confusions.get(id) ?? [])].sort();
  if (wrong.length === 0) {
    wrongBlock.append(el('p', 'results__empty', 'None — every name here has been right.'));
  } else {
    const list = el('ul', 'results__wrongs');
    for (const value of wrong) {
      const entry = el('li', 'results__wrong');
      entry.append(el('span', 'results__wrong-value', String(value)));
      const note = describeWrong(String(value), nameByTarget);
      if (note !== null) {
        entry.append(el('span', 'results__wrong-note', note));
      }
      list.append(entry);
    }
    wrongBlock.append(list);
  }
  panel.append(wrongBlock);

  return panel;
}

/**
 * The other prompt for the same country. Written here rather than imported from
 * the adapter's `relatedIds` because that returns an array and this panel wants
 * the one sibling; the encoding is the adapter's and this is the only place the
 * screen restates it.
 */
function siblingIdOf(id) {
  const parts = String(id).split(':');
  if (parts.length !== 3) {
    return '';
  }
  const [prefix, kind, code] = parts;
  return `${prefix}:${kind === 'shape' ? 'flag' : 'shape'}:${code}`;
}

/** @type {WeakMap<HTMLElement, (event: Event) => void>} */
const ACTION_LISTENERS = new WeakMap();

/**
 * Register the handler for the continuation row. Delegated on `container`, so it
 * survives any number of re-renders of the screen inside it, and re-registering
 * REPLACES the previous handler rather than stacking a second one.
 *
 * The handler is called with exactly one of `'play' | 'done'`.
 *
 * @param {HTMLElement} container
 * @param {(action: 'play' | 'done') => void} handler
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
      handler(button.dataset.resultsAction);
    }
  };
  ACTION_LISTENERS.set(container, listener);
  container.addEventListener('click', listener);
}

/**
 * Render the results screen into `container`, replacing whatever was there.
 *
 * @param {HTMLElement} container
 * @param {import('../../../core/mastery.js').MasteryModel} model total over the spine
 * @param {object} summary SessionSummary — `{ session, items, cleanRate,
 *   medianMs, previousMedianMs, moved, window, frontier, previousFrontier }`.
 *   `previousMedianMs` and `previousFrontier` are null on a first run.
 * @param {object} config the game's CONFIG — reads `sessionLength` and `retain`
 * @returns {void}
 */
export function renderResults(container, model, summary, config) {
  const root = el('section', 'results');
  const counts = countStates(model);
  const windowIds = Array.isArray(summary?.window) ? summary.window : [];

  // Built once per render rather than per wrong answer, and derived from the
  // model rather than imported from the spine, so this file stays free of the
  // country list.
  const nameByTarget = new Map();
  for (const stats of model.byId.values()) {
    nameByTarget.set(stats.item.target, stats.item.name);
  }

  const header = el('header', 'results__header');
  header.append(el('h1', 'results__title', 'Session done'));
  header.append(el('p', 'results__subtitle', 'Naming countries'));
  root.append(header);

  root.append(renderSummaryStrip(summary));
  root.append(renderActions(config));
  root.append(renderMoves(model, summary));
  root.append(renderFrontier(summary, counts));

  const { section: windowSection, list } = renderWindow(model, windowIds);

  const legend = el('div', 'results__legend');
  for (const state of STATES) {
    const entry = el('span', 'results__legend-entry');
    entry.append(el('span', `results__swatch results__swatch--${state}`));
    entry.append(el('span', 'results__legend-text', STATE_WORD[state]));
    legend.append(entry);
  }
  windowSection.append(legend);

  const detail = el('div', 'results__detail');
  detail.append(el('p', 'results__detail-hint', 'Tap any one to see how it is going.'));
  windowSection.append(detail);
  root.append(windowSection);

  // --- interaction -------------------------------------------------------
  // Selection lives here, for exactly as long as this rendered screen does.

  if (list !== null) {
    let focused = list.querySelector('.results__item');
    if (focused !== null) {
      focused.tabIndex = 0;
    }

    const select = (chip) => {
      for (const marked of list.querySelectorAll('.is-selected')) {
        marked.classList.remove('is-selected');
      }
      chip.classList.add('is-selected');
      detail.replaceChildren(renderDetail(model, chip.dataset.id, config, nameByTarget));
    };

    const focus = (chip) => {
      if (focused !== null) {
        focused.tabIndex = -1;
      }
      focused = chip;
      chip.tabIndex = 0;
      chip.focus();
    };

    list.addEventListener('click', (event) => {
      const chip = event.target.closest('.results__item');
      if (chip !== null) {
        focus(chip);
        select(chip);
      }
    });

    // Roving tabindex: the chips are one list, so one pair of arrow keys walks
    // it and Home/End jump to the ends.
    list.addEventListener('keydown', (event) => {
      const chip = event.target.closest('.results__item');
      if (chip === null) {
        return;
      }
      const chips = [...list.querySelectorAll('.results__item')];
      const index = chips.indexOf(chip);
      const steps = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
      let next = null;
      if (event.key === 'Home') {
        next = chips[0];
      } else if (event.key === 'End') {
        next = chips[chips.length - 1];
      } else if (steps[event.key] !== undefined) {
        next = chips[index + steps[event.key]] ?? null;
      } else {
        return;
      }
      if (next !== null) {
        event.preventDefault();
        focus(next);
        select(next);
      }
    });
  }

  container.replaceChildren(root);
}
