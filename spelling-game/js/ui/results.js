// Results screen: the session summary, the frontier, and the words in play.
//
// This module renders and nothing else. It holds no game state beyond which
// word chip the kid last tapped, which lives for exactly as long as the
// rendered screen does. Everything it shows is read from the MasteryModel and
// the SessionSummary it is handed, and it never navigates or starts anything
// itself.
//
// WHAT REPLACES THE MATH GAME'S GRID. Math has 121 facts, so its results screen
// draws all of them and the picture IS the progress report. Spelling has a
// thousand-word spine, and a thousand cells would be a wall rather than a
// picture. The two things that carry the same meaning here are:
//
//   1. THE FRONTIER — how far down the spine the active window has reached.
//      This is the single number that answers "is she progressing?", and it is
//      the reason the session event carries `frontier` at all (spec §11). It is
//      derived from the log every session and stored nowhere, so it is also the
//      only place the kid can see that the derivation is moving.
//   2. THE ACTIVE WINDOW — the twenty-odd words actually in play right now,
//      each with its state. Small, countable, visibly shrinking work, which is
//      exactly the job math's cold-cell count does.
//
// What deliberately does NOT appear: any speed score, any words-per-minute,
// any target or age norm, any comparison to another person, any streak, and any
// countdown or clock. Time is measured relentlessly and never shown as a score.
// Latency appears once, as "your typical time", phrased as an observation.
// `config.hotMs` is deliberately NOT rendered anywhere: telling a kid that four
// seconds is the bar turns the one latency line on this screen into a target to
// beat, which is the habit the whole game is built to avoid.
//
// TWO comparisons are permitted and both are the kid against her own previous
// session — the median (see comparisonNote) and the frontier (see
// frontierNote). There is no third reference point anywhere in this file.
//
// LEARN AND DRILL ARE DIFFERENT ACTIVITIES, NOT DIFFICULTY LEVELS. Nothing on
// this screen ranks them, and neither button is styled as the harder one.
//
// This screen is a HUB, not a terminus. A session is a few minutes and a good
// sitting is ten to fifteen, and the mechanism for the longer sitting is
// frictionless continuation rather than a longer bar — so both continuations are
// offered after BOTH modes, one click away, and neither is taken automatically.
// The renderer reports which button was pressed through onResultsAction and
// main.js decides what it means.

import { patternsFor, IRREGULAR } from '../patterns.js';

// cold < warm < hot. Used only to tell a promotion from a regression when
// rendering `moved`; movement is NOT monotonic, so `from` may outrank `to`.
const BUCKET_RANK = { cold: 0, warm: 1, hot: 2 };

// FOUR DISPLAY STATES OVER THREE BUCKETS, exactly as the math results screen
// does it, and the words are the same words on purpose: a kid moving between the
// two games should not have to learn a second vocabulary for the same idea.
//
// `bucket` in the mastery model is still cold | warm | hot and nothing here
// changes that. "Shown how" is a DISPLAY state derived from
// `bucket === 'cold' && taught`: the word has a pattern the kid has been walked
// through in learn mode, but no clean drill spellings yet. Three states cannot
// separate "no idea where to start" from "has the pattern, needs reps", and that
// difference is exactly what says which mode to run next.
//
// `taught` only ever modifies the cold case. A warm or hot word very often has
// `taught: true` as well — that is the normal path — and it must still render as
// getting there / from memory. Mastery outranks instruction.
const STATE_WORD = {
  cold: 'not started',
  shown: 'shown how',
  warm: 'getting there',
  hot: 'from memory',
};

const STATES = ['cold', 'shown', 'warm', 'hot'];

// A drill stage is `clean` or `rN`, where N is how many letters had greyed into
// the slots when the word landed. The ladder itself belongs to the word screen
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

/**
 * The display state of one word. See STATE_WORD.
 *
 * @param {{bucket: string, taught: boolean}} stats
 * @returns {'cold' | 'shown' | 'warm' | 'hot'}
 */
function displayStateOf(stats) {
  return stats.bucket === 'cold' && stats.taught === true ? 'shown' : stats.bucket;
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
 * @returns {string} grouped, so a four-digit spine position reads as a number
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
  // Learn ladders. The rungs are the word screen's to name; these two are the
  // ones core/engine.js fixes ('strategy' first, a reveal last), and anything
  // else falls through to itself rather than being guessed at.
  if (stage === 'strategy') {
    return 'family up';
  }
  if (stage === 'reveal') {
    return 'shown';
  }
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
  if (stage === 'strategy') {
    return 'with the family on screen';
  }
  if (stage === 'reveal') {
    return 'after the word showed';
  }
  return String(stage);
}

