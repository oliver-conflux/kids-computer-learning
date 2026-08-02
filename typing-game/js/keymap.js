// typing-game/js/keymap.js
//
// The physical keyboard: which finger owns which key, how the rows lay out, and
// how shifted characters decompose into a base key plus an opposite-hand shift.
//
// FINGER, NAMES, ROWS, and FCOLOR are ported verbatim from
// design/typing-keyboard.dc.html. They already cover the number row, which is
// why the number track (spec §2a) needed no rendering work. Do not "tidy" them
// into a different shape — the design file stays the source of truth, and a
// diff against it should stay readable.
//
// Pure module: no DOM, no network, no clock, no randomness.

export const U = 52;
export const GAP = 8;

export const FINGER = {
  '`':'lp','1':'lp','q':'lp','a':'lp','z':'lp','tab':'lp','caps':'lp','shift':'lp',
  '2':'lr','w':'lr','s':'lr','x':'lr',
  '3':'lm','e':'lm','d':'lm','c':'lm',
  '4':'li','5':'li','r':'li','t':'li','f':'li','g':'li','v':'li','b':'li',
  '6':'ri','7':'ri','y':'ri','u':'ri','h':'ri','j':'ri','n':'ri','m':'ri',
  '8':'rm','i':'rm','k':'rm',',':'rm',
  '9':'rr','o':'rr','l':'rr','.':'rr',
  '0':'rp','-':'rp','=':'rp','p':'rp','[':'rp',']':'rp','\\':'rp',';':'rp',"'":'rp','/':'rp',
  'delete':'rp','enter':'rp','shift2':'rp','space':'rt',
  'ctrl':'lp','alt':'lp','cmd':'lt','cmd2':'rt','alt2':'rp','ctrl2':'rp',
};

export const NAMES = {
  lp:'left pinky', lr:'left ring', lm:'left middle', li:'left index', lt:'left thumb',
  ri:'right index', rm:'right middle', rr:'right ring', rp:'right pinky', rt:'right thumb',
};

export const ROWS = [
  ['`','1','2','3','4','5','6','7','8','9','0','-','=',['delete',2]],
  [['tab',1.5],'Q','W','E','R','T','Y','U','I','O','P','[',']',['\\',1.5]],
  [['caps',1.75],'A','S','D','F','G','H','J','K','L',';',"'",['enter',2.25]],
  [['shift',2.25],'Z','X','C','V','B','N','M',',','.','/',['shift',2.75,'shift2']],
  [['ctrl',1.25],['alt',1.25],['cmd',1.75],['space',6.5],['cmd',1.75,'cmd2'],['alt',1.25,'alt2'],['ctrl',1.25,'ctrl2']],
];

export const FCOLOR = {
  lp:'#f0a6b6', lr:'#f3c463', lm:'#86ce93', li:'#76bde4', lt:'#bdb3ec',
  rp:'#f0a6b6', rr:'#f3c463', rm:'#86ce93', ri:'#76bde4', rt:'#bdb3ec',
};

// Every shifted character the curriculum teaches, mapped to its physical key.
// `!` is here because it is shift-1 and belongs to the number track (spec §2a);
// `?`, `"`, and `:` arrive at rung 13. This set and spec §7's needsShift list
// are the same set by construction — keep them that way.
const SHIFTED = { '?': '/', '!': '1', '"': "'", ':': ';' };

/**
 * The finger that owns a character's physical key. Case-insensitive, and
 * resolves shifted punctuation to the finger of its base key.
 *
 * @param {string} ch
 * @returns {string | null} a finger code, or null for an unmapped character
 */
export function fingerFor(ch) {
  if (ch === ' ') return FINGER.space;
  const base = baseKeyFor(ch).toLowerCase();
  return Object.prototype.hasOwnProperty.call(FINGER, base) ? FINGER[base] : null;
}

/**
 * @param {string} code a finger code
 * @returns {string} display name, e.g. "right ring" — '' if unknown
 */
export function fingerName(code) {
  return Object.prototype.hasOwnProperty.call(NAMES, code) ? NAMES[code] : '';
}

/**
 * @param {string} ch
 * @returns {boolean} whether typing `ch` requires holding shift
 */
export function needsShift(ch) {
  if (ch.length !== 1) return false;
  if (ch >= 'A' && ch <= 'Z') return true;
  return Object.prototype.hasOwnProperty.call(SHIFTED, ch);
}

/**
 * The unshifted character on the same physical key.
 *
 * @param {string} ch
 * @returns {string}
 */
export function baseKeyFor(ch) {
  if (Object.prototype.hasOwnProperty.call(SHIFTED, ch)) return SHIFTED[ch];
  if (ch >= 'A' && ch <= 'Z') return ch.toLowerCase();
  return ch;
}

/**
 * Which shift key `ch` should be typed with: always the hand OPPOSITE the one
 * holding the base key. Same-hand shifting is the habit everyone develops and
 * nobody unlearns, so the game teaches against it from the first capital.
 *
 * @param {string} ch
 * @returns {'ShiftLeft' | 'ShiftRight' | null} null if no shift is needed
 */
export function shiftSideFor(ch) {
  if (!needsShift(ch)) return null;
  const finger = fingerFor(ch);
  if (finger === null) return null;
  return finger[0] === 'l' ? 'ShiftRight' : 'ShiftLeft';
}

/**
 * Pixel width of a key spanning `w` key units, per the design's formula.
 *
 * @param {number} w width multiplier
 * @returns {number}
 */
export function keyWidth(w) {
  return w * U + (w - 1) * GAP;
}
