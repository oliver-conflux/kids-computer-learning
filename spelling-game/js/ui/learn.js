// The learn screen — the family, the header, "show me", and the meaning.
//
// WHAT THIS SCREEN IS FOR, in one sentence: the answer must always arrive with
// its derivation attached. Showing `mat` for two seconds and hiding it is COPY
// PRACTICE — it exercises a visual buffer that survives about ten seconds and
// teaches nothing about why the word looks like that. It is the spelling
// equivalent of the bare `42` the math game shipped in v1 and spent all of v2
// removing.
//
// THE FAMILY STAYS ON SCREEN AFTER THE TARGET WORD HIDES. That single detail is
// what turns flash-and-hide into instruction: the kid still has `cat hat bat` in
// front of her while spelling `mat`, so she rebuilds it from `-at` rather than
// from a fading picture of the word. It is the direct analogue of the strategy
// line staying visible in math's learn mode, and it is the whole pedagogical
// argument for this mode existing. DO NOT REMOVE IT AS A SIMPLIFICATION.
//
// "SHOW ME" IS PRESS-AND-HOLD, and the friction is doing useful work. The word
// is visible only while the button is held, so the kid has to carry it in memory
// long enough to type it, and holding it means taking a hand off the keyboard —
// peeking has a small physical cost (spec §6). A click-to-toggle version of this
// button would leave the answer sitting on screen to be copied, which is the
// thing this mode exists not to be.
//
// NO CLOCK ANYWHERE. Not a countdown, not a bar, not an elapsed reading, and no
// tick loop: `tick` is a structural no-op on a learn ladder (core/engine.js), so
// a timer here would be fighting the engine as well as the design. Nothing is
// ever pushed at the kid in this mode.
//
// COMPOSITION: this screen owns the node it is given and clears it, and it
// creates a region for the word screen to own in the same way. main.js mounts
// this one first and mounts word.js into the container it hands back — so the
// two renderers never write into each other's DOM, which is the rule
// index.html states for the two stages.
//
// Impure by nature, like every DOM module. It holds no game logic: which family
// to teach and in what order is spelling-game/js/learn.js's decision, and the
// mastery rules are the core's. A screen renders state and reports events.
//
// Exports: mountLearnScreen, renderLearn, onShowWord, learnLadder,
// familyHeading.

import { isIrregularSet } from '../learn.js';

/**
 * Where the ingest writes, and the guard on what may be interpolated into that
 * URL. Server-root-relative for the same reason audio.js's cache dir is: the
 * game is served from /spelling-game/, and a relative path would look for the
 * cache inside it.
 *
 * Not in config.js, for the same reason audio.js keeps its own table: none of it
 * is a game rule tools/replay.js would ever want to vary.
 */
const MEANING = {
  cacheDir: '/data/words',
  cacheableWord: /^[a-z]+$/,
};

/** The learn ladder's rungs. See `learnLadder` for why the first one is named. */
const LEARN_LADDER = ['strategy', 'reveal'];

/** Header phrasings for tags where "These are X words" would be a lie. */
const HEADINGS = {
  // The honest one. `irregular` is a SET, not a family — the words in it share
  // no route, only the absence of one — and saying they rhyme would unteach the
  // idea of a pattern while claiming to teach one (spec §4).
  irregular: { before: 'These ones you just have to remember', tag: null, after: '' },
  'silent-e': { before: 'These words end with a quiet', tag: 'e', after: '' },
  '-le': { before: 'These words end with', tag: '-le', after: '' },
  'double-final': { before: 'These words end with a', tag: 'double letter', after: '' },
  'blend-start': { before: 'These words start with two sounds', tag: null, after: '' },
  'blend-end': { before: 'These words end with two sounds', tag: null, after: '' },
};

/** Per-container mutable bits. None of it is game state; see each comment. */
const showHandlers = new WeakMap(); // container -> () => void
const holding = new WeakSet(); // containers whose button is down right now
const targets = new WeakMap(); // container -> the word currently being spelled
const meanings = new WeakMap(); // container -> Map<word, meaning | null>
const loaders = new WeakMap(); // container -> (word) => Promise<meaning | null>
const wiredContainers = new WeakSet();

