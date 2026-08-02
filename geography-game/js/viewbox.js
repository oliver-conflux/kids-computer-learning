// How much of the world the map prompt shows.
//
// This is the only genuinely new logic in the game, and it is the whole
// pedagogical content of the map prompt. Too tight and the question is
// unanswerable -- a shape alone on white tells a kid nothing. Too wide and it is
// a needle in a haystack. Central America with one country lit is the question.
//
// The view is always SQUARE. A view that matched each country's aspect ratio
// would silently rescale between problems, so a kid would learn "long thin
// country" as a property of the frame rather than of Chile.
//
// Pure module: no DOM, no network, no clock, no randomness.

/**
 * @param {[number, number, number, number]} box the country's projected bounds
 * @param {{contextFactor: number, minContextSpan: number, maxContextSpan: number}} config
 * @returns {{x: number, y: number, width: number, height: number}}
 */
export function viewBoxFor(box, config) {
  const [x, y, width, height] = box;

  const span = Math.max(width, height) * config.contextFactor;
  const clamped = Math.min(Math.max(span, config.minContextSpan), config.maxContextSpan);

  const centreX = x + width / 2;
  const centreY = y + height / 2;

  return {
    x: centreX - clamped / 2,
    y: centreY - clamped / 2,
    width: clamped,
    height: clamped,
  };
}