/**
 * Name what a misspelling actually was.
 *
 * This is the spelling analogue of the math screen's "that's 6 × 8" note, and it
 * exists for the same reason: a wrong answer is rarely random, and saying what
 * kind of wrong it was turns a list of junk strings into the one diagnostic
 * sentence a parent can act on. `freind` for `friend` is not a kid who does not
 * know the word — it is a kid who knows every letter and has the rule the wrong
 * way round, and those need completely different help.
 *
 * Only edit-distance-one shapes are named. Anything further out gets no note at
 * all rather than a guess: a confident wrong label here would be worse than
 * silence, because the note is the part a parent will believe.
 *
 * Pure. Exported for tests.
 *
 * @param {string} target the correct spelling
 * @param {string} wrong what was typed
 * @returns {string | null} a short phrase, or null when nothing honest can be said
 */
export function describeMisspelling(target, wrong) {
  if (typeof target !== 'string' || typeof wrong !== 'string') {
    return null;
  }
  if (target === '' || wrong === '' || target === wrong) {
    return null;
  }

  if (target.length === wrong.length) {
    const differing = [];
    for (let index = 0; index < target.length; index += 1) {
      if (target[index] !== wrong[index]) {
        differing.push(index);
      }
    }
    if (differing.length === 1) {
      return 'one letter out';
    }
    if (
      differing.length === 2 &&
      differing[1] === differing[0] + 1 &&
      target[differing[0]] === wrong[differing[1]] &&
      target[differing[1]] === wrong[differing[0]]
    ) {
      // The `ie`/`ei` case, and the most common real misspelling shape there is.
      return 'the right letters, two swapped over';
    }
    return null;
  }

  if (wrong.length === target.length - 1 && isOneDeletionOf(target, wrong)) {
    return 'a letter missing';
  }
  if (wrong.length === target.length + 1 && isOneDeletionOf(wrong, target)) {
    return 'one letter too many';
  }
  return null;
}

/**
 * Is `shorter` exactly `longer` with one character removed?
 *
 * @param {string} longer
 * @param {string} shorter one character shorter
 * @returns {boolean}
 */
function isOneDeletionOf(longer, shorter) {
  let skipped = false;
  let left = 0;
  let right = 0;
  while (left < longer.length && right < shorter.length) {
    if (longer[left] === shorter[right]) {
      left += 1;
      right += 1;
      continue;
    }
    if (skipped) {
      return false;
    }
    skipped = true;
    left += 1;
  }
  return true;
}

/**
 * State counts across the WHOLE spine.
 *
 * `model.byId` is total over the item space by contract, so this counts every
 * word the game knows about without importing the spine — the model is the only
 * thing this screen is handed and the only thing it should need.
 *
 * @param {import('../../../core/mastery.js').MasteryModel} model
 * @returns {{cold: number, shown: number, warm: number, hot: number, total: number}}
 */
