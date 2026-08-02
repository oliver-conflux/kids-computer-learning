// The second dial: how awkward a word is to TYPE, as distinct from how hard it
// is to spell.
//
// The two are orthogonal and the design rests on keeping them apart. `rhythm` is
// a hard spell and an easy type; `pizzazz` is the reverse. Spine order carries
// spelling difficulty; this function carries keyboard difficulty, and the
// scheduler multiplies them.
//
// It is a MULTIPLIER, NOT A GATE. An awkward word is served less often, never
// excluded, so no word on the spine is ever unreachable. That guarantee is
// structural: the result is clamped to `config.typingWeightFloor` here, inside
// this function, rather than being left to every caller to remember.
//
// Stage 1 of three (spec §3): same-finger bigrams, pinky reaches, row jumps and
// hand alternation — everything derivable from the physical keyboard alone.
// Stage 2 (which keys the kid has been taught) and stage 3 (per-key error rates)
// both read the typing game's log and belong to that game's work. The signature
// does not change when they arrive.
//
// The finger and row tables are IMPORTED from the typing game, never copied. That
// file is a verified transcription of the keyboard design document, and a second
// copy would be a second thing to drift.
//
// Pure module: no DOM, no network, no clock, no randomness.

export * as KEYMAP from '../../typing-game/js/keymap.js';

/** `ROWS` index of the home row — the resting position everything is measured from. */
const HOME_ROW = 2;

const PINKIES = new Set(['lp', 'rp']);

/**
 * The cost model's coefficients.
 *
 * These are deliberately NOT in the game's CONFIG table, which is the one place
 * the house rule about magic numbers gets an exception, so the reasoning is worth
 * writing down. CONFIG holds tunables about the KID — how long to wait, how many
 * words a session runs, how hard to suppress an awkward word. These describe
 * HANDS AND KEYS. A pinky is the weakest finger on every keyboard in the house
 * and will still be the weakest finger after every value in CONFIG has been
 * retuned twice. `typingWeightFloor` is the pedagogical dial and it does come
 * from config; this table is the physical model underneath it.
 *
 * The numbers are a judgement, not a measurement. They are ordered by confidence:
 * same-finger bigrams really are the worst thing you can ask a hand to do, and
 * failing to alternate hands is a mild cost at worst.
 */
const KEYBOARD_COST = {
  // per character
  pinky: 0.5, // weakest, least accurate finger, and it also carries the reaches
  rowOffHome: 0.25, // per row away from home; the number row is two away

  // per adjacent pair
  sameFinger: 1, // the same finger on two DIFFERENT keys — the worst bigram there is
  rowJump: 0.25, // per row crossed between the two keys
  sameHand: 0.15, // no alternation: one hand does both keys in a row

  // how the two halves combine into one penalty
  charShare: 0.5,
};

// Building the character-to-row map means walking ROWS, which is a display
// layout, not a lookup table. Memoised against the keymap module object because
// the scheduler calls this once per candidate per pick and the map never changes
// for a given keyboard. Same inputs still give the same output — this is a cache,
// not state.
const rowCache = new WeakMap();

/**
 * Map each single-character key label to its row index.
 *
 * `ROWS` entries are either a bare label or `[label, width, id?]`, and most rows
 * carry multi-character labels — `tab`, `caps`, `shift`, `space`. Those are real
 * keys but not characters a word can contain, so they are skipped.
 *
 * @param {object} keymap the typing game's keymap module
 * @returns {Map<string, number>}
 */
function rowIndexes(keymap) {
  const cached = rowCache.get(keymap);
  if (cached !== undefined) {
    return cached;
  }

  const rows = new Map();
  keymap.ROWS.forEach((row, index) => {
    for (const entry of row) {
      const label = Array.isArray(entry) ? entry[0] : entry;
      if (typeof label === 'string' && label.length === 1) {
        rows.set(label.toLowerCase(), index);
      }
    }
  });

  rowCache.set(keymap, rows);
  return rows;
}

/**
 * The word as a list of physical keys, dropping characters the keyboard does not
 * know.
 *
 * Dropping rather than penalising is the right reading: an unmapped character
 * says nothing about how far a hand has to move, and treating it as a wall that
 * splits the word in two would make a word carrying one stray character look
 * EASIER to type than it is. Words on the spine are lowercase a–z, so in practice
 * nothing is ever dropped; this exists so an odd string cannot throw.
 *
 * @param {string} word
 * @param {object} keymap
 * @returns {{char: string, finger: string, row: number | null}[]}
 */
