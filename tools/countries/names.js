// The curated country names — the game's answer key, and a curriculum decision.
//
// Natural Earth's NAME field is built for map labels, not for typing: it yields
// `Dominican Rep.` and `Dem. Rep. Congo`. NAME_EN is the honest full name and is
// already pure ASCII across all 177 units, so it is the base. What it is not is
// SHORT -- `People's Republic of China` is 22 letters of which 5 are the answer.
//
// So the rule is: the common short English name, and where two would collide,
// the shortest form that distinguishes them. That rule is why RENAME is small.
//
// Pure module: no DOM, no network, no clock, no randomness.

/** Non-countries and unrecognised states. Excluded by NAME_EN, before any rename. */
export const EXCLUDE = new Set([
  'Antarctica',
  'French Southern and Antarctic Lands',
  'Turkish Republic of Northern Cyprus',
  'Somaliland',
  'Western Sahara',
]);

/**
 * NAME_EN -> what the kid types.
 *
 * Deliberately short. Every entry here is a judgement that belongs in review,
 * which is why there are five of them and not fifty: anything not listed keeps
 * the name Natural Earth gives it.
 *
 * The two Congos are the only pair where the rule bites. `DR Congo` is a
 * compromise -- the full name is 28 letters -- and it is the entry most worth a
 * second opinion.
 */
export const RENAME = {
  "People's Republic of China": 'China',
  'United States of America': 'United States',
  'Democratic Republic of the Congo': 'DR Congo',
  'Republic of the Congo': 'Congo',
  'Czech Republic': 'Czechia',
};

/**
 * Natural Earth codes Taiwan `cn-tw`; the flag set calls it `tw`. This is the
 * ONLY key mismatch between the two sources across all 177 units, which is why
 * it is one line rather than a mapping table.
 */
const CODE_ALIAS = { 'cn-tw': 'tw' };

/** The engine matches on letters only — see the space adapter for why. */
export function normalize(name) {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * `ISO_A2` is -99 for five units. `ISO_A2_EH` rescues France, Norway and Kosovo;
 * the two it does not rescue are unrecognised states already in EXCLUDE, so the
 * fallback is total over everything this function keeps.
 */
function codeOf(properties) {
  const primary = properties.ISO_A2;
  const raw = primary && primary !== '-99' ? primary : properties.ISO_A2_EH;
  if (!raw || raw === '-99') {
    return null;
  }
  const lower = raw.toLowerCase();
  return CODE_ALIAS[lower] ?? lower;
}

/**
 * @param {object[]} features raw GeoJSON features
 * @returns {{code: string, name: string, target: string}[]} in input order
 */
export function curate(features) {
  const out = [];

  for (const feature of features) {
    const englishName = feature.properties.NAME_EN ?? feature.properties.NAME;
    if (EXCLUDE.has(englishName)) {
      continue;
    }
    const code = codeOf(feature.properties);
    if (code === null) {
      continue;
    }
    const name = RENAME[englishName] ?? englishName;
    out.push({ code, name, target: normalize(name) });
  }

  return out;
}
