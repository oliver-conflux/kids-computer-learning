# Typing Game Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the typing game around a real fingering curriculum — 14 letter rungs plus a parallel 5-rung number track — wearing the keyboard-and-hands design, with progress derived from an append-only log.

**Architecture:** Vanilla ES modules, no build step, served from the existing localhost server. Five pure modules (`keymap`, `curriculum`, `content`, `engine`, `progress`) carry all the logic and get real unit tests under `node --test`. Two impure modules (`log`, `main`) touch the network and the DOM. Rendering is verified by playing it, not by tests.

**Tech Stack:** ES modules, `node:test`, `node:assert/strict`, `server/serve.js` (Node 22, zero dependencies), localStorage for preferences only.

**Spec:** `typing-game/docs/superpowers/specs/2026-07-28-typing-game-redesign-design.md` (as amended 2026-08-01). Section references below are to that document.

## Global Constraints

- **Zero dependencies.** No package.json, no install, no build step. Node 22 is the test runtime.
- **ES modules throughout** (§10). Named exports. No `window.TG`, no classic `<script src>`.
- **Five modules are pure** — `keymap.js`, `curriculum.js`, `content.js`, `engine.js`, `progress.js`. No DOM, no network, no clock, no randomness. Time enters as an injected `at` parameter; randomness enters as an injected `rng`.
- **Exactly two impure modules** — `log.js` and `main.js`, matching the math game's arrangement.
- **Run tests with** `node --test typing-game/tests/*.test.js`. The bare directory path does not work; the glob is required.
- **Palette and fonts** come verbatim from `typing-game/design/README.md`: page `#eef0f3`, deck `#d9dde3`, key face `#ffffff`, key label `#6b7381`, heading `#2f3742`, muted `#7b8493`, accent `#7b6bd6`, skin `#e8b7ac`, wrong-key flash `#f4c9c2`, error text `#d98a7d`. Fonts Baloo 2 (display) and Nunito (UI).
- **Key geometry** is `U = 52`, `GAP = 8`, width formula `w * U + (w - 1) * GAP` (§8). Scale the whole stage with one `transform: scale()`; never make the keyboard fluid, or the hand overlay desynchronises.
- **The old game keeps working** until the final task. Do not edit `typing-game/index.html`, `script.js`, or `style.css` before Task 14.
- **Never author content by hand before the validator exists.** Task 5 builds the validator; Task 13 authors against it.

---

## File Structure

**New — pure logic:**

| File | Responsibility |
|---|---|
| `typing-game/js/keymap.js` | key→finger, finger names, row layout, geometry constants, shift rules |
| `typing-game/js/curriculum.js` | 19 lessons across 2 tracks, cumulative `availableKeys`, item mixes |
| `typing-game/js/content.js` | drills, words, sentences per lesson — hand-editable data |
| `typing-game/js/engine.js` | typing state machine, both error models |
| `typing-game/js/progress.js` | derives stars/badges/bests from log events |

**New — impure:**

| File | Responsibility |
|---|---|
| `typing-game/js/log.js` | POST/GET `/api/log?game=typing`, outbox |
| `typing-game/js/settings.js` | localStorage preferences |
| `typing-game/js/keyboard.js` | renders keys, highlight, shake |
| `typing-game/js/hands.js` | SVG hand overlay, finger highlight |
| `typing-game/js/ui.js` | prompt, progress bar, results screen, guidance levels |
| `typing-game/js/main.js` | wiring |

**New — markup and style:** `typing-game/play.html` (the new game; renamed to `index.html` in Task 14), `typing-game/css/{base,layout,keyboard,hands,results}.css`

**Modified:** `server/serve.js` (Task 6, on the math branch), `games-menu.html` (Task 14)

---

## Task 1: keymap.js — fingers, layout, and shift rules

**Files:**
- Create: `typing-game/js/keymap.js`
- Test: `typing-game/tests/keymap.test.js`
- Reference: `typing-game/design/typing-keyboard.dc.html` lines ~120–160 (`FINGER`, `NAMES`, `ROWS`, `FCOLOR`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `FINGER: Record<string, string>` — char → finger code (`'lp'|'lr'|'lm'|'li'|'lt'|'ri'|'rm'|'rr'|'rp'|'rt'`)
  - `NAMES: Record<string, string>` — finger code → display name, e.g. `'right ring'`
  - `ROWS: Array<Array<string | [string, number] | [string, number, string]>>` — keyboard layout
  - `FCOLOR: Record<string, string>` — finger code → hex colour
  - `U: 52`, `GAP: 8`
  - `fingerFor(ch: string): string | null`
  - `fingerName(code: string): string`
  - `needsShift(ch: string): boolean`
  - `baseKeyFor(ch: string): string`
  - `shiftSideFor(ch: string): 'ShiftLeft' | 'ShiftRight' | null`
  - `keyWidth(w: number): number`

Port `FINGER`, `NAMES`, `ROWS`, and `FCOLOR` **verbatim** from the design file. They already cover every digit, `-`, and `=` (§2a) — do not retype them by hand and do not "tidy" them.

- [ ] **Step 1: Write the failing test**

```js
// typing-game/tests/keymap.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FINGER, NAMES, ROWS, U, GAP,
  fingerFor, fingerName, needsShift, baseKeyFor, shiftSideFor, keyWidth,
} from '../js/keymap.js';

test('every letter has a finger', () => {
  for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
    assert.ok(fingerFor(ch) !== null, `no finger for ${ch}`);
  }
});

test('every digit and the number-row tag-alongs have a finger', () => {
  for (const ch of '1234567890-=') {
    assert.ok(fingerFor(ch) !== null, `no finger for ${ch}`);
  }
});

test('digits follow standard touch-typing assignments', () => {
  const expected = {
    '1': 'lp', '2': 'lr', '3': 'lm', '4': 'li', '5': 'li',
    '6': 'ri', '7': 'ri', '8': 'rm', '9': 'rr', '0': 'rp',
    '-': 'rp', '=': 'rp',
  };
  for (const [ch, code] of Object.entries(expected)) {
    assert.equal(fingerFor(ch), code, `${ch} should be ${code}`);
  }
});

test('every finger in FINGER has a display name', () => {
  for (const code of new Set(Object.values(FINGER))) {
    assert.equal(typeof NAMES[code], 'string');
    assert.ok(NAMES[code].length > 0, `empty name for ${code}`);
  }
});

test('fingerFor is case-insensitive for letters', () => {
  assert.equal(fingerFor('T'), fingerFor('t'));
});

test('ROWS includes the full number row', () => {
  const labels = ROWS[0].map((k) => (Array.isArray(k) ? k[0] : k));
  assert.deepEqual(labels.slice(0, 13), ['`','1','2','3','4','5','6','7','8','9','0','-','=']);
});

test('needsShift is true for capitals and the four shifted punctuation marks', () => {
  for (const ch of 'ABZ') assert.equal(needsShift(ch), true, ch);
  for (const ch of '?!":') assert.equal(needsShift(ch), true, ch);
});

test('needsShift is false for lowercase, digits, and unshifted punctuation', () => {
  for (const ch of "az0 9.,/;'") assert.equal(needsShift(ch), false, JSON.stringify(ch));
});

test('baseKeyFor maps shifted characters to their physical key', () => {
  assert.equal(baseKeyFor('A'), 'a');
  assert.equal(baseKeyFor('?'), '/');
  assert.equal(baseKeyFor('!'), '1');
  assert.equal(baseKeyFor('"'), "'");
  assert.equal(baseKeyFor(':'), ';');
  assert.equal(baseKeyFor('e'), 'e');
});

test('shiftSideFor returns the OPPOSITE hand for every letter', () => {
  for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
    const upper = ch.toUpperCase();
    const hand = fingerFor(ch)[0]; // 'l' or 'r'
    const expected = hand === 'l' ? 'ShiftRight' : 'ShiftLeft';
    assert.equal(shiftSideFor(upper), expected, `${upper} wants ${expected}`);
  }
});

test('shiftSideFor handles the spec example: T is left index, wants right shift', () => {
  assert.equal(shiftSideFor('T'), 'ShiftRight');
});

test('shiftSideFor returns null for characters that need no shift', () => {
  assert.equal(shiftSideFor('t'), null);
  assert.equal(shiftSideFor('4'), null);
});

test('! is shift-1, a left pinky key, so it wants the right shift', () => {
  assert.equal(shiftSideFor('!'), 'ShiftRight');
});