/**
 * Build the learn screen inside `container`, replacing whatever was there.
 *
 * Returns the container the WORD screen is to be mounted into. It sits between
 * the family and the button because that is the reading order the mode wants:
 * the pattern, then the slots you are filling, then the way out if you need it.
 *
 * @param {Element} container the node this screen owns and clears
 * @param {{loadMeaning?: (word: string) => Promise<object | null>}} [options]
 * @returns {{screen: Element, wordContainer: Element}}
 */
export function mountLearnScreen(container, options = {}) {
  container.textContent = '';

  const screen = el('section', 'learn-screen');

  const header = el('h1', 'learn__header', { role: 'header' });
  const family = el('div', 'learn__family', { role: 'family' });

  // The word screen's node. This module never writes inside it again.
  const wordContainer = el('div', 'learn__word-area', { role: 'word-area' });

  const actions = el('div', 'learn__actions');
  const show = el('button', 'learn__show', { role: 'show' });
  show.type = 'button';
  show.textContent = 'Show me';
  actions.append(show);

  const meaning = el('div', 'learn__meaning', { role: 'meaning' });
  meaning.append(
    el('p', 'learn__definition', { role: 'definition' }),
    el('p', 'learn__usage', { role: 'usage' }),
  );

  screen.append(header, family, wordContainer, actions, meaning);
  container.append(screen);

  meanings.set(container, new Map());
  loaders.set(container, options.loadMeaning ?? fetchMeaning);
  targets.delete(container);
  holding.delete(container);
  wire(container);

  return { screen, wordContainer };
}

/**
 * Render the family and the current target.
 *
 * `view.family` is `pickLearnFamily`'s return value unchanged, and `view.word`
 * is the word being spelled right now — main.js has both and this module derives
 * neither. Idempotent: the same view rendered twice produces the same DOM.
 *
 * @param {Element} container the element mountLearnScreen was given
 * @param {{family: {pattern: string | null, words: {id: string, word: string}[]}, word: string}} view
 * @returns {void}
 */
export function renderLearn(container, view) {
  const screen = container.querySelector('.learn-screen');
  if (screen === null) {
    return;
  }

  const family = view.family ?? { pattern: null, words: [] };
  const word = typeof view.word === 'string' ? view.word : '';

  targets.set(container, word);
  renderHeader(screen, family);
  renderFamily(screen, family, word);
  renderMeaning(container, screen, word);
}

/**
 * Register the handler called each time the kid STARTS holding "show me".
 *
 * The handler takes no arguments and its return value is ignored. This module
 * does not hold the ProblemState and must not be handed one: main.js owns every
 * transition, so it is main.js that calls `revealAnswer` and re-renders — the
 * same division `onRevealClick` keeps in the math game, and for the same reason.
 * The engine's `revealed` flag is what marks a learn attempt as scaffolded in
 * the log, and it is the only reason this callback exists at all.
 *
 * Calling it on every hold rather than only on the first is deliberate and
 * safe: `revealAnswer` on a state already at the last rung returns that state BY
 * REFERENCE, so repeats are free and the identity contract the renderers depend
 * on is preserved.
 *
 * Registering twice replaces the handler rather than stacking a second one.
 *
 * @param {Element} container
 * @param {() => void} handler
 * @returns {void}
 */
export function onShowWord(container, handler) {
  showHandlers.set(container, handler);
}

/**
 * The ladder a learn problem runs on: `['strategy', 'reveal']`.
 *
 * THE FIRST RUNG'S NAME IS LOAD-BEARING, which is why this is a function here
 * rather than an array literal in main.js. core/engine.js decides whether a
 * problem is a learn problem by reading `ladder[0] === 'strategy'`, and that one
 * check is what makes `tick` a no-op and what stops a wrong answer advancing the
 * stage. A ladder named `['learn', 'reveal']` would look identical, pass review,
 * and quietly give learn mode a clock and a punishment for mistakes — the two
 * properties it is defined by not having.
 *
 * Two rungs, not one per letter: learn has no progressive reveal. Its help is
 * the family on screen and the button under the kid's finger.
 *
 * @returns {string[]} a fresh copy
 */
export function learnLadder() {
  return LEARN_LADDER.slice();
}