function keysOf(word, keymap) {
  const rows = rowIndexes(keymap);
  const keys = [];

  for (const char of typeof word === 'string' ? word : '') {
    const lower = char.toLowerCase();
    const finger = keymap.fingerFor(lower);
    if (finger === null) {
      continue;
    }
    keys.push({ char: lower, finger, row: rows.get(lower) ?? null });
  }

  return keys;
}

/**
 * What one key costs on its own, before anything about its neighbours.
 *
 * @param {{finger: string, row: number | null}} key
 * @returns {number}
 */
function charCost(key) {
  let cost = 0;
  if (PINKIES.has(key.finger)) {
    cost += KEYBOARD_COST.pinky;
  }
  if (key.row !== null) {
    cost += KEYBOARD_COST.rowOffHome * Math.abs(key.row - HOME_ROW);
  }
  return cost;
}

/**
 * What a pair of adjacent keys costs.
 *
 * The same finger on the same key twice — the `zz` in `pizzazz` — is a double
 * tap, which is fast and easy, so it is charged as a same-hand pair and not as a
 * same-finger bigram. Only a finger having to LEAVE one key and find another
 * earns the big penalty.
 *
 * @param {{char: string, finger: string, row: number | null}} first
 * @param {{char: string, finger: string, row: number | null}} second
 * @returns {number}
 */
function bigramCost(first, second) {
  let cost = 0;

  if (first.finger === second.finger && first.char !== second.char) {
    cost += KEYBOARD_COST.sameFinger;
  } else if (first.finger[0] === second.finger[0]) {
    cost += KEYBOARD_COST.sameHand;
  }

  if (first.row !== null && second.row !== null) {
    cost += KEYBOARD_COST.rowJump * Math.abs(first.row - second.row);
  }

  return cost;
}

/**
 * Read and check the one quantity that does come from config.
 *
 * This throws rather than defaulting, and it is the only thing in the spelling
 * game's pure modules that does. The "a corrupt line must never break a session"
 * rule is about DATA — a log written months ago by an older build. A missing
 * `typingWeightFloor` is a programming error in a table that ships with the code,
 * it is the same on every run, and a silent default would hide it while quietly
 * changing which words the kid sees.
 *
 * @param {{typingWeightFloor: number}} config
 * @returns {number}
 */
function floorFrom(config) {
  const floor = config === null || config === undefined ? undefined : config.typingWeightFloor;
  if (!Number.isFinite(floor) || floor <= 0 || floor > 1) {
    throw new TypeError(
      `typingCost needs config.typingWeightFloor in (0, 1]; got ${JSON.stringify(floor)}`,
    );
  }
  return floor;
}

/**
 * How readily a word should be served, as a multiplier on its bucket weight.
 *
 * Returns a number in `[config.typingWeightFloor, 1]`. 1 is a word that costs the
 * hands nothing; the floor is the most any word can ever be suppressed. It is
 * NEVER 0 and never below the floor — that is what keeps every word on the spine
 * reachable.
 *
 * The two halves are AVERAGED, not accumulated, so this measures awkwardness per
 * keystroke rather than total effort. That is deliberate. Length is already
 * spelling difficulty, which is the other dial and is carried by spine order, and
 * a longer word already earns proportionally more reveal stages for free. An
 * accumulating model would push every long word to the floor and make the floor
 * the common case instead of the exception, which would flatten the dial into a
 * length penalty and tell us nothing we did not already know.
 *
 * @param {string} word lowercase, a–z, though anything unmapped is simply ignored
 * @param {object} keymap the typing game's keymap module — see KEYMAP
 * @param {{typingWeightFloor: number}} config
 * @returns {number} in [config.typingWeightFloor, 1]
 */
export function typingCost(word, keymap, config) {
  const floor = floorFrom(config);
  const keys = keysOf(word, keymap);

  let charSum = 0;
  for (const key of keys) {
    charSum += charCost(key);
  }

  let bigramSum = 0;
  for (let i = 1; i < keys.length; i += 1) {
    bigramSum += bigramCost(keys[i - 1], keys[i]);
  }

  const charScore = keys.length === 0 ? 0 : charSum / keys.length;
  const bigramScore = keys.length < 2 ? 0 : bigramSum / (keys.length - 1);

  const penalty =
    KEYBOARD_COST.charShare * charScore + (1 - KEYBOARD_COST.charShare) * bigramScore;

  // Clamped at BOTH ends. The floor is the guarantee; the ceiling exists because
  // the penalty could in principle come out negative if a coefficient were ever
  // set below zero, and a weight above 1 would let an easy word outrank its own
  // bucket.
  return Math.min(1, Math.max(floor, 1 - penalty));
}
