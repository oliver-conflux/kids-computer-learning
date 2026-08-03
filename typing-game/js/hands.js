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

import { fingerFor, needsShift, shiftSideFor } from './keymap.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Ported verbatim from design/typing-keyboard.dc.html — one entry per finger
// code, giving tip and base coordinates plus radii for taper(). The design
// stores these as [tipX, tipY, baseX, baseY, tipR, baseR, bow] arrays; the
// numbers here are those arrays, named.
//
// The tips sit on the home row: A/S/D/F and J/K/L/; at y≈155, thumbs on the
// space bar at y=286. The hands never move — the highlight alone carries the
// lesson.
const GEO = {
  lp: { tx: 141, ty: 158, bx: 198, by: 398, rt: 12,   rb: 23, bow: -11 },
  lr: { tx: 201, ty: 152, bx: 247, by: 376, rt: 13,   rb: 18, bow: -7 },
  lm: { tx: 261, ty: 150, bx: 283, by: 374, rt: 13.5, rb: 18, bow: -3 },
  li: { tx: 321, ty: 155, bx: 317, by: 378, rt: 13.5, rb: 19, bow: 7 },
  lt: { tx: 372, ty: 286, bx: 350, by: 410, rt: 15,   rb: 28, bow: 8 },
  ri: { tx: 501, ty: 155, bx: 505, by: 378, rt: 13.5, rb: 19, bow: -7 },
  rm: { tx: 561, ty: 150, bx: 539, by: 374, rt: 13.5, rb: 18, bow: 3 },
  rr: { tx: 621, ty: 152, bx: 575, by: 376, rt: 13,   rb: 18, bow: 7 },
  rp: { tx: 681, ty: 158, bx: 624, by: 398, rt: 12,   rb: 23, bow: 11 },
  rt: { tx: 450, ty: 286, bx: 472, by: 410, rt: 15,   rb: 28, bow: -8 },
};

// The two palm shapes, also ported verbatim. They run past the bottom of the
// 385-tall viewBox on purpose — the wrists disappear off the edge of the stage.
const PALMS = [
  'M 200,316 L 330,328 Q 372,334 366,378 L 340,600 L 194,600 L 162,360 Q 158,322 200,316 Z',
  'M 622,316 L 492,328 Q 450,334 456,378 L 482,600 L 628,600 L 660,360 Q 664,322 622,316 Z',
];

/**
 * Tapered capsule from tip (tx,ty) to base (bx,by). Ported verbatim from the
 * design file; the bow parameter curves the finger slightly outward.
 *
 * @returns {string} an SVG path `d` attribute
 */
function taper(tx, ty, bx, by, rt, rb, bow) {
  bow = bow || 0;
  const dx = bx - tx, dy = by - ty, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const px = uy, py = -ux;
  const n = (v) => Math.round(v * 10) / 10;
  const P = (x, y) => n(x) + ',' + n(y);
  const k = 1.33, rm = (rt + rb) / 2;
  const mx = (tx + bx) / 2 + bow, my = (ty + by) / 2;
  return 'M ' + P(tx + px*rt, ty + py*rt) +
    ' C ' + P(tx + px*rt - ux*rt*k, ty + py*rt - uy*rt*k) +
    ' ' + P(tx - px*rt - ux*rt*k, ty - py*rt - uy*rt*k) +
    ' ' + P(tx - px*rt, ty - py*rt) +
    ' Q ' + P(mx - px*rm, my - py*rm) + ' ' + P(bx - px*rb, by - py*rb) +
    ' C ' + P(bx - px*rb + ux*rb*k, by - py*rb + uy*rb*k) +
    ' ' + P(bx + px*rb + ux*rb*k, by + py*rb + uy*rb*k) +
    ' ' + P(bx + px*rb, by + py*rb) +
    ' Q ' + P(mx + px*rm, my + py*rm) + ' ' + P(tx + px*rt, ty + py*rt) + ' Z';
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

  // Fingers first, palms second — the design file's document order, which puts
  // the palms on top and hides the blunt ends of the finger capsules.
  for (const [code, g] of Object.entries(GEO)) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', taper(g.tx, g.ty, g.bx, g.by, g.rt, g.rb, g.bow ?? 0));
    path.setAttribute('class', 'finger');
    path.dataset.finger = code;
    svg.appendChild(path);
    fingerElements.set(code, path);
  }

  for (const d of PALMS) {
    const palm = document.createElementNS(SVG_NS, 'path');
    palm.setAttribute('d', d);
    palm.setAttribute('class', 'palm');
    svg.appendChild(palm);
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

