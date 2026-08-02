// The flag prompt: one flag, and nothing that names it.
//
// THE VENDORED PATH, NEVER A CDN. The game is played at anchor with no
// connectivity — see geography-game/data/README.md — and a flag fetched from
// the network is a blank rectangle exactly when the game is being used. All 271
// SVGs are committed for this reason.
//
// `alt` IS EMPTY ON PURPOSE and must stay that way. The country's name is the
// answer to the question this image asks, so any alt text, title, filename hint
// or aria-label carrying it hands the answer to anyone who inspects the page,
// hovers the image, or has a screen reader read it. An empty alt is the correct
// markup for an image whose meaning cannot be restated in text, which is exactly
// the case here: restating it would end the game.

/**
 * Draw one country's flag into `host`.
 *
 * @param {Element} host the node this function owns and clears
 * @param {{code: string}} country
 * @returns {void}
 */
export function renderFlag(host, country) {
  const img = document.createElement('img');
  // Relative to geography-game/index.html, so it works under any served root.
  img.src = `vendor/flag-icons/4x3/${country.code}.svg`;
  img.alt = ''; // the country name IS the answer; see the header
  img.className = 'flag';
  host.replaceChildren(img);
}