/**
 * The header, split into the three pieces the markup needs.
 *
 * Pure, and exported so the copy is testable without a DOM — this is the one
 * place a wrong word teaches the wrong rule. The default reads "These are -at
 * words", which is right for every rime, digraph, vowel team and r-controlled
 * tag. The exceptions in HEADINGS are the tags where that sentence would be a
 * lie: `irregular` is not a family, and `silent-e` and `blend-end` are
 * properties of a word rather than a string it contains.
 *
 * KNOWN LIMIT, recorded at Gate B and not fixed here: the broad structural tags
 * (`blend-end` has 29 members, `silent-e` 29) can win family selection, and
 * "these words end with two sounds" over `and / first / just / left` is true but
 * thin. The fix is in the selection rules, not in the copy — a header cannot
 * make a bad family good — so this function says the most honest thing available
 * and the problem stays visible.
 *
 * @param {{pattern: string | null}} family
 * @returns {{before: string, tag: string | null, after: string}}
 */
export function familyHeading(family) {
  const pattern = family?.pattern ?? null;
  if (pattern === null) {
    return { before: '', tag: null, after: '' };
  }
  if (isIrregularSet(family)) {
    return { ...HEADINGS.irregular };
  }
  const known = HEADINGS[pattern];
  return known !== undefined
    ? { ...known }
    : { before: 'These are', tag: pattern, after: 'words' };
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function renderHeader(screen, family) {
  const header = find(screen, 'header');
  const { before, tag, after } = familyHeading(family);

  // The pieces are trimmed so `familyHeading` stays testable as plain strings;
  // the spaces between them belong to the markup and are added here.
  header.textContent = '';
  header.append(document.createTextNode(tag === null ? before : `${before} `));
  if (tag !== null) {
    header.append(el('b', 'learn__tag', {}, tag));
  }
  if (after !== '') {
    header.append(document.createTextNode(` ${after}`));
  }
}

/**
 * The family, with the target word held in reserve.
 *
 * The target keeps its place in the row and its exact width — it is hidden with
 * `visibility`, never removed — so the row does not reflow when it appears and
 * disappears, and the kid can see where in the family the word she is spelling
 * belongs. `mat` showing up between `hat` and `bat` is the pattern made visible;
 * a word that pops in at the end of the row is just an answer.
 *
 * The strip is rebuilt only when the family changes, which is once per session.
 * A target that is somehow not a member of the family is appended rather than
 * dropped — without it "show me" would have nothing to show, and a kid holding a
 * button that does nothing is the worst failure this screen has.
 */
function renderFamily(screen, family, word) {
  const strip = find(screen, 'family');
  const words = Array.isArray(family.words) ? family.words.map((member) => member.word) : [];
  const shown = words.includes(word) || word === '' ? words : [...words, word];
  const key = shown.join(' ');

  if (strip.dataset.family !== key) {
    strip.dataset.family = key;
    strip.textContent = '';
    for (const member of shown) {
      strip.append(el('span', 'learn__word', { word: member }, member));
    }
  }

  for (const node of strip.children) {
    node.dataset.target = node.dataset.word === word ? 'yes' : 'no';
  }
}

/**
 * The definition and the usage sentence, when they happen to be cached.
 *
 * ABSENT SILENTLY WHEN NOT, and that is the DEFAULT case, not the degraded one:
 * anyone who clones this repo has no MW_KEY and an empty `data/words/`, and the
 * game has to be fully playable for them (spec §5). A missing file is not an
 * error, is not logged, and is not retried.
 *
 * THE REGION IS OUT OF FLOW (see learn.css), which is what lets it arrive late
 * without moving anything. The fetch is asynchronous, so on a cache hit the text
 * lands a frame or two after the slots are already on screen — and a block of
 * text appearing under a word a kid is mid-way through spelling would shove it
 * up the screen. Absolutely positioned, it cannot.
 *
 * The result is remembered per word, including the misses: a learn session
 * cycles the same four words a dozen times and re-probing an absent file each
 * time would put twelve 404s in the console for every uncached word.
 */
function renderMeaning(container, screen, word) {
  const cache = meanings.get(container);
  if (cache === undefined) {
    return;
  }

  if (cache.has(word)) {
    paintMeaning(screen, cache.get(word));
    return;
  }

  paintMeaning(screen, null); // nothing until we know better
  const load = loaders.get(container);
  if (typeof load !== 'function' || word === '') {
    return;
  }

  Promise.resolve(load(word))
    .catch(() => null)
    .then((meaning) => {
      cache.set(word, meaning ?? null);
      // The kid may be two words further on by the time this resolves. Painting
      // then would put one word's definition under another word's slots.
      if (targets.get(container) === word) {
        paintMeaning(screen, meaning ?? null);
      }
    });
}

function paintMeaning(screen, meaning) {
  const definition = find(screen, 'definition');
  const usage = find(screen, 'usage');

  const text = firstDefinition(meaning);
  const sentence = typeof meaning?.usage === 'string' ? meaning.usage.trim() : '';

  definition.textContent = text;
  definition.hidden = text === '';
  usage.textContent = sentence === '' ? '' : `“${sentence}”`;
  usage.hidden = sentence === '';
}

/** The first short definition in a cache record, or ''. */
function firstDefinition(meaning) {
  const list = meaning?.shortdef;
  if (!Array.isArray(list)) {
    return '';
  }
  const first = list.find((entry) => typeof entry === 'string' && entry.trim() !== '');
  return first === undefined ? '' : first.trim();
}

/**
 * The default meaning loader: the record tools/fetch-words.js wrote, or null.
 *
 * Same-origin, to our own localhost server, for a file that was put on disk
 * hours or days earlier. NOTHING HERE EVER TALKS TO MERRIAM-WEBSTER — a
 * play-time lookup would need the key, would spend the day's quota on words the
 * ingest already has, and would make a kid's game phone someone. The word is
 * checked against `cacheableWord` rather than trusted because it is interpolated
 * into that URL.
 *
 * Every failure resolves to null: no file, no server, malformed JSON. The screen
 * simply has no meaning to show, which is the normal state of a fresh clone.
 */
async function fetchMeaning(word) {
  if (typeof word !== 'string' || !MEANING.cacheableWord.test(word)) {
    return null;
  }
  try {
    const response = await fetch(`${MEANING.cacheDir}/${word}.json`);
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Press-and-hold, wired once per container.
 *
 * Delegated to the container rather than bound to the button, because every
 * mount builds a fresh button and a listener on the button would be thrown away
 * with it — the bug that only shows up on the second session.
 *
 * RELEASING OUTSIDE THE BUTTON MUST STILL HIDE THE WORD. A `pointerup` that
 * happens after the kid has dragged off the button, or off the window
 * altogether, never reaches the button — so the release is caught on the window
 * instead, along with the window losing focus. Without that the word would be
 * left sitting on screen to be copied, which is the one outcome this button is
 * designed to prevent.
 *
 * The keyboard path is the same gesture: hold Space or Enter while the button
 * has focus. `preventDefault` on keydown stops the browser synthesising a click
 * on release, and `event.repeat` is filtered so a held key reports the hold once
 * rather than sixty times a second. This is also why word.js's Space handler
 * bows out when the event started on a button: on the focused "show me" button,
 * Space means show; anywhere else it means say the word again.
 */
function wire(container) {
  if (wiredContainers.has(container)) {
    return;
  }
  wiredContainers.add(container);

  const view = container.ownerDocument.defaultView;

  container.addEventListener('pointerdown', (event) => {
    if (isShowButton(event.target)) {
      beginHold(container);
    }
  });

  container.addEventListener('keydown', (event) => {
    if (!isShowButton(event.target) || !isActivationKey(event)) {
      return;
    }
    event.preventDefault();
    if (!event.repeat) {
      beginHold(container);
    }
  });

  container.addEventListener('keyup', (event) => {
    if (isShowButton(event.target) && isActivationKey(event)) {
      endHold(container);
    }
  });

  // Focus leaving the button ends the hold — a kid who tabs away mid-hold would
  // otherwise never get a keyup.
  container.addEventListener('focusout', () => endHold(container));

  view?.addEventListener('pointerup', () => endHold(container));
  view?.addEventListener('pointercancel', () => endHold(container));
  view?.addEventListener('blur', () => endHold(container));
}

function beginHold(container) {
  if (holding.has(container)) {
    return;
  }
  holding.add(container);

  const screen = container.querySelector('.learn-screen');
  if (screen !== null) {
    screen.dataset.showing = 'on';
  }

  const handler = showHandlers.get(container);
  if (typeof handler === 'function') {
    handler();
  }
}

function endHold(container) {
  if (!holding.has(container)) {
    return;
  }
  holding.delete(container);

  const screen = container.querySelector('.learn-screen');
  if (screen !== null) {
    screen.removeAttribute('data-showing');
  }
}

function isShowButton(target) {
  return (
    target !== null &&
    typeof target.closest === 'function' &&
    target.closest('[data-role="show"]') !== null
  );
}

function isActivationKey(event) {
  return event.key === ' ' || event.code === 'Space' || event.key === 'Enter';
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