test('keyWidth applies the design formula', () => {
  assert.equal(U, 52);
  assert.equal(GAP, 8);
  assert.equal(keyWidth(1), 52);
  assert.equal(keyWidth(2), 2 * 52 + 8);
  assert.equal(keyWidth(1.5), 1.5 * 52 + 0.5 * 8);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test typing-game/tests/keymap.test.js`
Expected: FAIL — `Cannot find module '../js/keymap.js'`

- [ ] **Step 3: Write the implementation**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test typing-game/tests/keymap.test.js`
Expected: PASS, 13 tests

- [ ] **Step 5: Commit**

```bash
git add typing-game/js/keymap.js typing-game/tests/keymap.test.js
git commit -m "Add keymap: fingers, layout, and opposite-hand shift rules"
```

---

## Task 2: engine.js — the typing state machine

**Files:**
- Create: `typing-game/js/engine.js`
- Test: `typing-game/tests/engine.test.js`

**Interfaces:**
- Consumes: `needsShift`, `shiftSideFor` from `keymap.js`
- Produces:
  - `start(text: string, opts: {blockOnError: boolean}): State`
  - `press(state: State, input: {key: string, shiftSide?: string|null, at: number}): State`
  - `backspace(state: State): State`
  - `stats(state: State): {accuracy: number, wpm: number, bestStreak: number}`
  - `isComplete(state: State): boolean`
  - `nextChar(state: State): string | null`
  - `State` shape per spec §11, with `startedAt: number|null` set by the first keystroke

This is the load-bearing module. Every function returns a **new** state object; none mutate. `at` is an injected epoch-milliseconds timestamp — the engine never calls `Date.now()`.

- [ ] **Step 1: Write the failing test**

```js
// typing-game/tests/engine.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { start, press, backspace, stats, isComplete, nextChar } from '../js/engine.js';

const T0 = 1785290000000;

/** Type a whole string cleanly, one key per 100ms. */
function typeAll(state, text, startAt = T0) {
  let s = state;
  [...text].forEach((ch, i) => {
    s = press(s, { key: ch, shiftSide: shiftFor(ch), at: startAt + (i + 1) * 100 });
  });
  return s;
}

function shiftFor(ch) {
  if (ch >= 'A' && ch <= 'Z') return 'ShiftLeft';
  return null;
}

test('start produces an empty state with no clock running', () => {
  const s = start('cat', { blockOnError: true });
  assert.equal(s.text, 'cat');
  assert.deepEqual(s.entries, []);
  assert.equal(s.wrong, null);
  assert.equal(s.keystrokes, 0);
  assert.equal(s.errors, 0);
  assert.equal(s.startedAt, null);
  assert.equal(s.finishedAt, null);
});

test('nextChar reports the character the kid must type next', () => {
  let s = start('cat', { blockOnError: true });
  assert.equal(nextChar(s), 'c');
  s = press(s, { key: 'c', at: T0 });
  assert.equal(nextChar(s), 'a');
});

test('the FIRST keystroke starts the clock, not start()', () => {
  let s = start('cat', { blockOnError: true });
  assert.equal(s.startedAt, null);
  s = press(s, { key: 'c', at: T0 + 5000 });
  assert.equal(s.startedAt, T0 + 5000);
  s = press(s, { key: 'a', at: T0 + 5100 });
  assert.equal(s.startedAt, T0 + 5000, 'later presses must not move the start');
});

test('a correct press appends an entry and advances', () => {
  let s = start('cat', { blockOnError: true });
  s = press(s, { key: 'c', at: T0 });
  assert.deepEqual(s.entries, [{ expected: 'c', actual: 'c', ok: true }]);
  assert.equal(s.keystrokes, 1);
  assert.equal(s.errors, 0);
  assert.equal(s.streak, 1);
});

// --- block mode -----------------------------------------------------------

test('block mode: a wrong press freezes the caret and sets the sticky char', () => {
  let s = start('cat', { blockOnError: true });
  s = press(s, { key: 'x', at: T0 });
  assert.equal(s.wrong, 'x');
  assert.deepEqual(s.entries, [], 'caret must not advance');
  assert.equal(nextChar(s), 'c', 'still waiting for c');
  assert.equal(s.errors, 1);
  assert.equal(s.keystrokes, 1);
  assert.equal(s.streak, 0);
});

test('block mode: a second wrong press REPLACES rather than stacks', () => {
  let s = start('cat', { blockOnError: true });
  s = press(s, { key: 'x', at: T0 });
  s = press(s, { key: 'y', at: T0 + 100 });
  assert.equal(s.wrong, 'y');
  assert.deepEqual(s.entries, []);
  assert.equal(s.errors, 2, 'both wrong presses count');
});

test('block mode: backspace clears the sticky wrong character', () => {
  let s = start('cat', { blockOnError: true });
  s = press(s, { key: 'x', at: T0 });
  s = backspace(s);
  assert.equal(s.wrong, null);
  assert.deepEqual(s.entries, []);
});

test('block mode: the correct key after a wrong one clears it and advances', () => {
  let s = start('cat', { blockOnError: true });
  s = press(s, { key: 'x', at: T0 });
  s = press(s, { key: 'c', at: T0 + 100 });
  assert.equal(s.wrong, null);
  assert.equal(s.entries.length, 1);
  assert.equal(nextChar(s), 'a');
});

// --- pass-through mode ----------------------------------------------------

test('pass-through: a wrong press advances the caret', () => {
  let s = start('cat', { blockOnError: false });
  s = press(s, { key: 'x', at: T0 });
  assert.equal(s.wrong, null, 'no sticky char in pass-through');
  assert.deepEqual(s.entries, [{ expected: 'c', actual: 'x', ok: false }]);
  assert.equal(nextChar(s), 'a', 'caret moved on');
  assert.equal(s.errors, 1);
});

test('pass-through: backspace steps back over the last entry', () => {
  let s = start('cat', { blockOnError: false });
  s = press(s, { key: 'x', at: T0 });
  s = backspace(s);
  assert.deepEqual(s.entries, []);
  assert.equal(nextChar(s), 'c');
});

test('backspace at the very start is a no-op in both modes', () => {
  for (const blockOnError of [true, false]) {
    const s = start('cat', { blockOnError });
    assert.deepEqual(backspace(s), s);
  }
});

// --- shift ----------------------------------------------------------------

test('a capital typed with the correct opposite shift is clean', () => {
  let s = start('Cat', { blockOnError: true });
  s = press(s, { key: 'C', shiftSide: 'ShiftRight', at: T0 });
  assert.equal(s.errors, 0);
  assert.equal(s.entries[0].ok, true);
  assert.equal(s.wrongShiftSide, false);
});

test('WRONG-side shift is accepted and records NO error', () => {
  let s = start('Cat', { blockOnError: true });
  // C is left middle, so it wants ShiftRight. Use the wrong one.
  s = press(s, { key: 'C', shiftSide: 'ShiftLeft', at: T0 });
  assert.equal(s.errors, 0, 'must not be penalised');
  assert.equal(s.entries[0].ok, true, 'character counts as correct');
  assert.equal(s.wrongShiftSide, true, 'but the UI is told, so it can coach');
});

test('wrongShiftSide resets on the next correctly-shifted character', () => {
  let s = start('CAt', { blockOnError: true });
  s = press(s, { key: 'C', shiftSide: 'ShiftLeft', at: T0 });
  assert.equal(s.wrongShiftSide, true);
  s = press(s, { key: 'A', shiftSide: 'ShiftRight', at: T0 + 100 });
  assert.equal(s.wrongShiftSide, false);
});

// --- streaks and completion ----------------------------------------------

test('bestStreak survives a break in the streak', () => {
  let s = start('abcdef', { blockOnError: false });
  s = typeAll(s, 'abc');
  assert.equal(s.bestStreak, 3);
  s = press(s, { key: 'z', at: T0 + 400 });
  assert.equal(s.streak, 0);
  assert.equal(s.bestStreak, 3, 'best is remembered');
  s = press(s, { key: 'e', at: T0 + 500 });
  assert.equal(s.streak, 1);
  assert.equal(s.bestStreak, 3);
});

test('isComplete and finishedAt land on the last character', () => {
  let s = start('cat', { blockOnError: true });
  assert.equal(isComplete(s), false);
  s = typeAll(s, 'cat');
  assert.equal(isComplete(s), true);
  assert.equal(s.finishedAt, T0 + 300);
});

test('presses after completion are ignored', () => {
  let s = start('cat', { blockOnError: true });
  s = typeAll(s, 'cat');
  const after = press(s, { key: 'x', at: T0 + 9999 });
  assert.deepEqual(after, s);
});

// --- stats ----------------------------------------------------------------

test('accuracy is (keystrokes - errors) / keystrokes', () => {
  let s = start('cat', { blockOnError: false });
  s = press(s, { key: 'x', at: T0 });        // wrong
  s = press(s, { key: 'a', at: T0 + 100 });  // right
  s = press(s, { key: 't', at: T0 + 200 });  // right
  assert.equal(stats(s).accuracy, 2 / 3);
});

test('stats on a zero-keystroke state returns 100% and 0 wpm, never NaN', () => {
  const s = start('cat', { blockOnError: true });
  const r = stats(s);
  assert.equal(r.accuracy, 1);
  assert.equal(r.wpm, 0);
  assert.equal(r.bestStreak, 0);
});

test('stats with zero elapsed time returns 0 wpm rather than Infinity', () => {
  let s = start('cat', { blockOnError: true });
  s = press(s, { key: 'c', at: T0 });
  s = press(s, { key: 'a', at: T0 });
  s = press(s, { key: 't', at: T0 });
  assert.equal(stats(s).wpm, 0);
  assert.ok(Number.isFinite(stats(s).wpm));
});

test('wpm is (correctChars / 5) / minutes and ignores pre-first-keystroke time', () => {
  let s = start('abcdefghij', { blockOnError: true });
  // 10 correct chars. First press at T0 + 60000 (a long read), last 60s later.
  [...'abcdefghij'].forEach((ch, i) => {
    s = press(s, { key: ch, at: T0 + 60000 + i * 6000 });
  });
  // elapsed = 54000ms = 0.9 min; 10 chars / 5 = 2 words; 2 / 0.9 = 2.22
  assert.equal(Math.round(stats(s).wpm * 100) / 100, 2.22);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test typing-game/tests/engine.test.js`
Expected: FAIL — `Cannot find module '../js/engine.js'`

- [ ] **Step 3: Write the implementation**

```js
// typing-game/js/engine.js
//
// The typing state machine. Every exported function is pure and returns a NEW
// state; nothing here mutates, touches the DOM, or reads a clock. Time enters
// as an injected `at` timestamp on each press — that is what makes the WPM and
// streak logic testable without a browser.
//
// The two error models (spec §6) differ in exactly one place: whether a
// mismatch appends an entry or parks in `wrong`. Rendering reads `entries` plus
// `wrong` identically in both modes, so there is one rendering path, not two.
//
// Pure module: no DOM, no network, no clock, no randomness.

import { needsShift, shiftSideFor } from './keymap.js';

/**
 * @param {string} text the item to type
 * @param {{blockOnError: boolean}} opts
 * @returns {object} a fresh state
 */
export function start(text, opts) {
  return {
    text,
    entries: [],
    wrong: null,
    keystrokes: 0,
    errors: 0,
    streak: 0,
    bestStreak: 0,
    wrongShiftSide: false,
    startedAt: null,
    finishedAt: null,
    blockOnError: opts.blockOnError,
  };
}

/**
 * The character the kid must type next, or null when the item is done.
 *
 * @param {object} state
 * @returns {string | null}
 */
export function nextChar(state) {
  if (state.entries.length >= state.text.length) return null;
  return state.text[state.entries.length];
}

/**
 * @param {object} state
 * @returns {boolean}
 */
export function isComplete(state) {
  return state.entries.length >= state.text.length;
}

/**
 * Apply one keystroke.
 *
 * A wrong-side shift is deliberately NOT an error (spec §7): the character
 * counts as correct and the UI is told via `wrongShiftSide` so it can coach.
 * Punishing a kid for a capital that came out right teaches the wrong lesson.
 *
 * @param {object} state
 * @param {{key: string, shiftSide?: string|null, at: number}} input
 * @returns {object} a new state
 */
export function press(state, input) {
  if (isComplete(state)) return state;

  const expected = nextChar(state);
  const startedAt = state.startedAt === null ? input.at : state.startedAt;
  const keystrokes = state.keystrokes + 1;

  if (input.key !== expected) {
    const errors = state.errors + 1;
    if (state.blockOnError) {
      return {
        ...state,
        wrong: input.key,
        keystrokes,
        errors,
        streak: 0,
        startedAt,
      };
    }
    const entries = [...state.entries, { expected, actual: input.key, ok: false }];
    return {
      ...state,
      entries,
      wrong: null,
      keystrokes,
      errors,
      streak: 0,
      startedAt,
      finishedAt: entries.length >= state.text.length ? input.at : null,
    };
  }

  const wantedShift = needsShift(expected) ? shiftSideFor(expected) : null;
  const wrongShiftSide =
    wantedShift !== null &&
    input.shiftSide !== null &&
    input.shiftSide !== undefined &&
    input.shiftSide !== wantedShift;

  const entries = [...state.entries, { expected, actual: input.key, ok: true }];
  const streak = state.streak + 1;

  return {
    ...state,
    entries,
    wrong: null,
    keystrokes,
    streak,
    bestStreak: Math.max(state.bestStreak, streak),
    wrongShiftSide,
    startedAt,
    finishedAt: entries.length >= state.text.length ? input.at : null,
  };
}

/**
 * Backspace. In block mode it clears the sticky wrong character; in
 * pass-through it steps back over the last entry. A backspace is not a
 * keystroke and never counts against accuracy.
 *
 * @param {object} state
 * @returns {object} a new state
 */
export function backspace(state) {
  if (state.wrong !== null) return { ...state, wrong: null };
  if (state.entries.length === 0) return state;
  return { ...state, entries: state.entries.slice(0, -1), finishedAt: null };
}

/**
 * @param {object} state
 * @returns {{accuracy: number, wpm: number, bestStreak: number}}
 */
export function stats(state) {
  const accuracy =
    state.keystrokes === 0 ? 1 : (state.keystrokes - state.errors) / state.keystrokes;

  const endedAt = state.finishedAt ?? state.startedAt;
  const elapsedMs =
    state.startedAt === null || endedAt === null ? 0 : endedAt - state.startedAt;
  const minutes = elapsedMs / 60000;
  const correctChars = state.entries.filter((e) => e.ok).length;
  const wpm = minutes <= 0 ? 0 : correctChars / 5 / minutes;

  return { accuracy, wpm, bestStreak: state.bestStreak };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test typing-game/tests/engine.test.js`
Expected: PASS, 20 tests

- [ ] **Step 5: Commit**

```bash
git add typing-game/js/engine.js typing-game/tests/engine.test.js
git commit -m "Add typing engine with block and pass-through error models"
```

---

## Task 3: curriculum.js — 19 lessons across two tracks

**Files:**
- Create: `typing-game/js/curriculum.js`
- Test: `typing-game/tests/curriculum.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `LESSONS: Lesson[]` — all 19, letters first then numbers
  - `Lesson = {id, track, title, newKeys, availableKeys, hint, mix}` where `track` is `'letters'|'numbers'`, `availableKeys` is a `string[]`, `mix` is `{drills, words, sentences}`
  - `lessonById(id: string): Lesson | null`
  - `lessonsForTrack(track: string): Lesson[]`
  - `nextLesson(id: string): Lesson | null` — next within the same track, null at the end

`availableKeys` accumulates **within a track only** (§2a). The number track does not inherit letters and the letter track does not inherit digits.

- [ ] **Step 1: Write the failing test**

```js
// typing-game/tests/curriculum.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LESSONS, lessonById, lessonsForTrack, nextLesson } from '../js/curriculum.js';

test('there are 14 letter rungs and 5 number rungs', () => {
  assert.equal(lessonsForTrack('letters').length, 14);
  assert.equal(lessonsForTrack('numbers').length, 5);
  assert.equal(LESSONS.length, 19);
});

test('lesson ids are unique', () => {
  const ids = new Set(LESSONS.map((l) => l.id));
  assert.equal(ids.size, LESSONS.length);
});

test('every lesson has a complete shape', () => {
  for (const l of LESSONS) {
    assert.equal(typeof l.id, 'string', l.id);
    assert.ok(l.track === 'letters' || l.track === 'numbers', l.id);
    assert.ok(l.title.length > 0, l.id);
    assert.ok(Array.isArray(l.newKeys), l.id);
    assert.ok(Array.isArray(l.availableKeys), l.id);
    assert.ok(l.hint.length > 0, `${l.id} needs a hint — it is read aloud to a kid`);
    assert.equal(l.mix.drills + l.mix.words + l.mix.sentences, 10, `${l.id} mix must total 10`);
  }
});

test('availableKeys is cumulative within a track and never shrinks', () => {
  for (const track of ['letters', 'numbers']) {
    const lessons = lessonsForTrack(track);
    lessons.forEach((lesson, i) => {
      if (i === 0) return;
      const prev = new Set(lessons[i - 1].availableKeys);
      for (const k of prev) {
        assert.ok(lesson.availableKeys.includes(k), `${lesson.id} dropped ${JSON.stringify(k)}`);
      }
    });
  }
});

test("each lesson's new keys appear in its own availableKeys", () => {
  for (const l of LESSONS) {
    for (const k of l.newKeys) {
      if (k === 'Shift') continue;
      assert.ok(l.availableKeys.includes(k), `${l.id} teaches ${k} but does not list it`);
    }
  }
});

test("each lesson's new keys were NOT available in the previous rung", () => {
  for (const track of ['letters', 'numbers']) {
    const lessons = lessonsForTrack(track);
    lessons.forEach((lesson, i) => {
      if (i === 0) return;
      const prev = new Set(lessons[i - 1].availableKeys);
      for (const k of lesson.newKeys) {
        if (k === 'Shift') continue;
        assert.ok(!prev.has(k), `${lesson.id} re-teaches ${k}`);
      }
    });
  }
});

test('the tracks are independent: numbers inherit no letters, letters no digits', () => {
  for (const l of lessonsForTrack('numbers')) {
    for (const k of l.availableKeys) {
      assert.ok(!/[a-z]/.test(k), `${l.id} leaked the letter ${k}`);
    }
  }
  for (const l of lessonsForTrack('letters')) {
    for (const k of l.availableKeys) {
      assert.ok(!/[0-9]/.test(k), `${l.id} leaked the digit ${k}`);
    }
  }
});

test('home-base introduces space with the home row', () => {
  const home = lessonById('home-base');
  assert.deepEqual(home.newKeys.sort(), [';', 'a', 'd', 'f', 'j', 'k', 'l', 's']);
  assert.ok(home.availableKeys.includes(' '));
  assert.equal(home.mix.sentences, 0, 'asdfjkl; cannot make a sentence');
});

test('the letter ladder ends with punctuation, and ! is NOT there', () => {
  const punct = lessonById('punctuation');
  assert.equal(punct.track, 'letters');
  assert.ok(punct.availableKeys.includes('?'));
  assert.ok(punct.availableKeys.includes(':'));
  assert.ok(!punct.availableKeys.includes('!'), '! is shift-1 and belongs to the number track');
});

test('the number track teaches ! at num-10, with - and =', () => {
  const last = lessonById('num-10');
  assert.ok(last.availableKeys.includes('!'));
  assert.ok(last.availableKeys.includes('-'));
  assert.ok(last.availableKeys.includes('='));
});

test('the number track follows middles, index, stretch, rings, pinkies', () => {
  assert.deepEqual(
    lessonsForTrack('numbers').map((l) => l.id),
    ['num-38', 'num-47', 'num-56', 'num-29', 'num-10'],
  );
});

test('no number lesson has sentences — digits alone cannot make one', () => {
  for (const l of lessonsForTrack('numbers')) {
    assert.equal(l.mix.sentences, 0, l.id);
  }
});

test('nextLesson walks a track and stops at its end', () => {
  assert.equal(nextLesson('home-base').id, 'home-stretch');
  assert.equal(nextLesson('num-38').id, 'num-47');
  assert.equal(nextLesson('punctuation'), null, 'letters end here');
  assert.equal(nextLesson('num-10'), null, 'numbers end here');
  assert.equal(nextLesson('nope'), null);
});

test('lessonById returns null for an unknown id rather than throwing', () => {
  assert.equal(lessonById('does-not-exist'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test typing-game/tests/curriculum.test.js`
Expected: FAIL — `Cannot find module '../js/curriculum.js'`

- [ ] **Step 3: Write the implementation**

Build `availableKeys` by accumulation so the data cannot drift out of sync with `newKeys`.

```js
// typing-game/js/curriculum.js
//
// The two curriculum tracks (spec §2 and §2a).
//
// LETTERS is ordered by English letter frequency first, then ergonomics, then
// finger strength, then mirrored pairs. Top row before bottom row is not
// arbitrary: the top row is ~51% of English text and the bottom ~15%.
//
// NUMBERS is a SEPARATE, UNGATED track, not rungs 14-18 of the letter ladder.
// Digits are rarer in prose than any bottom-row letter, so folding them into a
// frequency-ordered ladder would break its own ordering rule — but the kids type
// digits daily in the math game, so gating them behind `z /` is worse. A
// parallel track keeps both honest. availableKeys therefore accumulates WITHIN
// a track and never across.
//
// Pure module: no DOM, no network, no clock, no randomness.

const LETTER_RUNGS = [
  { id: 'home-base',     title: 'Home row',        newKeys: [...'asdfjkl;', ' '],
    hint: 'Rest your fingers on the home row. Thumbs on the space bar.',
    mix: { drills: 6, words: 4, sentences: 0 } },
  { id: 'home-stretch',  title: 'Home stretch',    newKeys: [...'gh'],
    hint: 'Stretch your index finger inward, then bring it straight back.',
    mix: { drills: 5, words: 5, sentences: 0 } },
  { id: 'top-ei',        title: 'Top row: e i',    newKeys: [...'ei'],
    hint: 'Middle fingers reach straight up.',
    mix: { drills: 4, words: 4, sentences: 2 } },
  { id: 'top-ru',        title: 'Top row: r u',    newKeys: [...'ru'],
    hint: 'Index fingers reach straight up.',
    mix: { drills: 4, words: 4, sentences: 2 } },
  { id: 'top-ty',        title: 'Top row: t y',    newKeys: [...'ty'],
    hint: 'Index fingers reach up and inward. This one is a stretch.',
    mix: { drills: 4, words: 4, sentences: 2 } },
  { id: 'top-wo',        title: 'Top row: w o',    newKeys: [...'wo'],
    hint: 'Ring fingers reach straight up.',
    mix: { drills: 3, words: 4, sentences: 3 } },
  { id: 'top-qp',        title: 'Top row: q p',    newKeys: [...'qp'],
    hint: 'Pinkies reach up. Q is the rarest letter in English.',
    mix: { drills: 3, words: 4, sentences: 3 } },
  { id: 'bot-vm',        title: 'Bottom row: v m', newKeys: [...'vm'],
    hint: 'Index fingers curl straight down.',
    mix: { drills: 3, words: 4, sentences: 3 } },
  { id: 'bot-nb',        title: 'Bottom row: n b', newKeys: [...'nb'],
    hint: 'Index fingers curl down and inward.',
    mix: { drills: 3, words: 4, sentences: 3 } },
  { id: 'bot-c-comma',   title: 'Bottom row: c ,', newKeys: [...'c,'],
    hint: 'Middle fingers curl down.',
    mix: { drills: 3, words: 4, sentences: 3 } },
  { id: 'bot-x-period',  title: 'Bottom row: x .', newKeys: [...'x.'],
    hint: 'Ring fingers curl down. Now sentences can end properly.',
    mix: { drills: 3, words: 4, sentences: 3 } },
  { id: 'bot-z-slash',   title: 'Bottom row: z /', newKeys: [...'z/'],
    hint: 'Pinkies curl down. That is the whole alphabet.',
    mix: { drills: 3, words: 3, sentences: 4 } },
  { id: 'shift-caps',    title: 'Shift & capitals', newKeys: ['Shift'],
    hint: 'Use the shift on the OPPOSITE hand from the letter.',
    mix: { drills: 3, words: 3, sentences: 4 } },
  { id: 'punctuation',   title: 'Punctuation',     newKeys: [...`?'":`],
    hint: 'Pinkies again, mostly with shift.',
    mix: { drills: 3, words: 3, sentences: 4 } },
];

const NUMBER_RUNGS = [
  { id: 'num-38', title: 'Numbers: 3 8', newKeys: [...'38', ' '],
    hint: 'Middle fingers reach two rows up.',
    mix: { drills: 7, words: 3, sentences: 0 } },
  { id: 'num-47', title: 'Numbers: 4 7', newKeys: [...'47'],
    hint: 'Index fingers reach two rows up.',
    mix: { drills: 7, words: 3, sentences: 0 } },
  { id: 'num-56', title: 'Numbers: 5 6', newKeys: [...'56'],
    hint: 'Index fingers reach up and inward. The hardest reach on the board.',
    mix: { drills: 7, words: 3, sentences: 0 } },
  { id: 'num-29', title: 'Numbers: 2 9', newKeys: [...'29'],
    hint: 'Ring fingers reach two rows up.',
    mix: { drills: 6, words: 4, sentences: 0 } },
  { id: 'num-10', title: 'Numbers: 1 0', newKeys: [...'10-=!'],
    hint: 'Pinkies. The exclamation mark is shift-1.',
    mix: { drills: 6, words: 4, sentences: 0 } },
];

/** Accumulate availableKeys down a track, so it can never drift from newKeys. */
function buildTrack(rungs, track) {
  const seen = [];
  return rungs.map((rung) => {
    for (const key of rung.newKeys) {
      if (key !== 'Shift' && !seen.includes(key)) seen.push(key);
    }
    return { ...rung, track, availableKeys: [...seen] };
  });
}

export const LESSONS = [
  ...buildTrack(LETTER_RUNGS, 'letters'),
  ...buildTrack(NUMBER_RUNGS, 'numbers'),
];

/**
 * @param {string} id
 * @returns {object | null} the lesson, or null if the id is unknown
 */
export function lessonById(id) {
  return LESSONS.find((l) => l.id === id) ?? null;
}

/**
 * @param {string} track 'letters' or 'numbers'
 * @returns {object[]} that track's lessons, in order
 */
export function lessonsForTrack(track) {
  return LESSONS.filter((l) => l.track === track);
}

/**
 * The next lesson in the SAME track. Tracks do not run into one another.
 *
 * @param {string} id
 * @returns {object | null} null at the end of a track or for an unknown id
 */
export function nextLesson(id) {
  const lesson = lessonById(id);
  if (lesson === null) return null;
  const siblings = lessonsForTrack(lesson.track);
  const index = siblings.findIndex((l) => l.id === id);
  return siblings[index + 1] ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test typing-game/tests/curriculum.test.js`
Expected: PASS, 14 tests

- [ ] **Step 5: Commit**

```bash
git add typing-game/js/curriculum.js typing-game/tests/curriculum.test.js
git commit -m "Add curriculum: 14 letter rungs and a parallel 5-rung number track"
```

---

## Task 4: progress.js — derive stars from the log

**Files:**
- Create: `typing-game/js/progress.js`
- Test: `typing-game/tests/progress.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `starsFor(accuracy: number): 0|1|2|3` — accuracy as a 0..1 fraction
  - `forLesson(events: object[], lessonId: string): {stars, bestAccuracy, bestWpm, attempts, handsOff}`
  - `allProgress(events: object[]): Record<string, object>`

`bestAccuracy` is an integer percentage (0–100) and `bestWpm` an integer, matching the spec §11 shape. Nothing here is ever written to disk — this is the module that replaces the old stored `progress` blob.

- [ ] **Step 1: Write the failing test**

```js
// typing-game/tests/progress.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { starsFor, forLesson, allProgress } from '../js/progress.js';

const round = (over) => ({
  type: 'round', t: '2026-08-01T15:00:00.000Z', build: 't1', session: 's_1',
  lesson: 'top-ei', items: 10, accuracy: 0.96, wpm: 12, bestStreak: 20,
  guidance: 3, ...over,
});

test('star thresholds sit exactly where the spec puts them', () => {
  assert.equal(starsFor(0.899), 1);
  assert.equal(starsFor(0.90), 2, '90% earns the second star');
  assert.equal(starsFor(0.949), 2);
  assert.equal(starsFor(0.95), 3, '95% earns the third');
  assert.equal(starsFor(1), 3);
  assert.equal(starsFor(0), 1, 'finishing at all earns one star');
});

test('an empty event list is zero progress, not a crash', () => {
  const p = forLesson([], 'top-ei');
  assert.deepEqual(p, {
    stars: 0, bestAccuracy: 0, bestWpm: 0, attempts: 0, handsOff: false,
  });
});

test('one clean round yields three stars', () => {
  const p = forLesson([round()], 'top-ei');
  assert.equal(p.stars, 3);
  assert.equal(p.bestAccuracy, 96);
  assert.equal(p.bestWpm, 12);
  assert.equal(p.attempts, 1);
});

test('bests are the maximum across attempts, and attempts counts them all', () => {
  const events = [
    round({ accuracy: 0.80, wpm: 8 }),
    round({ accuracy: 0.96, wpm: 11 }),
    round({ accuracy: 0.91, wpm: 15 }),
  ];
  const p = forLesson(events, 'top-ei');
  assert.equal(p.attempts, 3);
  assert.equal(p.bestAccuracy, 96);
  assert.equal(p.bestWpm, 15, 'best wpm can come from a different round than best accuracy');
  assert.equal(p.stars, 3, 'stars reflect the best round, not the last');
});

test('the hands-off badge needs 3 stars AND guidance <= 1', () => {
  assert.equal(forLesson([round({ accuracy: 0.96, guidance: 3 })], 'top-ei').handsOff, false);
  assert.equal(forLesson([round({ accuracy: 0.96, guidance: 2 })], 'top-ei').handsOff, false);
  assert.equal(forLesson([round({ accuracy: 0.96, guidance: 1 })], 'top-ei').handsOff, true);
  assert.equal(forLesson([round({ accuracy: 0.96, guidance: 0 })], 'top-ei').handsOff, true);
  assert.equal(forLesson([round({ accuracy: 0.80, guidance: 0 })], 'top-ei').handsOff, false,
    '3 stars is required, not just low guidance');
});

test('the badge is sticky: earned once, it stays earned', () => {
  const events = [round({ accuracy: 0.96, guidance: 0 }), round({ accuracy: 0.5, guidance: 3 })];
  assert.equal(forLesson(events, 'top-ei').handsOff, true);
});

test('events for other lessons are ignored', () => {
  const events = [round({ lesson: 'top-ru', accuracy: 1, wpm: 99 }), round()];
  const p = forLesson(events, 'top-ei');
  assert.equal(p.attempts, 1);
  assert.equal(p.bestWpm, 12);
});

test('item events do not count as attempts', () => {
  const events = [{ type: 'item', lesson: 'top-ei', keystrokes: 5, errors: 0 }, round()];
  assert.equal(forLesson(events, 'top-ei').attempts, 1);
});

test('malformed events are skipped rather than fatal', () => {
  const events = [
    null,
    'not an object',
    { type: 'round' },                                   // no lesson
    { type: 'round', lesson: 'top-ei' },                 // no accuracy
    { type: 'round', lesson: 'top-ei', accuracy: 'high' }, // wrong type
    round(),
  ];
  const p = forLesson(events, 'top-ei');
  assert.equal(p.attempts, 1);
  assert.equal(p.bestAccuracy, 96);
});

test('a missing wpm defaults to 0 rather than producing NaN', () => {
  const events = [{ type: 'round', lesson: 'top-ei', accuracy: 0.96, guidance: 3 }];
  const p = forLesson(events, 'top-ei');
  assert.equal(p.bestWpm, 0);
  assert.ok(Number.isFinite(p.bestWpm));
});

test('allProgress keys every lesson that has events', () => {
  const events = [round(), round({ lesson: 'num-38', accuracy: 1, wpm: 20 })];
  const all = allProgress(events);
  assert.deepEqual(Object.keys(all).sort(), ['num-38', 'top-ei']);
  assert.equal(all['num-38'].stars, 3);
  assert.equal(all['top-ei'].bestAccuracy, 96);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test typing-game/tests/progress.test.js`
Expected: FAIL — `Cannot find module '../js/progress.js'`

- [ ] **Step 3: Write the implementation**

```js
// typing-game/js/progress.js
//
// Progress is DERIVED, never stored (spec §9a). The log is the source of truth,
// and everything a kid sees about their history — stars, bests, badges, attempt
// counts — is computed on read from `round` events.
//
// The payoff is that changing a star threshold re-scores all history instead of
// leaving stale stars on disk. The cost is that this module must tolerate every
// shape a log line has ever had, including corrupt ones. A malformed event is
// skipped, never thrown: a kid must always be able to play.
//
// Pure module: no DOM, no network, no clock, no randomness.

const TWO_STAR_ACCURACY = 0.90;
const THREE_STAR_ACCURACY = 0.95;

/** Guidance level at or below which a 3-star round earns the hands-off badge. */
const HANDS_OFF_GUIDANCE = 1;

/**
 * Stars for a round's accuracy. Finishing at all earns one — the ladder is a
 * soft gate and nobody gets stuck (spec §9).
 *
 * @param {number} accuracy 0..1
 * @returns {number} 1, 2, or 3
 */
export function starsFor(accuracy) {
  if (accuracy >= THREE_STAR_ACCURACY) return 3;
  if (accuracy >= TWO_STAR_ACCURACY) return 2;
  return 1;
}

/** A round event we can actually score, or null. */
function asRound(event, lessonId) {
  if (event === null || typeof event !== 'object' || Array.isArray(event)) return null;
  if (event.type !== 'round') return null;
  if (event.lesson !== lessonId) return null;
  if (typeof event.accuracy !== 'number' || !Number.isFinite(event.accuracy)) return null;
  return event;
}

/**
 * Derive one lesson's progress from a tail of log events.
 *
 * @param {object[]} events
 * @param {string} lessonId
 * @returns {{stars: number, bestAccuracy: number, bestWpm: number, attempts: number, handsOff: boolean}}
 */
export function forLesson(events, lessonId) {
  let stars = 0;
  let bestAccuracy = 0;
  let bestWpm = 0;
  let attempts = 0;
  let handsOff = false;

  for (const event of events) {
    const round = asRound(event, lessonId);
    if (round === null) continue;

    attempts += 1;

    const roundStars = starsFor(round.accuracy);
    stars = Math.max(stars, roundStars);
    bestAccuracy = Math.max(bestAccuracy, Math.round(round.accuracy * 100));

    const wpm = typeof round.wpm === 'number' && Number.isFinite(round.wpm) ? round.wpm : 0;
    bestWpm = Math.max(bestWpm, Math.round(wpm));

    const guidance = typeof round.guidance === 'number' ? round.guidance : Infinity;
    if (roundStars === 3 && guidance <= HANDS_OFF_GUIDANCE) handsOff = true;
  }

  return { stars, bestAccuracy, bestWpm, attempts, handsOff };
}

/**
 * Every lesson mentioned by the events, keyed by lesson id.
 *
 * @param {object[]} events
 * @returns {Record<string, object>}
 */
export function allProgress(events) {
  const ids = new Set();
  for (const event of events) {
    if (event !== null && typeof event === 'object' && event.type === 'round' &&
        typeof event.lesson === 'string') {
      ids.add(event.lesson);
    }
  }
  const out = {};
  for (const id of ids) out[id] = forLesson(events, id);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test typing-game/tests/progress.test.js`
Expected: PASS, 11 tests

- [ ] **Step 5: Commit**

```bash
git add typing-game/js/progress.js typing-game/tests/progress.test.js
git commit -m "Derive lesson progress from log events instead of storing it"
```

---

## Task 5: The content validator, before any content exists

**Files:**
- Create: `typing-game/js/content.js` (seed data only — three lessons)
- Test: `typing-game/tests/content.test.js`

**Interfaces:**
- Consumes: `LESSONS`, `lessonById` from `curriculum.js`
- Produces:
  - `CONTENT: Record<string, {drills: string[], words: string[], sentences: string[]}>`
  - `contentFor(lessonId: string): {drills, words, sentences}` — empty arrays for an unknown id
  - `itemsFor(lessonId: string, rng: () => number): string[]` — a 10-item round, drills then words then sentences

**This task builds the validator first and seeds only three lessons.** Task 13 authors the rest against it. Doing it the other way round means discovering a bad word three rungs later.

The validator enforces two rules from §2 and §12: every character must be in the lesson's `availableKeys`, and rungs before `bot-x-period` / `shift-caps` must have no terminal punctuation or capitals.

- [ ] **Step 1: Write the failing test**

```js
// typing-game/tests/content.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LESSONS, lessonById } from '../js/curriculum.js';
import { CONTENT, contentFor, itemsFor } from '../js/content.js';

const KINDS = ['drills', 'words', 'sentences'];

test('every content key names a real lesson', () => {
  for (const id of Object.keys(CONTENT)) {
    assert.ok(lessonById(id) !== null, `CONTENT has "${id}", which is not a lesson`);
  }
});

// THE test. Hand-authored constrained content drifts silently; this is what
// catches a rung asking for a key it never taught.
test('every item uses only keys its lesson has taught', () => {
  for (const [id, buckets] of Object.entries(CONTENT)) {
    const lesson = lessonById(id);
    const allowed = new Set(lesson.availableKeys);
    for (const kind of KINDS) {
      for (const item of buckets[kind] ?? []) {
        for (const ch of item) {
          assert.ok(
            allowed.has(ch),
            `${id} ${kind} "${item}" uses ${JSON.stringify(ch)}, not in availableKeys`,
          );
        }
      }
    }
  }
});

test('no item has leading or trailing whitespace, or a double space', () => {
  for (const [id, buckets] of Object.entries(CONTENT)) {
    for (const kind of KINDS) {
      for (const item of buckets[kind] ?? []) {
        assert.equal(item, item.trim(), `${id} ${kind} "${item}" has stray whitespace`);
        assert.ok(!item.includes('  '), `${id} ${kind} "${item}" has a double space`);
        assert.ok(item.length > 0, `${id} ${kind} has an empty item`);
      }
    }
  }
});

// The §2 authoring rule. Capitals arrive at shift-caps and the period at
// bot-x-period, so everything before those is lowercase and unpunctuated. This
// reads wrong to a content author and gets "corrected" by reflex.
test('lessons before shift-caps contain no capitals', () => {
  for (const [id, buckets] of Object.entries(CONTENT)) {
    const lesson = lessonById(id);
    if (lesson.availableKeys.some((k) => k >= 'A' && k <= 'Z')) continue;
    for (const kind of KINDS) {
      for (const item of buckets[kind] ?? []) {
        assert.ok(!/[A-Z]/.test(item), `${id} ${kind} "${item}" capitalises before shift-caps`);
      }
    }
  }
});

test('lessons before bot-x-period end no sentence with a period', () => {
  for (const [id, buckets] of Object.entries(CONTENT)) {
    const lesson = lessonById(id);
    if (lesson.availableKeys.includes('.')) continue;
    for (const item of buckets.sentences ?? []) {
      assert.ok(!item.endsWith('.'), `${id} "${item}" ends with a period it has not taught`);
    }
  }
});

test('a lesson with a sentences mix of 0 supplies no sentences', () => {
  for (const [id, buckets] of Object.entries(CONTENT)) {
    const lesson = lessonById(id);
    if (lesson.mix.sentences === 0) {
      assert.equal((buckets.sentences ?? []).length, 0,
        `${id} has sentences but its mix asks for none`);
    }
  }
});

test('every lesson with content has enough of each kind to fill a round', () => {
  for (const [id, buckets] of Object.entries(CONTENT)) {
    const { mix } = lessonById(id);
    for (const kind of KINDS) {
      assert.ok((buckets[kind] ?? []).length >= mix[kind],
        `${id} needs ${mix[kind]} ${kind} but has ${(buckets[kind] ?? []).length}`);
    }
  }
});

test('no duplicate items within a bucket', () => {
  for (const [id, buckets] of Object.entries(CONTENT)) {
    for (const kind of KINDS) {
      const items = buckets[kind] ?? [];
      assert.equal(new Set(items).size, items.length, `${id} ${kind} has duplicates`);
    }
  }
});

test('contentFor returns empty buckets for an unauthored lesson', () => {
  assert.deepEqual(contentFor('not-a-lesson'), { drills: [], words: [], sentences: [] });
});

test('itemsFor builds a 10-item round in drills-then-words-then-sentences order', () => {
  const rng = () => 0; // deterministic: always take the first candidate
  const items = itemsFor('top-ei', rng);
  const lesson = lessonById('top-ei');
  assert.equal(items.length, 10);

  const { drills, words, sentences } = contentFor('top-ei');
  items.slice(0, lesson.mix.drills)
    .forEach((it) => assert.ok(drills.includes(it), `${it} should be a drill`));
  items.slice(lesson.mix.drills, lesson.mix.drills + lesson.mix.words)
    .forEach((it) => assert.ok(words.includes(it), `${it} should be a word`));
  items.slice(lesson.mix.drills + lesson.mix.words)
    .forEach((it) => assert.ok(sentences.includes(it), `${it} should be a sentence`));
});

test('itemsFor does not repeat an item within one round', () => {
  let n = 0;
  const rng = () => ((n += 0.37) % 1);
  const items = itemsFor('top-ei', rng);
  assert.equal(new Set(items).size, items.length);
});

test('itemsFor is deterministic for a given rng sequence', () => {
  const make = () => { let n = 0; return () => ((n += 0.37) % 1); };
  assert.deepEqual(itemsFor('top-ei', make()), itemsFor('top-ei', make()));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test typing-game/tests/content.test.js`
Expected: FAIL — `Cannot find module '../js/content.js'`

- [ ] **Step 3: Write the implementation with seed content for three lessons**

`home-base` deliberately has only 12 words — that is genuinely all `asdfjkl;` yields (§3), and it is why the early rungs are drill-heavy.

```js
// typing-game/js/content.js
//
// Hand-authored lesson content. THIS FILE IS DATA — edit it freely, then run
// `node --test typing-game/tests/content.test.js` before committing.
//
// Two rules the tests enforce, both easy to break by reflex:
//
//   1. Every character must appear in the lesson's availableKeys. A rung cannot
//      ask for a key it has not taught.
//   2. Capitals arrive at shift-caps and the period at bot-x-period, so every
//      sentence before those is lowercase and unpunctuated. "she had a field",
//      never "She had a field." This looks wrong. It is correct.
//
// Practice-mode content is deliberately exempt from rule 1 and does not live
// here (spec §4).
//
// Pure module: no DOM, no network, no clock, no randomness.

import { lessonById } from './curriculum.js';

const EMPTY = { drills: [], words: [], sentences: [] };

export const CONTENT = {
  'home-base': {
    drills: [
      'asdf jkl;', 'fj fj fj', 'dk dk dk', 'sl sl sl', 'a; a; a;',
      'fjdk slas', 'jf kd ls ;a', 'ff jj dd kk', 'as df jk l;',
      'lad sad fad', 'ask all add', 'dad lad fad',
    ],
    words: [
      'ask', 'sad', 'lad', 'dad', 'fad', 'all', 'fall', 'flask',
      'salad', 'alas', 'falls', 'asks',
    ],
    sentences: [],
  },

  'home-stretch': {
    drills: [
      'gh gh gh', 'fg fg fg', 'jh jh jh', 'gg hh gg', 'fgh jhg',
      'gas has had', 'lash gash dash', 'flag glad half',
    ],
    words: [
      'gas', 'has', 'had', 'hall', 'half', 'flag', 'glad', 'gash',
      'lash', 'dash', 'shall', 'flash', 'shag', 'gala',
    ],
    sentences: [],
  },

  'top-ei': {
    drills: [
      'did die kid', 'fed lea sid', 'ei ei ei', 'de de de', 'ki ki ki',
      'kid lid did', 'fie die lie', 'held field',
    ],
    words: [
      'slide', 'field', 'said', 'slid', 'held', 'shed', 'lied', 'died',
      'ideal', 'shield', 'defies', 'jailed',
    ],
    sentences: [
      'she had a field',
      'he did like his kid',
      'the lad slid',
      'she has a shield',
      'he held the flag',
      'a sad file',
      'she likes his dad',
      'the kid gladlyfled',
    ],
  },
};

/**
 * @param {string} lessonId
 * @returns {{drills: string[], words: string[], sentences: string[]}}
 */
export function contentFor(lessonId) {
  const buckets = CONTENT[lessonId];
  if (buckets === undefined) return { ...EMPTY };
  return {
    drills: buckets.drills ?? [],
    words: buckets.words ?? [],
    sentences: buckets.sentences ?? [],
  };
}

/** Draw `count` distinct items from `pool` using an injected rng. */
function sample(pool, count, rng) {
  const remaining = [...pool];
  const picked = [];
  for (let i = 0; i < count && remaining.length > 0; i += 1) {
    const index = Math.floor(rng() * remaining.length) % remaining.length;
    picked.push(remaining[index]);
    remaining.splice(index, 1);
  }
  return picked;
}

/**
 * Build one 10-item round. Items ramp: drills, then words, then a sentence
 * (spec §3). Sampling from a larger pool is what makes repeat attempts differ.
 *
 * @param {string} lessonId
 * @param {() => number} rng returns 0..1 — injected so rounds are reproducible
 * @returns {string[]}
 */
export function itemsFor(lessonId, rng) {
  const lesson = lessonById(lessonId);
  if (lesson === null) return [];
  const buckets = contentFor(lessonId);
  return [
    ...sample(buckets.drills, lesson.mix.drills, rng),
    ...sample(buckets.words, lesson.mix.words, rng),
    ...sample(buckets.sentences, lesson.mix.sentences, rng),
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test typing-game/tests/content.test.js`
Expected: PASS, 12 tests

If a seed item fails validation, **fix the item, not the test.** That is the validator doing its job.

- [ ] **Step 5: Commit**

```bash
git add typing-game/js/content.js typing-game/tests/content.test.js
git commit -m "Add content validator and seed three lessons against it"
```

---

## Task 6: serve.js — route the log by game

**Files:**
- Modify: `server/serve.js:165-217` (`createServer`, and the `DEFAULT_LOG_PATH` export above it)
- Test: `math-game/tests/server.test.js` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: `GET|POST /api/log?game=typing` reading and writing `data/typing-log.jsonl`. Omitting `game` keeps the existing math behaviour byte-for-byte.
- Also produces: `LOG_PATHS: Record<string, string>`, `DEFAULT_GAME: 'math'`

**This task belongs on the `math-facts-game` branch, not here.** `serve.js` and its tests are owned there, and making the change in the typing worktree would fork the one file both branches depend on. Land it there, then pick it up on the next merge.

The `game` parameter becomes a filesystem path, so it goes through an **allowlist** — never string interpolation. `serve.js` already treats path traversal seriously enough to have a test for it; hold this to the same bar.

- [ ] **Step 1: Write the failing test**

```js
// append to math-game/tests/server.test.js — follow the existing helpers there
test('GET /api/log?game=typing reads the typing log', async () => {
  const dir = freshTempDir();
  const typingLog = path.join(dir, 'typing-log.jsonl');
  fs.writeFileSync(typingLog, JSON.stringify({ type: 'round', lesson: 'top-ei' }) + '\n');

  const server = createServer({
    root: dir,
    logPaths: { math: path.join(dir, 'math-log.jsonl'), typing: typingLog },
  });
  const base = await listen(server);

  const res = await fetch(`${base}/api/log?game=typing&tail=10`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.events.length, 1);
  assert.equal(body.events[0].lesson, 'top-ei');

  await close(server);
});

test('POST /api/log?game=typing appends to the typing log only', async () => {
  const dir = freshTempDir();
  const mathLog = path.join(dir, 'math-log.jsonl');
  const typingLog = path.join(dir, 'typing-log.jsonl');

  const server = createServer({ root: dir, logPaths: { math: mathLog, typing: typingLog } });
  const base = await listen(server);

  const res = await fetch(`${base}/api/log?game=typing`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'round', lesson: 'top-ei', accuracy: 0.96 }),
  });
  assert.equal(res.status, 204);
  assert.ok(fs.readFileSync(typingLog, 'utf8').includes('top-ei'));
  assert.equal(fs.existsSync(mathLog), false, 'the math log must be untouched');

  await close(server);
});

test('omitting ?game keeps the existing math behaviour', async () => {
  const dir = freshTempDir();
  const mathLog = path.join(dir, 'math-log.jsonl');
  const server = createServer({ root: dir, logPaths: { math: mathLog, typing: path.join(dir, 't.jsonl') } });
  const base = await listen(server);

  const res = await fetch(`${base}/api/log`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'attempt', op: '*', a: 6, b: 7 }),
  });
  assert.equal(res.status, 204);
  assert.ok(fs.readFileSync(mathLog, 'utf8').includes('"a":6'));

  await close(server);
});

test('an unknown game is rejected, not resolved to a path', async () => {
  const dir = freshTempDir();
  const server = createServer({ root: dir });
  const base = await listen(server);

  for (const game of ['nope', '../secrets', 'math-log', '__proto__', '']) {
    const res = await fetch(`${base}/api/log?game=${encodeURIComponent(game)}`);
    assert.equal(res.status, 400, `game=${game} must be rejected`);
  }

  await close(server);
});

test('an unknown game is rejected on POST too, and writes nothing', async () => {
  const dir = freshTempDir();
  const server = createServer({ root: dir });
  const base = await listen(server);

  const res = await fetch(`${base}/api/log?game=../../etc/passwd`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'round' }),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(fs.readdirSync(dir), []);

  await close(server);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test math-game/tests/server.test.js`
Expected: FAIL — `game=typing` currently reads the math log, and unknown games return 200 instead of 400

- [ ] **Step 3: Write the implementation**

```js
// server/serve.js — replace DEFAULT_LOG_PATH's sole use with a game map

export const DEFAULT_GAME = 'math';

export const LOG_PATHS = {
  math: path.join(REPO_ROOT, 'data', 'math-log.jsonl'),
  typing: path.join(REPO_ROOT, 'data', 'typing-log.jsonl'),
};

/**
 * Resolve `?game=` to a log path through an ALLOWLIST.
 *
 * This value reaches the filesystem, so it is never interpolated into a path.
 * An unknown game is a 400, not a fallback — falling back would turn a typo
 * into silent writes to the wrong game's history.
 *
 * @param {Record<string, string>} paths
 * @param {string | null} game
 * @returns {string | null} null if the game is unknown
 */
export function logPathFor(paths, game) {
  const key = game === null || game === undefined ? DEFAULT_GAME : game;
  return Object.prototype.hasOwnProperty.call(paths, key) ? paths[key] : null;
}
```

In `createServer`, replace `const logPath = options.logPath ?? DEFAULT_LOG_PATH;` with:

```js
  const logPaths = options.logPaths ?? LOG_PATHS;
```

and inside the `/api/log` branch, before the GET/POST handling:

```js
    if (url.pathname === '/api/log') {
      const logPath = logPathFor(logPaths, url.searchParams.get('game'));
      if (logPath === null) {
        sendJson(res, 400, { error: 'unknown game' });
        return;
      }
      // ... existing GET and POST bodies, unchanged, now using this logPath
```

Keep `DEFAULT_LOG_PATH` exported as `LOG_PATHS.math` so nothing that imports it breaks.

- [ ] **Step 4: Run the whole suite**

Run: `node --test math-game/tests/*.test.js`
Expected: PASS — the 5 new tests plus all 201 existing ones. The pre-existing tests passing unchanged is the point: the math game must not notice this.

- [ ] **Step 5: Commit (on `math-facts-game`)**

```bash
git add server/serve.js math-game/tests/server.test.js
git commit -m "Route /api/log by game through an allowlist"
```

---

## Task 7: log.js and settings.js — the client side of storage

**Files:**
- Create: `typing-game/js/log.js`, `typing-game/js/settings.js`
- Test: `typing-game/tests/settings.test.js`
- Reference: `math-game/js/log.js` (port it; change the URL and the outbox key)

**Interfaces:**
- Consumes: `/api/log?game=typing` from Task 6
- Produces (`log.js`): `loadEvents(tail?: number): Promise<object[]>`, `record(event: object): void`, `flushOutbox(): Promise<void>`
- Produces (`settings.js`): `DEFAULT_SETTINGS`, `loadSettings(): object`, `saveSettings(s: object): void`

`log.js` is a near-verbatim port of `math-game/js/log.js` — same failure model (204 ok, 4xx permanent and dropped, 5xx/network transient and queued), same guarded-localStorage helpers. Change `LOG_URL` to `/api/log?game=typing`, `OUTBOX_KEY` to `kct.typing.outbox.v1`, and build the GET URL with `&tail=` rather than `?tail=`. It has no tests of its own here; `math-game/tests/log.test.js` already covers the shared logic.

`settings.js` is the one place localStorage holds real state, and it must never prevent a kid from playing (§9a).

- [ ] **Step 1: Write the failing test**

```js
// typing-game/tests/settings.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../js/settings.js';

/** A minimal localStorage stand-in; node has none. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

test('defaults match the spec: block mode on, guidance at full', () => {
  assert.equal(DEFAULT_SETTINGS.blockOnError, true);
  assert.equal(DEFAULT_SETTINGS.guidance, 3);
  assert.equal(DEFAULT_SETTINGS.name, null);
  assert.equal(DEFAULT_SETTINGS.accent, '#7b6bd6');
  assert.equal(DEFAULT_SETTINGS.skin, '#e8b7ac');
});

test('a first run with no storage returns the defaults', () => {
  globalThis.localStorage = fakeStorage();
  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
});

test('no localStorage at all is a first run, not a crash', () => {
  delete globalThis.localStorage;
  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
  assert.doesNotThrow(() => saveSettings({ ...DEFAULT_SETTINGS, name: 'Petra' }));
});

test('saved settings round-trip', () => {
  globalThis.localStorage = fakeStorage();
  saveSettings({ ...DEFAULT_SETTINGS, name: 'Petra', guidance: 1 });
  const loaded = loadSettings();
  assert.equal(loaded.name, 'Petra');
  assert.equal(loaded.guidance, 1);
  assert.equal(loaded.blockOnError, true, 'untouched keys keep their defaults');
});

test('corrupt JSON falls back to defaults silently', () => {
  globalThis.localStorage = fakeStorage({ 'kct.typing.settings.v1': '{not json' });
  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
});

test('a non-object stored value falls back to defaults', () => {
  for (const raw of ['null', '42', '"hello"', '[1,2]']) {
    globalThis.localStorage = fakeStorage({ 'kct.typing.settings.v1': raw });
    assert.deepEqual(loadSettings(), DEFAULT_SETTINGS, raw);
  }
});

test('unknown keys in storage are dropped, not passed through', () => {
  globalThis.localStorage = fakeStorage({
    'kct.typing.settings.v1': JSON.stringify({ name: 'Petra', nonsense: true }),
  });
  assert.equal(loadSettings().nonsense, undefined);
});

test('a guidance level outside 0..3 falls back to the default', () => {
  for (const bad of [-1, 4, 'high', null]) {
    globalThis.localStorage = fakeStorage({
      'kct.typing.settings.v1': JSON.stringify({ guidance: bad }),
    });
    assert.equal(loadSettings().guidance, 3, String(bad));
  }
});

test('a storage that throws on write does not throw into the caller', () => {
  globalThis.localStorage = {
    getItem: () => { throw new Error('disabled'); },
    setItem: () => { throw new Error('quota'); },
    removeItem: () => {},
  };
  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
  assert.doesNotThrow(() => saveSettings(DEFAULT_SETTINGS));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test typing-game/tests/settings.test.js`
Expected: FAIL — `Cannot find module '../js/settings.js'`

- [ ] **Step 3: Write both modules**

```js
// typing-game/js/settings.js
//
// Device preferences — the ONE exception to "the log is the source of truth"
// (spec §9a). These are not observations, and they are needed synchronously at
// boot, before any fetch resolves; routing them through the event stream would
// mean rendering the first frame without knowing what to render.
//
// Every access is guarded. localStorage is absent in node and can throw outright
// in some privacy modes, and a kid must always be able to play: a corrupt value
// and a first run are treated identically.

const KEY = 'kct.typing.settings.v1';

export const DEFAULT_SETTINGS = Object.freeze({
  name: null,
  blockOnError: true,
  guidance: 3,
  accent: '#7b6bd6',
  skin: '#e8b7ac',
  lastLesson: null,
});

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Per-field validation. An invalid field falls back alone, not the whole object. */
function clean(raw) {
  const out = { ...DEFAULT_SETTINGS };
  if (typeof raw.name === 'string' && raw.name.length > 0) out.name = raw.name;
  if (typeof raw.blockOnError === 'boolean') out.blockOnError = raw.blockOnError;
  if (Number.isInteger(raw.guidance) && raw.guidance >= 0 && raw.guidance <= 3) {
    out.guidance = raw.guidance;
  }
  if (typeof raw.accent === 'string') out.accent = raw.accent;
  if (typeof raw.skin === 'string') out.skin = raw.skin;
  if (typeof raw.lastLesson === 'string') out.lastLesson = raw.lastLesson;
  return out;
}

/**
 * @returns {object} settings, always complete and always valid
 */
export function loadSettings() {
  const store = storage();
  if (store === null) return { ...DEFAULT_SETTINGS };

  let raw;
  try {
    raw = store.getItem(KEY);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (raw === null || raw === undefined || raw === '') return { ...DEFAULT_SETTINGS };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...DEFAULT_SETTINGS };
  }
  return clean(parsed);
}

/**
 * @param {object} settings
 * @returns {void}
 */
export function saveSettings(settings) {
  const store = storage();
  if (store === null) return;
  try {
    store.setItem(KEY, JSON.stringify(clean(settings)));
  } catch {
    // Quota exceeded or storage disabled. Losing a preference is strictly
    // better than throwing into the game loop.
  }
}
```

For `log.js`, copy `math-game/js/log.js` verbatim and change exactly four things:

```js
const LOG_URL = '/api/log?game=typing';
const OUTBOX_KEY = 'kct.typing.outbox.v1';
const DEFAULT_TAIL = 2000;          // replaces the CONFIG import

// in loadEvents, the query joins with & because LOG_URL already has a ?
const res = await fetch(`${LOG_URL}&tail=${encodeURIComponent(tail)}`, { ... });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test typing-game/tests/settings.test.js`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add typing-game/js/log.js typing-game/js/settings.js typing-game/tests/settings.test.js
git commit -m "Add typing log client and guarded settings storage"
```

---

## Task 8: The page shell and stylesheets

**Files:**
- Create: `typing-game/play.html`, `typing-game/css/base.css`, `typing-game/css/layout.css`
- Verify: load `http://localhost:8777/typing-game/play.html`

**Interfaces:**
- Consumes: nothing yet — this is the skeleton later tasks fill.
- Produces: DOM ids that Tasks 9–12 attach to: `#stage`, `#keyboard`, `#hands`, `#prompt`, `#target`, `#typed`, `#progress-bar`, `#progress-count`, `#results`, `#lesson-title`

The layout follows §8 top to bottom: progress header, prompt bubble with the bobbing character, the two monospace text lines, then the keyboard-and-hands stage.

Both text lines **must be monospace** — the character-for-character column alignment is the entire reason the two-line compare earns its vertical space.

- [ ] **Step 1: Write the shell**

```html
<!-- typing-game/play.html -->
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Typing</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700&family=Nunito:wght@400;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="css/base.css">
<link rel="stylesheet" href="css/layout.css">
<link rel="stylesheet" href="css/keyboard.css">
<link rel="stylesheet" href="css/hands.css">
<link rel="stylesheet" href="css/results.css">
</head>
<body>
  <header class="topbar">
    <h1 id="lesson-title" class="lesson-title">Home row</h1>
    <div class="progress">
      <span id="progress-count" class="progress-count">0 / 10</span>
      <div class="progress-track"><div id="progress-bar" class="progress-bar"></div></div>
    </div>
  </header>

  <section class="prompt-row">
    <div class="character" aria-hidden="true">
      <div class="character-face"></div>
    </div>
    <p id="prompt" class="prompt">Ready when you are.</p>
  </section>

  <section class="typing-lines">
    <div id="target" class="line line-target"></div>
    <div id="typed" class="line line-typed"></div>
  </section>

  <section id="stage" class="stage">
    <div id="keyboard" class="keyboard"></div>
    <svg id="hands" class="hands" viewBox="0 0 924 385" aria-hidden="true"></svg>
  </section>

  <div id="results" class="results hidden"></div>

  <script type="module" src="js/main.js"></script>
</body>
</html>
```

```css
/* typing-game/css/base.css — palette and fonts, per design/README.md */
:root {
  --page: #eef0f3;
  --deck: #d9dde3;
  --key-face: #ffffff;
  --key-label: #6b7381;
  --heading: #2f3742;
  --muted: #7b8493;
  --accent: #7b6bd6;
  --skin: #e8b7ac;
  --wrong-flash: #f4c9c2;
  --error-text: #d98a7d;

  --display: 'Baloo 2', system-ui, sans-serif;
  --ui: 'Nunito', system-ui, sans-serif;
  --mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
}

*, *::before, *::after { box-sizing: border-box; }
body, h1, p { margin: 0; }

body {
  background: var(--page);
  color: var(--heading);
  font-family: var(--ui);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
  padding: 1.5rem 1rem 2rem;
}

.hidden { display: none !important; }
```

```css
/* typing-game/css/layout.css */
.topbar { width: min(924px, 100%); display: flex; align-items: center; gap: 1rem; }
.lesson-title { font-family: var(--display); font-size: 1.5rem; }
.progress { margin-left: auto; display: flex; align-items: center; gap: .75rem; }
.progress-count { font-weight: 700; color: var(--muted); font-variant-numeric: tabular-nums; }
.progress-track { width: 220px; height: 10px; background: var(--deck); border-radius: 999px; overflow: hidden; }
.progress-bar { height: 100%; width: 0%; background: var(--accent); transition: width .25s ease; }

.prompt-row { width: min(924px, 100%); display: flex; align-items: center; gap: 1rem; }
.character { width: 64px; height: 56px; background: var(--deck); border-radius: 14px;
  display: grid; place-items: center; animation: bob 2.4s ease-in-out infinite; }
.character-face { width: 34px; height: 14px; border-radius: 8px;
  background: radial-gradient(circle at 25% 50%, var(--heading) 4px, transparent 4px),
              radial-gradient(circle at 75% 50%, var(--heading) 4px, transparent 4px); }
@keyframes bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
@media (prefers-reduced-motion: reduce) { .character { animation: none; } }

.prompt { font-size: 1.15rem; color: var(--heading); }

/* Both lines monospace so columns align character-for-character. That
   alignment is the whole point of the two-line compare — it is what lets a kid
   see exactly which letter went wrong. */
.typing-lines { width: min(924px, 100%); display: flex; flex-direction: column; gap: .35rem; }
.line { font-family: var(--mono); font-size: 1.75rem; letter-spacing: .06em; white-space: pre; min-height: 2.2rem; }
.line-target { color: var(--muted); }
.line-typed { color: var(--heading); }
.line-typed .ok { color: var(--heading); }
.line-typed .bad { color: var(--error-text); background: var(--wrong-flash); border-radius: 3px; }
.line-typed .caret { border-left: 2px solid var(--accent); margin-left: -1px; animation: blink 1s step-end infinite; }
@keyframes blink { 50% { border-color: transparent; } }

.shake { animation: shake .18s ease-in-out 2; }
@keyframes shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
```

- [ ] **Step 2: Create the remaining stylesheets as empty placeholders**

Tasks 9, 10, and 11 fill these. They must exist now so `play.html` does not 404.

```bash
touch typing-game/css/keyboard.css typing-game/css/hands.css typing-game/css/results.css
```

- [ ] **Step 3: Create a stub main.js so the module load succeeds**

```js
// typing-game/js/main.js
// Wiring. One of exactly two impure modules (the other is log.js).
console.log('typing game booting');
```

- [ ] **Step 4: Verify it loads**

Run: `node server/serve.js &` then open `http://localhost:8777/typing-game/play.html`
Expected: the header, prompt bubble with a bobbing face, and two empty monospace lines render. The console shows `typing game booting` and **no 404s** in the network tab.

- [ ] **Step 5: Commit**

```bash
git add typing-game/play.html typing-game/css typing-game/js/main.js
git commit -m "Add page shell, palette, and layout for the new typing game"
```

---

## Task 9: keyboard.js — render the deck and highlight keys

**Files:**
- Create: `typing-game/js/keyboard.js`
- Modify: `typing-game/css/keyboard.css`
- Verify: in the browser

**Interfaces:**
- Consumes: `ROWS`, `FINGER`, `FCOLOR`, `U`, `GAP`, `keyWidth`, `baseKeyFor`, `shiftSideFor` from `keymap.js`
- Produces:
  - `renderKeyboard(container: HTMLElement): void`
  - `highlightKey(ch: string | null): void` — lights the key and, for a capital, the opposite shift too
  - `flashWrong(ch: string): void`
  - `setKeyboardVisibility(level: number): void` — guidance levels 0–3 per §1

Highlighting a capital lights **two** keys at once — the letter and the opposite Shift (§7). That simultaneous pair is the main payoff of porting the design, so get it right here.

- [ ] **Step 1: Write the module**

```js
// typing-game/js/keyboard.js
//
// Renders the key deck and drives its highlights. DOM-facing, so it has no unit
// tests — it is verified by playing it (spec §12).
//
// Key geometry comes from keymap.js and must stay in the same coordinate space
// as the hand overlay: both are laid out at 924px and scaled together by one
// transform on the stage. Making the keyboard fluid would desynchronise the
// hands (spec §8).

import { ROWS, FCOLOR, FINGER, GAP, keyWidth, baseKeyFor, shiftSideFor, needsShift } from './keymap.js';

const keyElements = new Map();

/** Every key's identity: its `id` override if present, else its label. */
function keyId(key) {
  if (!Array.isArray(key)) return key.toLowerCase();
  return (key[2] ?? key[0]).toLowerCase();
}

function keyLabel(key) {
  return Array.isArray(key) ? key[0] : key;
}

function keyUnits(key) {
  return Array.isArray(key) ? (key[1] ?? 1) : 1;
}

/**
 * Build the deck once. Safe to call again — it clears first.
 *
 * @param {HTMLElement} container
 * @returns {void}
 */
export function renderKeyboard(container) {
  container.textContent = '';
  keyElements.clear();

  for (const row of ROWS) {
    const rowEl = document.createElement('div');
    rowEl.className = 'kb-row';
    rowEl.style.gap = `${GAP}px`;

    for (const key of row) {
      const el = document.createElement('div');
      const id = keyId(key);
      el.className = 'kb-key';
      el.dataset.key = id;
      el.style.width = `${keyWidth(keyUnits(key))}px`;
      el.style.setProperty('--finger', FCOLOR[FINGER[id]] ?? 'transparent');
      el.textContent = keyLabel(key);
      rowEl.appendChild(el);
      keyElements.set(id, el);
    }
    container.appendChild(rowEl);
  }
}

function clearHighlights() {
  for (const el of keyElements.values()) el.classList.remove('is-next', 'is-wrong');
}

/**
 * Light the key for `ch`. For a capital this lights TWO keys — the letter and
 * the OPPOSITE shift — which is the one thing the hand diagram is uniquely good
 * at showing (spec §7).
 *
 * @param {string | null} ch null clears all highlights
 * @returns {void}
 */
export function highlightKey(ch) {
  clearHighlights();
  if (ch === null) return;

  const base = ch === ' ' ? 'space' : baseKeyFor(ch).toLowerCase();
  keyElements.get(base)?.classList.add('is-next');

  if (needsShift(ch)) {
    const side = shiftSideFor(ch);
    const shiftId = side === 'ShiftLeft' ? 'shift' : 'shift2';
    keyElements.get(shiftId)?.classList.add('is-next');
  }
}

/**
 * Flash a key the kid pressed by mistake.
 *
 * @param {string} ch
 * @returns {void}
 */
export function flashWrong(ch) {
  const base = ch === ' ' ? 'space' : baseKeyFor(ch).toLowerCase();
  const el = keyElements.get(base);
  if (el === undefined) return;
  el.classList.add('is-wrong');
  setTimeout(() => el.classList.remove('is-wrong'), 400);
}

/**
 * Apply a guidance level (spec §1): 3 and 2 show the deck, 1 dims it, 0 hides
 * it entirely. Whether the HANDS show is hands.js's business.
 *
 * @param {number} level 0..3
 * @returns {void}
 */
export function setKeyboardVisibility(level) {
  const stage = document.getElementById('stage');
  if (stage === null) return;
  stage.classList.toggle('guidance-hidden', level === 0);
  stage.classList.toggle('guidance-dim', level === 1);
}
```

- [ ] **Step 2: Write the stylesheet**

```css
/* typing-game/css/keyboard.css */
.stage { position: relative; width: 924px; transform-origin: top center; }
.keyboard { background: var(--deck); border-radius: 18px; padding: 12px;
  display: flex; flex-direction: column; gap: 8px; }
.kb-row { display: flex; justify-content: center; }
.kb-key { height: 52px; border-radius: 9px; background: var(--key-face); color: var(--key-label);
  display: grid; place-items: center; font-family: var(--ui); font-size: .85rem; font-weight: 600;
  box-shadow: 0 1px 0 rgba(0,0,0,.08); transition: background .12s ease, color .12s ease; }
.kb-key.is-next { background: var(--accent); color: #fff; }
.kb-key.is-wrong { background: var(--wrong-flash); color: var(--error-text); }

.stage.guidance-dim .keyboard { opacity: .35; }
.stage.guidance-dim .kb-key.is-next { background: var(--key-face); color: var(--key-label); }
.stage.guidance-hidden { display: none; }
```

- [ ] **Step 3: Verify in the browser**

Temporarily add to `main.js`:

```js
import { renderKeyboard, highlightKey } from './keyboard.js';
renderKeyboard(document.getElementById('keyboard'));
highlightKey('T');
```

Run: reload `http://localhost:8777/typing-game/play.html`
Expected: a full keyboard including the number row. **Two** keys are lit — `T` and the **right** Shift. Try `highlightKey('4')` (only `4` lights) and `highlightKey('?')` (`/` and left Shift light).

- [ ] **Step 4: Remove the temporary verification code from main.js**

- [ ] **Step 5: Commit**

```bash
git add typing-game/js/keyboard.js typing-game/css/keyboard.css
git commit -m "Render the key deck with opposite-shift highlighting"
```

---

## Task 10: hands.js — the tapered hand overlay

**Files:**
- Create: `typing-game/js/hands.js`
- Modify: `typing-game/css/hands.css`
- Reference: `typing-game/design/typing-keyboard.dc.html` — the `taper()` function, the `GEO` table, and the two palm `<path>` elements

**Interfaces:**
- Consumes: `fingerFor`, `shiftSideFor`, `needsShift`, `FCOLOR` from `keymap.js`
- Produces:
  - `renderHands(svg: SVGElement): void`
  - `highlightFinger(ch: string | null): void` — lights two fingers for a capital
  - `setHandsVisibility(level: number): void` — hands show only at level 3

Port **tapered hands only**. The design explored three styles; blocky hands are dead code in that snapshot (the palms sit at `y=392`, outside the `viewBox="0 0 924 385"`, because the stage was shortened from 600px and only the tapered geometry was updated) and "no hands" is superseded by the guidance levels. Do not port either.

- [ ] **Step 1: Write the module**

```js
// typing-game/js/hands.js
//
// The SVG hand overlay. TAPERED HANDS ONLY — the design file also contains a
// blocky variant and a no-hands variant, both rejected (design/README.md). The
// blocky palms are dead code there: they sit at y=392, outside the 385-tall
// viewBox, left behind when the stage was shortened.
//
// The overlay shares a coordinate space with the keyboard and is positioned
// absolutely over it. Both scale together via the stage transform.
//
// DOM-facing: verified by playing it, not by unit tests.

import { FCOLOR, fingerFor, needsShift, shiftSideFor } from './keymap.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Port GEO verbatim from design/typing-keyboard.dc.html: one entry per finger
// code, giving tip and base coordinates plus radii for taper().
const GEO = {
  // e.g. lp: { tx: 96, ty: 168, bx: 88, by: 300, rt: 13, rb: 18, bow: -6 },
  // COPY THE REAL TABLE FROM THE DESIGN FILE — do not invent coordinates.
};

// The two palm shapes, also ported verbatim. In the design file these are the
// two <path> elements that sit BELOW the finger paths in document order. Take
// only the tapered pair — the blocky palms in that file are dead code at y=392,
// outside the viewBox.
const PALMS = [
  // 'M ... Z',  left palm
  // 'M ... Z',  right palm
];

/**
 * Tapered capsule from tip (tx,ty) to base (bx,by). Ported verbatim from the
 * design file; the bow parameter curves the finger slightly outward.
 *
 * @returns {string} an SVG path `d` attribute
 */
function taper(tx, ty, bx, by, rt, rb, bow) {
  // COPY THE REAL IMPLEMENTATION FROM design/typing-keyboard.dc.html.
  // It is ~15 lines of vector maths and must not be re-derived by hand.
}

const fingerElements = new Map();

/**
 * Draw both hands once.
 *
 * @param {SVGElement} svg
 * @returns {void}
 */
export function renderHands(svg) {
  svg.textContent = '';
  fingerElements.clear();

  // Two palm paths, ported verbatim from the design file.
  for (const d of PALMS) {
    const palm = document.createElementNS(SVG_NS, 'path');
    palm.setAttribute('d', d);
    palm.setAttribute('class', 'palm');
    svg.appendChild(palm);
  }

  for (const [code, g] of Object.entries(GEO)) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', taper(g.tx, g.ty, g.bx, g.by, g.rt, g.rb, g.bow ?? 0));
    path.setAttribute('class', 'finger');
    path.dataset.finger = code;
    svg.appendChild(path);
    fingerElements.set(code, path);
  }
}

function clearFingers() {
  for (const el of fingerElements.values()) el.classList.remove('is-active');
}

/**
 * Light the finger that types `ch`. For a capital this lights TWO fingers — the
 * letter's finger and the opposite hand's shift pinky (spec §7).
 *
 * @param {string | null} ch null clears
 * @returns {void}
 */
export function highlightFinger(ch) {
  clearFingers();
  if (ch === null) return;

  const code = fingerFor(ch);
  if (code !== null) fingerElements.get(code)?.classList.add('is-active');

  if (needsShift(ch)) {
    const shiftFinger = shiftSideFor(ch) === 'ShiftLeft' ? 'lp' : 'rp';
    fingerElements.get(shiftFinger)?.classList.add('is-active');
  }
}

/**
 * Hands show ONLY at guidance level 3 (spec §1).
 *
 * @param {number} level 0..3
 * @returns {void}
 */
export function setHandsVisibility(level) {
  const svg = document.getElementById('hands');
  if (svg !== null) svg.classList.toggle('hidden', level < 3);
}
```

- [ ] **Step 2: Write the stylesheet**

```css
/* typing-game/css/hands.css */
.hands { position: absolute; inset: 0; width: 924px; height: 385px; pointer-events: none; }
.palm, .finger { fill: var(--skin); stroke: rgba(0,0,0,.10); stroke-width: 1.5; }
.finger { transition: fill .12s ease; }
.finger.is-active { fill: var(--accent); }
```

- [ ] **Step 3: Verify in the browser**

Temporarily add to `main.js`:

```js
import { renderHands, highlightFinger } from './hands.js';
renderHands(document.getElementById('hands'));
highlightFinger('T');
```

Expected: two tapered hands sit over the keyboard, in the home position. For `'T'` the **left index** and the **right pinky** both light. Fingertips must land on their home keys — if they float, `GEO` was mis-transcribed.

- [ ] **Step 4: Remove the temporary verification code**

- [ ] **Step 5: Commit**

```bash
git add typing-game/js/hands.js typing-game/css/hands.css
git commit -m "Add the tapered hand overlay with opposite-shift finger lighting"
```

---

## Task 11: ui.js — prompt, lines, guidance, results

**Files:**
- Create: `typing-game/js/ui.js`
- Modify: `typing-game/css/results.css`

**Interfaces:**
- Consumes: `fingerFor`, `fingerName`, `needsShift`, `shiftSideFor` from `keymap.js`; `setKeyboardVisibility`, `highlightKey` from `keyboard.js`; `setHandsVisibility`, `highlightFinger` from `hands.js`
- Produces:
  - `renderLines(state: object): void`
  - `renderPrompt(state: object, opts: {name: string|null, hint: string}): void`
  - `renderProgress(index: number, total: number): void`
  - `applyGuidance(level: number): void`
  - `showResults(summary: object, handlers: {onAgain: () => void, onNext: () => void, onStepDown: () => void}): void`
  - `hideResults(): void`

Two details that matter and are easy to miss:

- **A mistyped space renders as `·`** in the error colour (§6). Rendered literally it is invisible, and the kid sees the line shake with no idea what they typed.
- The results screen offers a **step down** in guidance only after a 3-star round, and it must read as unlocking a harder challenge, never as losing a help (§1).

- [ ] **Step 1: Write the module**

```js
// typing-game/js/ui.js
//
// Everything the kid sees except the keyboard and hands: the two text lines,
// the prompt, the progress bar, the guidance level, and the results screen.
//
// DOM-facing: verified by playing it, not by unit tests.

import { fingerFor, fingerName, needsShift, shiftSideFor } from './keymap.js';
import { setKeyboardVisibility, highlightKey } from './keyboard.js';
import { setHandsVisibility, highlightFinger } from './hands.js';

/** A mistyped space is invisible unless we give it a glyph (spec §6). */
function visible(ch) {
  return ch === ' ' ? '·' : ch;
}

function span(text, className) {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

/**
 * Draw both text lines. The target line is static; the typed line shows correct
 * characters, then the sticky wrong character if there is one, then the caret.
 *
 * @param {object} state engine state
 * @returns {void}
 */
export function renderLines(state) {
  document.getElementById('target').textContent = state.text;

  const typed = document.getElementById('typed');
  typed.textContent = '';
  for (const entry of state.entries) {
    typed.appendChild(span(visible(entry.actual), entry.ok ? 'ok' : 'bad'));
  }
  if (state.wrong !== null) {
    typed.appendChild(span(visible(state.wrong), 'bad'));
  } else {
    typed.appendChild(span('', 'caret'));
  }
}

/** Shake the typed line. Used on a wrong press in block mode. */
export function shakeLine() {
  const el = document.getElementById('typed');
  el.classList.remove('shake');
  void el.offsetWidth; // force reflow so the animation restarts
  el.classList.add('shake');
}

/**
 * The speech bubble. Names the finger for the next key, and coaches on shift
 * side without ever scolding — a wrong-side shift still produced the right
 * letter (spec §7).
 *
 * @param {object} state
 * @param {{name: string|null, hint: string}} opts
 * @returns {void}
 */
export function renderPrompt(state, opts) {
  const el = document.getElementById('prompt');
  const next = state.entries.length < state.text.length ? state.text[state.entries.length] : null;

  if (state.wrongShiftSide) {
    el.textContent = 'Nice! Try the other shift next time.';
    return;
  }
  if (next === null) {
    el.textContent = opts.name === null ? 'Done!' : `Done, ${opts.name}!`;
    return;
  }

  const greeting = opts.name === null ? '' : `Howdy ${opts.name}! `;
  const finger = fingerName(fingerFor(next) ?? '');
  if (finger === '') {
    el.textContent = `${greeting}${opts.hint}`;
    return;
  }
  const shiftNote = needsShift(next)
    ? ` with the ${shiftSideFor(next) === 'ShiftLeft' ? 'left' : 'right'} shift`
    : '';
  el.textContent = `${greeting}Use your ${finger} finger${shiftNote}.`;
}

/**
 * @param {number} index items completed so far
 * @param {number} total items in the round
 * @returns {void}
 */
export function renderProgress(index, total) {
  document.getElementById('progress-count').textContent = `${index} / ${total}`;
  document.getElementById('progress-bar').style.width = `${(index / total) * 100}%`;
}

/**
 * Apply a guidance level across keyboard and hands (spec §1).
 *
 * @param {number} level 0..3
 * @returns {void}
 */
export function applyGuidance(level) {
  setKeyboardVisibility(level);
  setHandsVisibility(level);
}

/** Highlight the next key on both the deck and the hands, honouring guidance. */
export function highlightNext(ch, level) {
  highlightKey(level >= 2 ? ch : null);
  highlightFinger(level >= 3 ? ch : null);
}

/**
 * The results screen. The step-down offer appears only after a 3-star round and
 * is framed as unlocking a harder challenge — never as losing a help (spec §1).
 *
 * @param {{stars: number, accuracy: number, wpm: number, bestStreak: number,
 *          canStepDown: boolean, hasNext: boolean}} summary
 * @param {{onAgain: Function, onNext: Function, onStepDown: Function}} handlers
 * @returns {void}
 */
export function showResults(summary, handlers) {
  const el = document.getElementById('results');
  el.textContent = '';
  el.classList.remove('hidden');

  const card = document.createElement('div');
  card.className = 'results-card';

  card.appendChild(span('Lesson complete!', 'results-title'));
  // Always three glyphs: filled up to the stars earned, hollow after.
  const stars = '★'.repeat(summary.stars) + '☆'.repeat(3 - summary.stars);
  card.appendChild(span(stars, 'results-stars'));

  const rows = [
    ['Accuracy', `${Math.round(summary.accuracy * 100)}%`],
    ['Speed', `${Math.round(summary.wpm)} wpm`],
    ['Best streak', String(summary.bestStreak)],
  ];
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    row.className = 'results-row';
    row.appendChild(span(label, 'results-label'));
    row.appendChild(span(value, 'results-value'));
    card.appendChild(row);
  }

  if (summary.canStepDown) {
    const offer = document.createElement('button');
    offer.className = 'results-offer';
    offer.textContent = 'Nice! Want to try that again with the hands off?';
    offer.addEventListener('click', handlers.onStepDown);
    card.appendChild(offer);
  }

  const actions = document.createElement('div');
  actions.className = 'results-actions';
  const again = document.createElement('button');
  again.textContent = 'Again';
  again.addEventListener('click', handlers.onAgain);
  actions.appendChild(again);
  if (summary.hasNext) {
    const next = document.createElement('button');
    next.textContent = 'Next →';
    next.className = 'primary';
    next.addEventListener('click', handlers.onNext);
    actions.appendChild(next);
  }
  card.appendChild(actions);
  el.appendChild(card);
}

/** @returns {void} */
export function hideResults() {
  document.getElementById('results').classList.add('hidden');
}
```

- [ ] **Step 2: Write the stylesheet**

```css
/* typing-game/css/results.css */
.results { position: fixed; inset: 0; display: grid; place-items: center;
  background: rgba(238,240,243,.85); backdrop-filter: blur(3px); }
.results-card { background: #fff; border-radius: 20px; padding: 2rem 2.5rem; min-width: 320px;
  display: flex; flex-direction: column; align-items: center; gap: .6rem;
  box-shadow: 0 12px 40px rgba(0,0,0,.12); }
.results-title { font-family: var(--display); font-size: 1.5rem; }
.results-stars { font-size: 2.25rem; color: var(--accent); letter-spacing: .1em; }
.results-row { width: 100%; display: flex; justify-content: space-between; gap: 2rem; }
.results-label { color: var(--muted); }
.results-value { font-weight: 700; font-variant-numeric: tabular-nums; }
.results-offer { margin-top: .75rem; background: none; border: 2px dashed var(--accent);
  color: var(--accent); border-radius: 12px; padding: .6rem 1rem; font-family: var(--ui);
  font-weight: 600; cursor: pointer; }
.results-actions { margin-top: 1rem; display: flex; gap: .75rem; }
.results-actions button { font-family: var(--ui); font-weight: 700; font-size: 1rem;
  border: none; border-radius: 12px; padding: .7rem 1.4rem; cursor: pointer;
  background: var(--deck); color: var(--heading); }
.results-actions button.primary { background: var(--accent); color: #fff; }
```

- [ ] **Step 3: Commit**

```bash
git add typing-game/js/ui.js typing-game/css/results.css
git commit -m "Add prompt, text lines, guidance levels, and the results screen"
```

---

## Task 12: main.js — wire it together

**Files:**
- Modify: `typing-game/js/main.js`

**Interfaces:**
- Consumes: everything from Tasks 1–11.
- Produces: a playable game.

This is the second impure module. It owns the keyboard event listeners, the round loop, the clock (`Date.now()` lives **here**, injected into `press`), and the log writes.

Tracking which Shift was pressed needs its own listeners: a letter's `keydown` exposes only a boolean `e.shiftKey` with no side information, so record `e.code` from Shift's own `keydown`/`keyup` and consult it when the letter arrives (§7).

- [ ] **Step 1: Write the wiring**

```js
// typing-game/js/main.js
//
// Wiring. One of exactly two impure modules (the other is log.js): this is
// where the DOM, the clock, and the network meet the pure core.
//
// Date.now() lives HERE and nowhere else — the engine takes time as an injected
// `at` so it stays testable without a browser.

import { lessonById, nextLesson } from './curriculum.js';
import { itemsFor } from './content.js';
import { start, press, backspace, stats, isComplete, nextChar } from './engine.js';
import { renderKeyboard, flashWrong } from './keyboard.js';
import { renderHands } from './hands.js';
import { loadSettings, saveSettings } from './settings.js';
import { loadEvents, record, flushOutbox } from './log.js';
import { forLesson, starsFor } from './progress.js';
import {
  renderLines, renderPrompt, renderProgress, applyGuidance,
  highlightNext, showResults, hideResults, shakeLine,
} from './ui.js';

// Declared before anything can reference it — finishItem and finishRound both
// stamp it onto their events.
const sessionId = `s_${Math.random().toString(36).slice(2, 8)}`;
const BUILD = 't1';

let settings = loadSettings();
let lesson = null;
let items = [];
let itemIndex = 0;
let state = null;
let roundKeystrokes = 0;
let roundErrors = 0;
let roundBestStreak = 0;
let roundStartedAt = null;
let shiftSide = null;

/** Track which Shift is down. keydown on a letter only exposes a boolean. */
function watchShift() {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') shiftSide = e.code;
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') shiftSide = null;
  });
}

function scaleStage() {
  const stage = document.getElementById('stage');
  const available = Math.min(document.body.clientWidth - 32, 924);
  stage.style.transform = `scale(${available / 924})`;
}

function startItem() {
  state = start(items[itemIndex], { blockOnError: settings.blockOnError });
  renderLines(state);
  renderPrompt(state, { name: settings.name, hint: lesson.hint });
  renderProgress(itemIndex, items.length);
  highlightNext(nextChar(state), guidanceForItem());
}

/**
 * A drill containing a not-yet-mastered new key always renders at Full,
 * whatever the setting says — you cannot learn a new key's finger without being
 * shown it (spec §1). Words and sentences in the same round follow the setting,
 * so the hands-off badge is still earnable on a new-key lesson.
 */
function guidanceForItem() {
  const isDrill = itemIndex < lesson.mix.drills;
  const hasNewKey = lesson.newKeys.some((k) => items[itemIndex].includes(k));
  return isDrill && hasNewKey ? 3 : settings.guidance;
}

function finishItem() {
  roundKeystrokes += state.keystrokes;
  roundErrors += state.errors;
  roundBestStreak = Math.max(roundBestStreak, state.bestStreak);

  record({
    type: 'item',
    t: new Date().toISOString(),
    build: BUILD,
    session: sessionId,
    lesson: lesson.id,
    kind: itemKind(itemIndex),
    text: state.text,
    keystrokes: state.keystrokes,
    errors: state.errors,
    ms: state.finishedAt - state.startedAt,
    guidance: guidanceForItem(),
    blockOnError: settings.blockOnError,
    misses: state.entries
      .map((e, i) => (e.ok ? null : { expected: e.expected, actual: e.actual, pos: i }))
      .filter((m) => m !== null),
  });

  itemIndex += 1;
  if (itemIndex >= items.length) finishRound();
  else startItem();
}

function itemKind(i) {
  if (i < lesson.mix.drills) return 'drill';
  if (i < lesson.mix.drills + lesson.mix.words) return 'word';
  return 'sentence';
}

function finishRound() {
  const accuracy = roundKeystrokes === 0 ? 1 : (roundKeystrokes - roundErrors) / roundKeystrokes;
  const minutes = (Date.now() - roundStartedAt) / 60000;
  const wpm = minutes <= 0 ? 0 : items.join('').length / 5 / minutes;
  const stars = starsFor(accuracy);

  record({
    type: 'round',
    t: new Date().toISOString(),
    build: BUILD,
    session: sessionId,
    lesson: lesson.id,
    items: items.length,
    accuracy,
    wpm,
    bestStreak: roundBestStreak,
    guidance: settings.guidance,
    handsOff: stars === 3 && settings.guidance <= 1,
  });

  renderProgress(items.length, items.length);
  showResults(
    {
      stars, accuracy, wpm, bestStreak: roundBestStreak,
      canStepDown: stars === 3 && settings.guidance > 0,
      hasNext: nextLesson(lesson.id) !== null,
    },
    {
      onAgain: () => playLesson(lesson.id),
      onNext: () => playLesson(nextLesson(lesson.id).id),
      onStepDown: () => {
        settings = { ...settings, guidance: settings.guidance - 1 };
        saveSettings(settings);
        playLesson(lesson.id);
      },
    },
  );
}

function onKeyDown(e) {
  if (state === null || isComplete(state)) return;
  if (e.key === 'Backspace') {
    e.preventDefault();
    state = backspace(state);
    renderLines(state);
    highlightNext(nextChar(state), guidanceForItem());
    return;
  }
  if (e.key.length !== 1) return; // ignore Tab, arrows, modifiers
  e.preventDefault();

  const before = state;
  state = press(state, { key: e.key, shiftSide, at: Date.now() });

  if (state.errors > before.errors) {
    shakeLine();
    flashWrong(e.key);
  }
  renderLines(state);
  renderPrompt(state, { name: settings.name, hint: lesson.hint });
  highlightNext(nextChar(state), guidanceForItem());

  if (isComplete(state)) finishItem();
}

function playLesson(id) {
  hideResults();
  lesson = lessonById(id);
  items = itemsFor(id, Math.random);
  itemIndex = 0;
  roundKeystrokes = 0;
  roundErrors = 0;
  roundBestStreak = 0;
  roundStartedAt = Date.now();
  settings = { ...settings, lastLesson: id };
  saveSettings(settings);

  document.getElementById('lesson-title').textContent = lesson.title;
  applyGuidance(settings.guidance);
  startItem();
}

async function boot() {
  renderKeyboard(document.getElementById('keyboard'));
  renderHands(document.getElementById('hands'));
  scaleStage();
  window.addEventListener('resize', scaleStage);
  watchShift();
  window.addEventListener('keydown', onKeyDown);

  await flushOutbox();
  const events = await loadEvents();
  const resume = settings.lastLesson ?? 'home-base';
  console.log('progress', forLesson(events, resume));
  playLesson(resume);
}

boot();
```

- [ ] **Step 2: Play it**

Run: `./play.command`, then open `http://localhost:8777/typing-game/play.html`

Check each of these by hand:
- Typing a wrong letter in block mode freezes the caret, shakes the line, flashes the key.
- Backspace clears the red; a second wrong press replaces rather than stacks.
- Finishing 10 items shows the results screen with stars.
- `data/typing-log.jsonl` gains one `item` line per item and one `round` line per round.
- Setting `guidance` to 0 in localStorage hides keyboard and hands, but a new-key drill still shows them.

- [ ] **Step 3: Commit**

```bash
git add typing-game/js/main.js
git commit -m "Wire the typing game: round loop, shift tracking, and logging"
```

---

## Task 13: Author the remaining content

**Files:**
- Modify: `typing-game/js/content.js`
- Create: `typing-game/js/practice.js`

**Interfaces:**
- Consumes: the validator from Task 5.
- Produces: `CONTENT` covering all 19 lessons; `PRACTICE: {words, sentences, math, name}` in `practice.js`.

This is the bulk of the writing and it is a real amount of work. **Run the validator after every lesson**, not at the end:

```bash
node --test typing-game/tests/content.test.js
```

Per-lesson targets — set against each rung's actual alphabet, not applied uniformly:

| Lessons | drills | words | sentences |
|---|---|---|---|
| `home-base`, `home-stretch` | 12–15 | as many as exist (~12) | 0 |
| `top-ei` … `top-qp` | 12–15 | 18–20 | 8–10 |
| `bot-vm` … `punctuation` | 12–15 | 20 | 8–10 |
| `num-38` … `num-10` | 15–20 | 12–15 numbers | 0 |

Rules, restated because they are the ones that get broken:
- Every character must be in the lesson's `availableKeys`.
- No capitals before `shift-caps`. No period before `bot-x-period`.
- Number-track content is digits and space only. Math-flavoured mixed items go in `practice.js`, which is exempt.

Practice content (§4) is **not** key-restricted:

```js
// typing-game/js/practice.js
//
// Practice mode content. Deliberately NOT restricted to taught keys (spec §4) —
// this is where the kids go to play, so the content-validation test skips it.
//
// The `math` tier is the bridge to the math game: real arithmetic worth typing.

export const PRACTICE = {
  words: { short: [/* … */], medium: [/* … */], long: [/* … */] },
  sentences: { short: [/* … */], commas: [/* … */], mixed: [/* … */] },
  math: [
    '6 x 7 = 42',
    '24 divided by 4 is 6',
    'there are 60 seconds in a minute',
    '9 x 9 = 81',
    'half of 100 is 50',
    /* … ~30 total */
  ],
};

/**
 * Practice sentences with the kid's name injected where a sentence has a slot.
 *
 * @param {string[]} pool
 * @param {string | null} name
 * @returns {string[]}
 */
export function withName(pool, name) {
  const who = name ?? 'Someone';
  return pool.map((s) => s.replace('{name}', who));
}
```

- [ ] **Step 1: Author `home-base` and `home-stretch` to target, run the validator, commit**
- [ ] **Step 2: Author the five top-row lessons, run the validator, commit**
- [ ] **Step 3: Author the five bottom-row lessons, run the validator, commit**
- [ ] **Step 4: Author `shift-caps` and `punctuation`, run the validator, commit**
- [ ] **Step 5: Author the five number lessons, run the validator, commit**
- [ ] **Step 6: Author `practice.js` including the Math tier, commit**

```bash
node --test typing-game/tests/*.test.js
git add typing-game/js/content.js typing-game/js/practice.js
git commit -m "Author lesson content for all 19 rungs plus practice mode"
```

---

## Task 14: Practice mode and the first-run name

**Files:**
- Create: `typing-game/js/screens.js`
- Modify: `typing-game/js/main.js`, `typing-game/play.html`, `typing-game/css/layout.css`

**Interfaces:**
- Consumes: `PRACTICE`, `withName` from `practice.js`; `loadSettings`, `saveSettings` from `settings.js`; `LESSONS`, `lessonsForTrack` from `curriculum.js`; `allProgress` from `progress.js`
- Produces:
  - `showNamePrompt(onDone: (name: string|null) => void): void`
  - `showMenu(progress: object, handlers: {onLesson: (id) => void, onPractice: (tab) => void}): void`
  - `practiceItems(tab: string, name: string|null, rng: () => number): string[]`

Two spec sections that the round loop alone does not cover.

**The name (§5).** Asked once on first run, **with a skip** — nothing blocks a kid from just playing. There is no profile picker; each kid has their own computer. The name matters more than it looks: a name starts with a capital, which is the single best motivation a kid will ever have for learning Shift.

**Practice mode (§4).** Never locked, never gated by ladder progress, available from the first launch. Four tabs, same 10-item round shape and same results screen as a lesson.

- [ ] **Step 1: Add the screens markup to `play.html`**

Insert before `<div id="results">`:

```html
  <div id="name-prompt" class="overlay hidden">
    <div class="overlay-card">
      <h2>What should I call you?</h2>
      <input id="name-input" type="text" maxlength="20" autocomplete="off" placeholder="Your name">
      <div class="overlay-actions">
        <button id="name-skip">Skip</button>
        <button id="name-save" class="primary">That's me</button>
      </div>
    </div>
  </div>

  <div id="menu" class="overlay hidden">
    <div class="overlay-card overlay-wide">
      <h2>Pick something to type</h2>
      <div class="track"><h3>Letters</h3><div id="track-letters" class="rungs"></div></div>
      <div class="track"><h3>Numbers</h3><div id="track-numbers" class="rungs"></div></div>
      <div class="track"><h3>Practice</h3><div id="practice-tabs" class="rungs"></div></div>
    </div>
  </div>
```

- [ ] **Step 2: Write `screens.js`**

```js
// typing-game/js/screens.js
//
// The first-run name prompt and the lesson menu (spec §4, §5).
//
// The name is asked ONCE and is always skippable — nothing may stand between a
// kid and playing. There is no profile picker: each kid has their own computer.
//
// DOM-facing: verified by playing it, not by unit tests.

import { lessonsForTrack } from './curriculum.js';
import { PRACTICE, withName } from './practice.js';

const PRACTICE_TABS = [
  { id: 'words', label: 'Words' },
  { id: 'sentences', label: 'Sentences' },
  { id: 'math', label: 'Math' },
  { id: 'name', label: 'My Name' },
];

/**
 * Ask for the kid's name. Calls back with the name, or null if skipped.
 *
 * @param {(name: string | null) => void} onDone
 * @returns {void}
 */
export function showNamePrompt(onDone) {
  const overlay = document.getElementById('name-prompt');
  const input = document.getElementById('name-input');
  overlay.classList.remove('hidden');
  input.focus();

  const finish = (name) => {
    overlay.classList.add('hidden');
    onDone(name);
  };
  document.getElementById('name-skip').addEventListener('click', () => finish(null));
  document.getElementById('name-save').addEventListener('click', () => {
    const value = input.value.trim();
    finish(value.length > 0 ? value : null);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('name-save').click();
  });
}

function rungButton(lesson, progress, onLesson) {
  const button = document.createElement('button');
  button.className = 'rung';
  const p = progress[lesson.id] ?? { stars: 0, handsOff: false };
  const stars = '★'.repeat(p.stars) + '☆'.repeat(3 - p.stars);
  button.innerHTML = '';
  button.appendChild(Object.assign(document.createElement('span'),
    { className: 'rung-title', textContent: lesson.title }));
  button.appendChild(Object.assign(document.createElement('span'),
    { className: 'rung-stars', textContent: stars + (p.handsOff ? ' ✋' : '') }));
  button.addEventListener('click', () => onLesson(lesson.id));
  return button;
}

/**
 * The menu. Every rung is clickable — the ladder is a soft gate and nothing is
 * ever locked (spec §9). Stars are the pull to come back, not a wall.
 *
 * @param {Record<string, object>} progress from progress.allProgress
 * @param {{onLesson: (id: string) => void, onPractice: (tab: string) => void}} handlers
 * @returns {void}
 */
export function showMenu(progress, handlers) {
  document.getElementById('menu').classList.remove('hidden');

  for (const track of ['letters', 'numbers']) {
    const host = document.getElementById(`track-${track}`);
    host.textContent = '';
    for (const lesson of lessonsForTrack(track)) {
      host.appendChild(rungButton(lesson, progress, handlers.onLesson));
    }
  }

  const tabs = document.getElementById('practice-tabs');
  tabs.textContent = '';
  for (const tab of PRACTICE_TABS) {
    const button = document.createElement('button');
    button.className = 'rung';
    button.textContent = tab.label;
    button.addEventListener('click', () => handlers.onPractice(tab.id));
    tabs.appendChild(button);
  }
}

/** @returns {void} */
export function hideMenu() {
  document.getElementById('menu').classList.add('hidden');
}

/** Draw `count` distinct items from `pool`. */
function sample(pool, count, rng) {
  const remaining = [...pool];
  const picked = [];
  for (let i = 0; i < count && remaining.length > 0; i += 1) {
    const index = Math.floor(rng() * remaining.length) % remaining.length;
    picked.push(remaining[index]);
    remaining.splice(index, 1);
  }
  return picked;
}

/**
 * A 10-item practice round. Practice content is NOT key-restricted (spec §4).
 *
 * The "name" tab is the kid's own name repeated — the single best motivation
 * for learning shift, which is why it lives here, ungated, rather than behind
 * rung 12. A kid who skipped the name prompt gets the sentences tab instead.
 *
 * @param {string} tab one of 'words' | 'sentences' | 'math' | 'name'
 * @param {string | null} name
 * @param {() => number} rng
 * @returns {string[]}
 */
export function practiceItems(tab, name, rng) {
  if (tab === 'name') {
    if (name === null) return practiceItems('sentences', null, rng);
    return Array.from({ length: 10 }, () => name);
  }
  if (tab === 'math') return sample(PRACTICE.math, 10, rng);
  if (tab === 'words') {
    const all = [...PRACTICE.words.short, ...PRACTICE.words.medium, ...PRACTICE.words.long];
    return sample(all, 10, rng);
  }
  const all = [
    ...PRACTICE.sentences.short, ...PRACTICE.sentences.commas, ...PRACTICE.sentences.mixed,
  ];
  return withName(sample(all, 10, rng), name);
}
```

- [ ] **Step 3: Style the overlays**

```css
/* append to typing-game/css/layout.css */
.overlay { position: fixed; inset: 0; display: grid; place-items: center;
  background: rgba(238,240,243,.9); backdrop-filter: blur(3px); z-index: 10; }
.overlay-card { background: #fff; border-radius: 20px; padding: 2rem 2.5rem;
  display: flex; flex-direction: column; gap: 1rem; align-items: center;
  box-shadow: 0 12px 40px rgba(0,0,0,.12); }
.overlay-card h2 { font-family: var(--display); margin: 0; }
.overlay-wide { min-width: min(680px, 92vw); align-items: stretch; }
.overlay-actions { display: flex; gap: .75rem; }
.overlay-actions button, .rung { font-family: var(--ui); font-weight: 700; border: none;
  border-radius: 12px; padding: .7rem 1.2rem; cursor: pointer;
  background: var(--deck); color: var(--heading); }
.overlay-actions button.primary { background: var(--accent); color: #fff; }
#name-input { font-family: var(--ui); font-size: 1.1rem; padding: .6rem .9rem;
  border: 2px solid var(--deck); border-radius: 12px; }
.track h3 { font-family: var(--display); color: var(--muted); margin: 1rem 0 .5rem; }
.rungs { display: flex; flex-wrap: wrap; gap: .5rem; }
.rung { display: flex; flex-direction: column; align-items: flex-start; gap: .2rem; }
.rung-stars { color: var(--accent); font-size: .8rem; }
```

- [ ] **Step 4: Wire both into `main.js`**

First add the imports. Task 12 imported `forLesson`; the menu needs `allProgress` instead:

```js
import { forLesson, allProgress, starsFor } from './progress.js';
import { showNamePrompt, showMenu, hideMenu, practiceItems } from './screens.js';
```

Then replace `boot()` with:

```js
async function boot() {
  renderKeyboard(document.getElementById('keyboard'));
  renderHands(document.getElementById('hands'));
  scaleStage();
  window.addEventListener('resize', scaleStage);
  watchShift();
  window.addEventListener('keydown', onKeyDown);

  await flushOutbox();
  const events = await loadEvents();
  const progress = allProgress(events);

  const openMenu = () => showMenu(progress, {
    onLesson: (id) => { hideMenu(); playLesson(id); },
    onPractice: (tab) => { hideMenu(); playPractice(tab); },
  });

  // First run: ask for a name once, always skippable. `hasAskedName` is what
  // distinguishes "skipped" from "not yet asked" — without it, a kid who
  // skipped would be asked again on every single launch.
  if (!settings.hasAskedName) {
    showNamePrompt((name) => {
      settings = { ...settings, name, hasAskedName: true };
      saveSettings(settings);
      openMenu();
    });
    return;
  }
  openMenu();
}
```

Add `playPractice`, which reuses the whole round loop:

```js
function playPractice(tab) {
  hideResults();
  // Practice rounds are not a rung: they use a synthetic lesson so the existing
  // round loop, results screen, and logging all work unchanged.
  lesson = {
    id: `practice-${tab}`,
    track: 'practice',
    title: `Practice: ${tab}`,
    newKeys: [],
    availableKeys: [],
    hint: 'Type it just as you see it.',
    mix: { drills: 0, words: 10, sentences: 0 },
  };
  items = practiceItems(tab, settings.name, Math.random);
  itemIndex = 0;
  roundKeystrokes = 0;
  roundErrors = 0;
  roundBestStreak = 0;
  roundStartedAt = Date.now();

  document.getElementById('lesson-title').textContent = lesson.title;
  applyGuidance(settings.guidance);
  startItem();
}
```

`nextLesson('practice-…')` returns null, so the results screen correctly offers only **Again** for a practice round.

- [ ] **Step 5: Add `hasAskedName` to settings**

In `settings.js`, add to `DEFAULT_SETTINGS`:

```js
  hasAskedName: false,
```

and to `clean()`:

```js
  if (typeof raw.hasAskedName === 'boolean') out.hasAskedName = raw.hasAskedName;
```

Add a test to `typing-game/tests/settings.test.js`:

```js
test('hasAskedName defaults false and round-trips, so a skip is remembered', () => {
  globalThis.localStorage = fakeStorage();
  assert.equal(DEFAULT_SETTINGS.hasAskedName, false);
  saveSettings({ ...DEFAULT_SETTINGS, name: null, hasAskedName: true });
  const loaded = loadSettings();
  assert.equal(loaded.hasAskedName, true, 'a kid who skipped must not be asked again');
  assert.equal(loaded.name, null);
});
```

- [ ] **Step 6: Run the suite and play it**

Run: `node --test typing-game/tests/*.test.js`
Expected: PASS, including the new settings test

Then play: clear localStorage, reload. The name prompt appears once; skipping it never asks again. The menu shows both tracks with stars and four practice tabs. The Math tab types real arithmetic.

- [ ] **Step 7: Commit**

```bash
git add typing-game/js/screens.js typing-game/js/main.js typing-game/js/settings.js \
        typing-game/play.html typing-game/css/layout.css typing-game/tests/settings.test.js
git commit -m "Add practice mode, the lesson menu, and the first-run name prompt"
```

---

## Task 15: Cut over and retire the old game

**Files:**
- Rename: `typing-game/play.html` → `typing-game/index.html`
- Delete: `typing-game/script.js`, `typing-game/style.css`
- Modify: `games-menu.html:139`

**Interfaces:**
- Consumes: a finished, played-through game.
- Produces: the new game at the URL the menu already points to.

Do this **only after playing the whole ladder through**. Until this task, the old game keeps working (§13).

The old game runs from `file://`; the new one does not. After the cutover, opening `games-menu.html` by double-clicking will appear to work and then fail at the first log write — so the menu must be reached through `play.command`.

- [ ] **Step 1: Confirm the full suite passes**

Run: `node --test typing-game/tests/*.test.js math-game/tests/*.test.js`
Expected: PASS, everything

- [ ] **Step 2: Swap the files**

```bash
git rm typing-game/script.js typing-game/style.css
git mv typing-game/play.html typing-game/index.html
```

- [ ] **Step 3: Update the menu description**

In `games-menu.html`, update the Typing Game card's blurb from "Practice your typing skills with fun words!" to something that reflects the curriculum, e.g. "Learn to touch type — letters, numbers, and all ten fingers."

- [ ] **Step 4: Play it once more from the menu**

Run: `./play.command`
Expected: the menu opens at `http://localhost:8777/games-menu.html`, the Typing Game card leads to the new game, and a round logs to `data/typing-log.jsonl`.

- [ ] **Step 5: Commit**

```bash
git add games-menu.html typing-game/
git commit -m "Cut over to the new typing game and retire the old one"
```

---

## Open items carried from the spec

These are **not** tasks. They are decisions the spec leaves open (§14) and one that needs a human answer before Task 12 logs anything real:

- **Is `data/typing-log.jsonl` committed?** The math spec commits its log. A typing log contains the kid's name and this repo has an `origin`. Decide before the first commit that would include one; if it stays out, add it to `.gitignore` as part of Task 12.
- Exact wording of cheers and prompts — worth a pass with the kids once it is playable.
- Whether practice sentences get themed tags on top of difficulty tiers. Deferred until the content feels monotonous in use.
- Whether the two tracks share one progress screen or get separate ladder views. Depends on how the kids actually navigate.
