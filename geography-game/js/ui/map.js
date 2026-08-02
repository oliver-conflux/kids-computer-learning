// The map prompt: one country lit among its neighbours.
//
// EVERY COUNTRY IS DRAWN, NOT JUST THE TARGET, and that is the whole prompt. A
// shape alone on white is not a question a kid can answer — it is a Rorschach
// blot. Which countries surround it, which sea it sits on and how big it is
// against the land beside it are exactly the information a kid reasons from, so
// the neighbours are not context around the question, they ARE the question.
// How much of them is shown is js/viewbox.js's job and the one genuinely new
// piece of logic in this game.
//
// THE DIFFERENCE BETWEEN A NEIGHBOUR AND THE TARGET IS MADE IN CSS. This module
// sets two class names and nothing else: no fill, no stroke, no colour, no
// inline style. A renderer that painted the highlight itself would put the
// game's one visual decision in the one file that cannot be looked at, and the
// map is the screen most likely to need tuning in front of a real child.
//
// No projection happens here and none ever should. `country.path` is already
// screen coordinates on a 2000x1000 canvas — see tools/build-countries.js — so
// this file is a loop and two setAttribute calls.

import { COUNTRIES } from '../countries.js';
import { viewBoxFor } from '../viewbox.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Draw the world, framed on one country, into `host`.
 *
 * @param {Element} host the node this function owns and clears
 * @param {{code: string, box: number[]}} country the target
 * @param {{contextFactor: number, minContextSpan: number, maxContextSpan: number}} config
 * @returns {void}
 */
export function renderMap(host, country, config) {
  const view = viewBoxFor(country.box, config);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.width} ${view.height}`);
  svg.setAttribute('class', 'map');
  // The map is the question, so it must not be read out as one. A kid using a
  // screen reader gets the country name from nowhere on this screen — which is
  // the same deal the sighted kid gets, and the alternative is announcing the
  // answer.
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'A map with one country highlighted');

  // The target is appended LAST so nothing paints over its outline. Shared
  // borders mean an adjacent country's stroke lands on the same pixels, and at a
  // 120-unit view that is the difference between a crisp edge and a smudged one.
  // This is z-order, which is the one visual property CSS cannot express for
  // SVG; everything else about the highlight is in prompt.css.
  let target = null;

  for (const other of COUNTRIES) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', other.path);
    if (other.code === country.code) {
      path.setAttribute('class', 'country country--target');
      target = path;
      continue;
    }
    path.setAttribute('class', 'country');
    svg.append(path);
  }

  if (target !== null) {
    svg.append(target);
  }

  host.replaceChildren(svg);
}