function countStates(model) {
  const counts = { cold: 0, shown: 0, warm: 0, hot: 0, total: 0 };
  for (const stats of model.byId.values()) {
    counts[displayStateOf(stats)] += 1;
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
 * kid's own previous DRILL session.
 *
 * Every other reference point is forbidden by the design — no target time, no
 * age norm, no other kid — and without this one the median is a number with
 * nothing to mean. So it is one of exactly two, and it is deliberately lopsided
 * in tone: a faster session is celebrated, a slower session is stated and
 * shrugged off. A slower median is frequently not a worse session. The retain
 * window means an improving kid who has just advanced onto longer words posts a
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
 * @param {number | null | undefined} previousMedianMs last drill session, null on a first run
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
 * THE FRONTIER CAN MOVE BACKWARDS and that is not a bug. A hot word cools when
 * its clean spellings age out of the retain window, at which point it re-enters
 * the active window and pulls the far edge back with it. That is the mastery
 * model working exactly as designed, so it is reported as plainly as a promotion
 * — no red, no apology, and with a word about why — for the same reason
 * `renderMoves` reports a bucket regression plainly.
 *
 * Pure. Exported for tests.
 *
 * @param {number} frontier spine index reached this session
 * @param {number | null | undefined} previousFrontier the same number last session, null on a first run
 * @returns {{text: string, tone: string}}
 */
export function frontierNote(frontier, previousFrontier) {
  if (!Number.isFinite(frontier)) {
    return { text: 'where you are up to on the word list', tone: 'plain' };
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
      text: `${moved} ${moved === 1 ? 'word' : 'words'} further along than last time`,
      tone: 'forward',
    };
  }
  const back = -moved;
  return {
    text: `${back} ${back === 1 ? 'word' : 'words'} came back round — they do that when it has been a while`,
    tone: 'back',
  };
}

/**
 * The session strip.
 *
 * DRILL: words done, clean rate, typical time.
 *
 * LEARN: neither of the other two drill stats means anything here, and both
 * would lie. A learn ladder has no `clean` rung by construction, so its clean
 * rate is always exactly 0 and would render as "0% from memory" — a failure
 * grade for a session that cannot produce anything else. And a learn median
 * measures how long it took to rebuild a word from the family on screen, which
 * is a different scale from retrieval speed; putting it beside
 * `previousMedianMs` would compare the two, which is the one thing the design
 * forbids. So learn shows what it actually did: how many words were worked
 * through, and how many words now have a pattern behind them.
 *
 * @param {object} summary SessionSummary
 * @param {{cold: number, shown: number, warm: number, hot: number}} counts
 * @returns {HTMLElement}
 */
function renderSummaryStrip(summary, counts) {
  const items = Number.isFinite(summary?.items) ? summary.items : 0;
  const cleanRate = summary?.cleanRate;
  const strip = el('div', 'results__stats');

  if (summary?.mode === 'learn') {
    strip.append(
      statBlock(String(items), 'words', 'worked through with the family on screen'),
    );
    strip.append(
      statBlock(
        formatCount(counts.shown),
        'shown how',
        counts.shown === 1
          ? 'word has its pattern now — spelling it from memory is what warms it up'
          : 'words have their pattern now — spelling them from memory is what warms them up',
      ),
    );
    return strip;
  }

  strip.append(statBlock(String(items), 'words', 'spelled this session'));

  const cleanNote =
    Number.isFinite(cleanRate) && items > 0
      ? `${Math.round(cleanRate * items)} of ${items} with no letters given`
      : 'spelled before any letter showed';
  strip.append(statBlock(formatRate(cleanRate), 'from memory', cleanNote));

  const comparison = comparisonNote(summary?.medianMs, summary?.previousMedianMs ?? null);
  strip.append(
    statBlock(formatMs(summary?.medianMs), 'typical time', comparison.text, comparison.tone),
  );

  return strip;
}

/**
 * The continuation row. Both continuations appear after BOTH modes: the screen
 * that ends a session is also the one that starts the next, because the way to a
 * fifteen-minute sitting is one more short session, not a longer bar. A kid who
 * has just finished learning a family can go and spell it; a kid who has just
 * spelled twenty words can go and learn the one that keeps catching her out.
 *
 * The labels name ACTIVITIES. Neither is "the hard one" and neither follows the
 * other — nothing here says level, stage, next, or harder.
 *
 * Nothing in this row starts anything. The buttons carry a `data-results-action`
 * and that is all; main.js owns every state transition. See onResultsAction.
 *
 * Learn is offered unless `summary.canLearn` is explicitly false, which means no
 * family in the active window has two or more words in it and there is nothing
 * to teach — a button that leads nowhere is worse than no button.
 *
 * @param {object} summary SessionSummary
 * @param {{sessionLength: number}} config
 * @returns {HTMLElement}
 */
function renderActions(summary, config) {
  const row = el('nav', 'results__actions');
  row.setAttribute('aria-label', 'What next');

  const button = (action, label, kind) => {
    const node = el('button', `results__action results__action--${kind}`, label);
    node.type = 'button';
    node.dataset.resultsAction = action;
    return node;
  };

  // The two continuations are weighted equally, in styling and in wording. Which
  // one is the better next step depends on the kid, not on which mode just
  // finished, and the screen does not presume to know.
  //
  // "Learn a word family" carries no count on purpose: the family that gets
  // picked is whatever the window offers and may have three words or five, and a
  // promised number that turns out wrong on the next screen is worse than none.
  if (summary?.canLearn !== false) {
    row.append(button('learn', 'Learn a word family', 'go'));
  }
  row.append(button('drill', `Spell ${config.sessionLength} words`, 'go'));
  row.append(button('done', 'Done', 'quiet'));

  return row;
}

/**
 * Bucket movements this session.
 *
 * Movement is NOT one-way. A word drops back when its clean spellings age out of
 * the retain window, so hot -> cold is a real and expected transition and is
 * rendered as plainly as a promotion — just without the celebration, and with a
 * word about why it happened. Direction is computed from the two buckets; `from`
 * is never assumed to be the worse one.
 *
 * THE LEARN CASE IS THE ONE THIS FUNCTION EXISTS TO GET RIGHT. Learn attempts
 * are excluded from mastery evidence by construction (core/mastery.js), so a
 * learn session moves nothing and this list is empty every single time. Rendering
 * that as a bare empty list would tell a kid who just did the harder, slower,
 * more useful half of the game that she achieved nothing. So the empty state is
 * mode-aware and says what learn mode actually did.
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
        summary?.mode === 'learn'
          ? 'Learn sessions never move the colours — they hand you the pattern. Spelling the words from memory is what turns one from shown how to getting there.'
          : 'No words changed colour this session. That happens — the colours only move when the last few tries say so.',
      ),
    );
    return section;
  }

  const list = el('ul', 'results__move-list');
  for (const move of moved) {
    const stats = model.byId.get(move.id);
    if (stats === undefined) {
      continue; // a word that has left the spine; nothing truthful to draw
    }
    const up = BUCKET_RANK[move.to] > BUCKET_RANK[move.from];
    const down = BUCKET_RANK[move.to] < BUCKET_RANK[move.from];
    const direction = up ? 'up' : down ? 'down' : 'flat';

    // Movement is between BUCKETS; the words on screen are DISPLAY states. A
    // taught word that drops back to cold reads "getting there → shown how", not
    // "→ not started", because the pattern it was taught did not evaporate.
    const taught = stats.taught === true;
    const stateOf = (bucket) => (bucket === 'cold' && taught ? 'shown' : bucket);

    const item = el('li', `results__move results__move--${direction}`);
    item.append(el('span', 'results__move-arrow', up ? '↑' : down ? '↓' : '→'));
    item.append(el('span', 'results__move-word', stats.item.word));

    const fromState = stateOf(move.from);
    const toState = stateOf(move.to);
    const from = el('span', `results__pill results__pill--${fromState}`, STATE_WORD[fromState]);
    const to = el('span', `results__pill results__pill--${toState}`, STATE_WORD[toState]);
    const change = el('span', 'results__move-change');
    change.append(from, el('span', 'results__move-to', '→'), to);
    item.append(change);

    if (down) {
      item.append(
        el('span', 'results__move-why', 'slipped back — older quick spellings dropped out'),
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
 * recomputed from the log every load (core/frontier.js). That makes progress real
 * but invisible, and this section is the only place it is ever shown. It is the
 * reason the session event carries `frontier`.
 *
 * The bar is a POSITION, not a timer and not a score. It fills as the kid moves
 * down the spine, it carries a mark at last session's position so the movement
 * is visible rather than asserted, and it counts words — never seconds.
 *
 * @param {object} summary SessionSummary
 * @param {{cold: number, shown: number, warm: number, hot: number, total: number}} counts
 * @returns {HTMLElement}
 */
function renderFrontier(summary, counts) {
  const section = el('section', 'results__frontier');
  section.append(el('h2', 'results__h2', 'Where you are up to'));

  const total = counts.total;
  const frontier = Number.isFinite(summary?.frontier) ? summary.frontier : 0;
  // `frontier` is a spine INDEX, so the word at it is the (index + 1)th. Clamped
  // because a finished spine reports an index one past the end.
  const position = Math.max(0, Math.min(frontier + 1, total));
  const previous = Number.isFinite(summary?.previousFrontier) ? summary.previousFrontier : null;

  const line = el('p', 'results__frontier-line');
  line.append(el('span', 'results__frontier-position', formatCount(position)));
  line.append(el('span', 'results__frontier-of', `of ${formatCount(total)} words`));
  section.append(line);

  const note = frontierNote(frontier, previous);
  section.append(el('p', `results__frontier-note results__frontier-note--${note.tone}`, note.text));

  const track = el('div', 'results__spine');
  track.setAttribute('role', 'img');
  track.setAttribute(
    'aria-label',
    `Word ${position} of ${total} on the list. ${note.text}.`,
  );
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

  // The mastered count, stated as a countable set rather than a percentage.
  // "Forty words from memory" is an achievement; "4%" of a thousand-word list is
  // a grade, and a discouraging one on a list that is deliberately far longer
  // than any one kid will finish.
  section.append(
    el(
      'p',
      'results__frontier-mastered',
      counts.hot === 1
        ? '1 word you can spell from memory so far.'
        : `${formatCount(counts.hot)} words you can spell from memory so far.`,
    ),
  );

  return section;
}

/**
 * One word chip in the active window.
 *
 * @param {object} stats WordStats
 * @returns {HTMLElement}
 */
function wordChip(stats) {
  const state = displayStateOf(stats);
  const chip = el('button', `results__word results__word--${state}`, stats.item.word);
  chip.type = 'button';
  chip.tabIndex = -1;
  chip.dataset.id = stats.id;
  chip.setAttribute('aria-label', `${stats.item.word}, ${STATE_WORD[state]}`);
  return chip;
}

/**
 * The words currently in play — the active window, in spine order.
 *
 * This is the small, concrete, visibly shrinking set of work that the math
 * game's cold-cell count provides, and it is scoped to the window rather than
 * the spine for the same reason the window exists: a thousand words is not a
 * job, and twenty is.
 *
 * @param {import('../../../core/mastery.js').MasteryModel} model
 * @param {string[]} windowIds ids, spine order. Not named `window` — this is a
 *   browser module and shadowing the global there is a trap for the next reader.
 * @returns {{section: HTMLElement, list: HTMLElement | null}}
 */
function renderWindow(model, windowIds) {
  const section = el('section', 'results__window');
  const head = el('div', 'results__window-head');
  head.append(el('h2', 'results__h2', 'The words you are on'));
  section.append(head);

  if (windowIds.length === 0) {
    // Reachable, and a real state rather than an error: every word in the spine
    // is hot. Say so as the finish it is.
    section.append(
      el(
        'p',
        'results__empty',
        'Nothing left in the window — every word on the list has come back from memory. That is the whole list.',
      ),
    );
    return { section, list: null };
  }

  const list = el('div', 'results__words');
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', 'Words in play, easiest first');
  for (const id of windowIds) {
    const stats = model.byId.get(id);
    if (stats !== undefined) {
      list.append(wordChip(stats));
    }
  }
  section.append(list);

  return { section, list };
}

/**
 * The detail panel for one word.
 *
 * @param {import('../../../core/mastery.js').MasteryModel} model
 * @param {string} id
 * @param {{retain: number}} config
 * @returns {HTMLElement}
 */
function renderDetail(model, id, config) {
  const stats = model.byId.get(id);
  const word = stats.item.word;
  const panel = el('div', 'results__detail-body');
  const state = displayStateOf(stats);

  const heading = el('h3', 'results__detail-title');
  heading.append(el('span', 'results__detail-word', word));
  heading.append(el('span', `results__pill results__pill--${state}`, STATE_WORD[state]));
  panel.append(heading);

  const line =
    stats.cleanCount === 0
      ? 'Not yet spelled with no letters given.'
      : `${stats.cleanCount} spelled straight from memory, typically ${formatMs(stats.medianCleanMs)}.`;
  panel.append(el('p', 'results__detail-line', line));

  // The route. Re-derived rather than read off the log on purpose: this panel
  // answers "what should we do about this word NOW", and now is what today's
  // rules say. The log keeps its own copy of the tags that were in force at the
  // time, which is a different question and a different reader.
  const patterns = patternsFor(word);
  const routeLine = el('p', 'results__detail-line');
  if (patterns.includes(IRREGULAR)) {
    routeLine.textContent =
      'This one does not follow a rule — it just has to be remembered. Learn mode says so rather than pretending otherwise.';
  } else {
    routeLine.append(el('span', 'results__detail-label', 'Pattern'));
    for (const pattern of patterns) {
      routeLine.append(el('span', 'results__tag', pattern));
    }
  }
  panel.append(routeLine);

  // Which mode to send this word to next — the whole reason the fourth display
  // state exists.
  if (state === 'shown') {
    panel.append(
      el(
        'p',
        'results__detail-line',
        'You have been shown the pattern for this one. Spelling it is what makes it stick.',
      ),
    );
  } else if (state === 'cold') {
    panel.append(
      el('p', 'results__detail-line', 'Learn mode can show you the pattern behind this one.'),
    );
  }

  // Recent attempts, oldest first — `attempts` is most-recent-LAST.
  const attemptsBlock = el('div', 'results__block');
  attemptsBlock.append(el('h4', 'results__h4', `Last ${config.retain} tries`));
  if (stats.attempts.length === 0) {
    attemptsBlock.append(el('p', 'results__empty', 'Not spelled yet.'));
  } else {
    const chips = el('ul', 'results__chips');
    stats.attempts.forEach((attempt, index) => {
      const chip = el('li', `results__chip results__chip--${attempt.stage === 'clean' ? 'clean' : 'helped'}`);
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

  // Misspellings come from the whole log, not just the retained window: a wrong
  // spelling from three weeks ago is still what this word looks like in the
  // kid's head, and it must not age out just because the word has been drilled
  // since.
  const wrongBlock = el('div', 'results__block');
  wrongBlock.append(el('h4', 'results__h4', 'Spellings that were not right'));
  const wrong = [...(model.confusions.get(id) ?? [])].sort();
  if (wrong.length === 0) {
    wrongBlock.append(el('p', 'results__empty', 'None — every spelling here has been right.'));
  } else {
    const list = el('ul', 'results__wrongs');
    for (const value of wrong) {
      const item = el('li', 'results__wrong');
      item.append(el('span', 'results__wrong-value', String(value)));
      const note = describeMisspelling(word, String(value));
      if (note !== null) {
        item.append(el('span', 'results__wrong-note', note));
      }
      list.append(item);
    }
    wrongBlock.append(list);
  }
  panel.append(wrongBlock);

  return panel;
}

/** @type {WeakMap<HTMLElement, (event: Event) => void>} */
const ACTION_LISTENERS = new WeakMap();

/**
 * Register the handler for the continuation row. Delegated on `container`, so it
 * survives any number of re-renders of the screen inside it, and re-registering
 * REPLACES the previous handler rather than stacking a second one.
 *
 * The handler is called with exactly one of `'learn' | 'drill' | 'done'`.
 *
 * @param {HTMLElement} container
 * @param {(action: 'learn' | 'drill' | 'done') => void} handler
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
 * @param {object} summary SessionSummary — see the module header and the report:
 *   `{ session, mode, items, cleanRate, medianMs, previousMedianMs, moved,
 *      window, frontier, previousFrontier, canLearn }`. `previousMedianMs` and
 *   `previousFrontier` are null on a first run.
 * @param {object} config the game's CONFIG — reads `sessionLength` and `retain`
 * @returns {void}
 */
export function renderResults(container, model, summary, config) {
  const root = el('section', 'results');
  const counts = countStates(model);
  const windowIds = Array.isArray(summary?.window) ? summary.window : [];

  const header = el('header', 'results__header');
  header.append(el('h1', 'results__title', 'Session done'));
  // Names the ACTIVITY that just happened. Not a level, not a stage.
  header.append(
    el(
      'p',
      'results__subtitle',
      summary?.mode === 'learn' ? 'Learning a word family' : 'Spelling from memory',
    ),
  );
  root.append(header);

  root.append(renderSummaryStrip(summary, counts));
  root.append(renderActions(summary, config));
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
  detail.append(el('p', 'results__detail-hint', 'Tap any word to see how that one is going.'));
  windowSection.append(detail);
  root.append(windowSection);

  // --- interaction -------------------------------------------------------
  // Selection lives here, for exactly as long as this rendered screen does.

  if (list !== null) {
    let focused = list.querySelector('.results__word');
    if (focused !== null) {
      focused.tabIndex = 0;
    }

    const select = (chip) => {
      for (const marked of list.querySelectorAll('.is-selected')) {
        marked.classList.remove('is-selected');
      }
      chip.classList.add('is-selected');
      detail.replaceChildren(renderDetail(model, chip.dataset.id, config));
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
      const chip = event.target.closest('.results__word');
      if (chip !== null) {
        focus(chip);
        select(chip);
      }
    });

    // Roving tabindex: the chips are one list, so one pair of arrow keys walks
    // it and Home/End jump to the ends.
    list.addEventListener('keydown', (event) => {
      const chip = event.target.closest('.results__word');
      if (chip === null) {
        return;
      }
      const chips = [...list.querySelectorAll('.results__word')];
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
