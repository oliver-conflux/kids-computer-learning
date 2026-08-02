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
