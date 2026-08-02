// The country spine — the order the whole game walks.
//
// TWO SECTIONS, ORDERED ON DIFFERENT PRINCIPLES, which is the same shape the
// spelling spine has and for the same reason: no derivable ordering produces a
// good first lesson.
//
// The OPENER is hand-authored and local. It is the water this family is
// actually sailing -- the passages in ~/sailing-weather run through exactly
// these countries -- and geography a kid can walk ashore into is retained
// differently from geography on a flashcard. No population ranking would ever
// put Belize first, and Belize is the right first country here.
//
// The TAIL widens outward by familiarity, standing in for "likely to have heard
// of it". That is the right principle once the local water runs out, and it is
// derivable, so it is generated rather than authored.
//
// Every country appears TWICE, as a shape item and a flag item. They are
// separate items with separate mastery, which is the 6x7/7x6 decision from the
// math game: knowing where Belize is and knowing its flag are different
// knowledge, and one merged record could not say which one is weak.
//
// Pure module: no DOM, no network, no clock, no randomness.

import { COUNTRIES } from './countries.js';

/**
 * The Caribbean and Central America, in the order a boat meets them heading
 * south and east from the Yucatan. Hand-authored; see the header.
 */
export const OPENER = [
  'bz', 'gt', 'mx', 'hn', 'cu', 'jm', 'pa', 'cr',
  'ni', 'sv', 'co', 'do', 'ht', 'bs',
];

/** Both prompts for one country, adjacent in the spine so they enter together. */
function entriesFor(country, rank) {
  return [
    { ...country, kind: 'shape', rank },
    { ...country, kind: 'flag', rank },
  ];
}

function buildSpine() {
  const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));
  const spine = [];
  let rank = 0;

  for (const code of OPENER) {
    const country = byCode.get(code);
    if (country === undefined) {
      throw new Error(`opener names ${code}, which is not in COUNTRIES`);
    }
    spine.push(...entriesFor(country, rank));
    rank += 1;
  }

  // The tail keeps COUNTRIES order, which build-countries.js emits in descending
  // familiarity. Ordering lives in the tool, not here, so a retune regenerates
  // one file and no consumer notices.
  for (const country of COUNTRIES) {
    if (OPENER.includes(country.code)) {
      continue;
    }
    spine.push(...entriesFor(country, rank));
    rank += 1;
  }

  return spine;
}

export const SPINE = buildSpine();
