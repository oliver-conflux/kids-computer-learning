# Geography Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fourth game where a country is shown as a highlighted shape on a map or as a flag, and the kid types the country's name.

**Architecture:** Country geometry is projected, simplified and committed as SVG path strings by a build tool that runs once; the browser renders plain inline SVG with no map library and no runtime projection. Flags are vendored SVGs. The game reuses `core/engine.js`, `core/mastery.js` and `core/scheduler.js` unchanged by answering with typed text, and promotes two modules out of `spelling-game/` into `core/` as their third consumer.

**Tech Stack:** Vanilla ES modules, no bundler, no dependencies. `node --test` for tests. Node 22+.

## Global Constraints

- **Spec:** `geography-game/docs/superpowers/specs/2026-08-02-geography-name-and-flag-games-design.md`. Read it before Task 1.
- **Branch:** `geography-impl`, in the worktree at `~/kids-computer-learning-geography`, off `master`. Work only there — the main checkout is on another branch and must not be touched.
- **Zero runtime dependencies.** No npm install, no `package.json`, no CDN. `play.command` serves static files and must keep working untouched.
- **Fully offline at play time.** Every asset is committed.
- **`core/engine.js`, `core/mastery.js`, `core/scheduler.js` and `core/space.js` are NOT modified by this plan.** If a task seems to require changing one, stop and raise it.
- **`space` is always the LAST parameter**, matching `deriveMastery(events, config, space)`.
- **Match the house comment style.** Every module opens with a comment saying what it is and *why it is that way*, not what it does. Read `spelling-game/js/space.js` for the register.
- **Magic numbers live in `CONFIG`**, with the one documented exception of physical-model tables (see `typing-cost.js`).
- **Tests:** `node --test <file>` for one file. For a whole directory you MUST use a quoted glob — `node --test 'core/tests/*.test.js'`. Passing a bare directory (`node --test core/tests/`) fails with `MODULE_NOT_FOUND` on Node 22.18 and looks like a broken repo when nothing is broken.
- **Baseline is 640 passing, 0 failing** across `core`, `spelling-game`, `math-game` and `typing-game`. Verified on this worktree before Task 1. If your task starts red, the cause is your task, not inherited.
- Thorough on logic; **no tests on DOM, CSS or rendering.**
- **Commit style:** imperative subject describing the change's intent, body explaining why. No "feat:" prefixes — the repo does not use them.

---

## File Structure

**Promoted into `core/` (Tasks 1–2):**
- `core/typing-cost.js` — moved verbatim from `spelling-game/js/`
- `core/frontier.js` — moved, with `space` becoming a parameter

**Committed source data (Task 3):**
- `geography-game/data/ne_110m_admin_0_countries.geojson` — 819 KB, public domain
- `geography-game/vendor/flag-icons/4x3/*.svg` + `LICENSE` — 271 files, MIT

**Build tooling (Tasks 4–5):**
- `tools/countries/names.js` — curation table, normalization, collision check
- `tools/countries/geometry.js` — projection, simplification, path emission
- `tools/build-countries.js` — the runnable entry point that wires those two

**The game (Tasks 6–9):**
- `geography-game/js/countries.js` — GENERATED, committed
- `geography-game/js/spine.js` — hand-authored opener + generated tail
- `geography-game/js/space.js` — the `ItemSpace` adapter
- `geography-game/js/viewbox.js` — `viewBoxFor`
- `geography-game/js/config.js`, `main.js`, `log.js`
- `geography-game/js/ui/map.js`, `ui/flag.js`, `ui/results.js`
- `geography-game/index.html`, `css/*.css`

Build tooling is split into `names` and `geometry` because they fail differently and are reviewed differently: names are a curriculum judgment, geometry is arithmetic.

---

## Task 1: Promote `typing-cost.js` into `core/`

Pure move. It already imports its tables from `typing-game/js/keymap.js` and takes its dial from config, so nothing about it is spelling-specific.

**Files:**
- Move: `spelling-game/js/typing-cost.js` → `core/typing-cost.js`
- Move: `spelling-game/tests/typing-cost.test.js` → `core/tests/typing-cost.test.js`
- Modify: any importer of the old path

**Interfaces:**
- Consumes: nothing
- Produces: `typingCost(word, keymap, config) -> number` in `[config.typingWeightFloor, 1]`; `KEYMAP` re-export

- [ ] **Step 1: Find every importer before moving anything**

```bash
grep -rn "typing-cost" --include='*.js' --include='*.html' . | grep -v '.claude/worktrees'
```

Write the list down. You will re-point every hit in Step 3.

- [ ] **Step 2: Move both files with git mv**

```bash
git mv spelling-game/js/typing-cost.js core/typing-cost.js
git mv spelling-game/tests/typing-cost.test.js core/tests/typing-cost.test.js
```

- [ ] **Step 3: Fix the relative import depths**

`core/typing-cost.js` is one directory shallower than it was, so its keymap import changes:

```js
// was: export * as KEYMAP from '../../typing-game/js/keymap.js';
export * as KEYMAP from '../typing-game/js/keymap.js';
```

In `core/tests/typing-cost.test.js` the module under test moves from `../js/typing-cost.js` to `../typing-cost.js`. Re-point every importer found in Step 1 to `core/typing-cost.js` at the correct relative depth.

- [ ] **Step 4: Run the moved suite and the spelling suite**

```bash
node --test core/tests/typing-cost.test.js
node --test 'spelling-game/tests/*.test.js'
```

Expected: both pass, zero failures. If spelling fails with `ERR_MODULE_NOT_FOUND`, a Step 1 hit was missed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Promote typingCost into core, for its third consumer

The geography game needs the same dial the spelling game does: country
names carry a typing burden -- Kyrgyzstan, Liechtenstein -- that is not
geography knowledge, and suppressing it is exactly what this module is
for. Three consumers is where a module stops belonging to one game.

Moves verbatim. It already imported its finger and row tables from the
typing game rather than copying them, and already took its one
pedagogical dial from config, so nothing here was spelling-shaped."
```

---

## Task 2: Promote `frontier.js` into `core/`, parameterizing `space`

The one behavioral change in either promotion.

**Files:**
- Move: `spelling-game/js/frontier.js` → `core/frontier.js`
- Move: `spelling-game/tests/frontier.test.js` → `core/tests/frontier.test.js`
- Modify: `spelling-game/js/main.js` (and any other caller)

**Interfaces:**
- Consumes: `ItemSpace` from `core/space.js`
- Produces: `activeWindow(spine, model, size, space) -> string[]` — ids in spine order

- [ ] **Step 1: Write the failing test**

Add to `core/tests/frontier.test.js`. This test pins the *new* contract: the window works for a space that is not the spelling one.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { activeWindow } from '../frontier.js';

// A minimal space standing in for any game's adapter. The point of the test is
// that frontier.js never reaches for a specific game's id encoding.
const fakeSpace = {
  itemId: (item) => `x:${item.name}`,
};

const spine = [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }];

test('the window is a filter over the spine, not a slice of it', () => {
  const model = { byId: new Map([['x:b', { bucket: 'hot' }]]) };
  assert.deepEqual(activeWindow(spine, model, 2, fakeSpace), ['x:a', 'x:c']);
});

test('an item missing from the model is treated as not hot', () => {
  const model = { byId: new Map() };
  assert.deepEqual(activeWindow(spine, model, 2, fakeSpace), ['x:a', 'x:b']);
});

test('a size of zero yields an empty window rather than throwing', () => {
  const model = { byId: new Map() };
  assert.deepEqual(activeWindow(spine, model, 0, fakeSpace), []);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node --test core/tests/frontier.test.js
```

Expected: FAIL — `Cannot find module '../frontier.js'`.

- [ ] **Step 3: Move the files**

```bash
git mv spelling-game/js/frontier.js core/frontier.js
git mv spelling-game/tests/frontier.test.js core/tests/frontier.test.js
```

Then paste the three tests from Step 1 into the moved test file, and re-point its existing imports from `../js/frontier.js` to `../frontier.js` and from `../js/space.js` to `../../spelling-game/js/space.js`.

- [ ] **Step 4: Make `space` a parameter**

In `core/frontier.js`, delete the import and take the space as the last argument:

```js
// DELETE: import { spellingSpace } from './space.js';

/**
 * The active window: the first `size` ids in spine order that are not hot.
 *
 * @param {object[]} spine in difficulty order
 * @param {MasteryModel} model from core/mastery.js
 * @param {number} size how many items the kid works on at once
 * @param {import('./space.js').ItemSpace} space
 * @returns {string[]} ids, in spine order
 */
export function activeWindow(spine, model, size, space) {
  const active = [];

  for (const entry of spine) {
    if (active.length >= size) {
      break;
    }
    const id = space.itemId(entry);
    const stats = model.byId.get(id);
    if (stats !== undefined && stats.bucket === HOT) {
      continue; // mastered — it has left the window, and the window fills from further down
    }
    active.push(id);
  }

  return active;
}
```

Update the module's header comment: the paragraph explaining why `spine` is a parameter now covers `space` too, since both exist so the rule can run against something other than the shipped list.

- [ ] **Step 5: Update every caller**

```bash
grep -rn "activeWindow" --include='*.js' . | grep -v '.claude/worktrees'
```

Each call gains a fourth argument. In `spelling-game/js/main.js` that is `spellingSpace`, which is already imported there.

- [ ] **Step 6: Run both suites**

```bash
node --test core/tests/frontier.test.js
node --test 'spelling-game/tests/*.test.js'
```

Expected: both pass. A spelling failure here means a caller in Step 5 was missed.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Promote the frontier into core, and let it take any item space

Third consumer, so it belongs to the core rather than to spelling. The
move needs one real change: it imported spellingSpace directly for id
encoding while already taking spine as a parameter, which its own header
argued against -- 'the id encoding is the adapter's, never restated
here'. So space becomes a parameter too, last, matching deriveMastery.

The guarantee it exists to protect is unchanged and matters more with
172 countries than with 1000 words: the window is a filter over the
spine, never a contiguous slice, so one country the kid cannot spell
cannot block the countries behind it."
```

---

## Task 3: Vendor the source data

No logic. Two downloads, committed, with their provenance recorded.

**Files:**
- Create: `geography-game/data/ne_110m_admin_0_countries.geojson`
- Create: `geography-game/data/README.md`
- Create: `geography-game/vendor/flag-icons/4x3/*.svg`, `geography-game/vendor/flag-icons/LICENSE`

**Interfaces:**
- Produces: the two files Tasks 4, 5 and 9 read

- [ ] **Step 1: Fetch the Natural Earth GeoJSON**

```bash
mkdir -p geography-game/data
curl -sL -o geography-game/data/ne_110m_admin_0_countries.geojson \
  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson
```

- [ ] **Step 2: Verify it before trusting it**

```bash
node -e "
const g = JSON.parse(require('fs').readFileSync('geography-game/data/ne_110m_admin_0_countries.geojson','utf8'));
console.log('features:', g.features.length);
const bz = g.features.find(f => f.properties.NAME_EN === 'Belize');
console.log('Belize:', bz.properties.ISO_A2_EH, bz.geometry.type);
"
```

Expected exactly: `features: 177` and `Belize: BZ Polygon`. Anything else means upstream moved and the rest of this plan's numbers no longer hold — stop and report.

- [ ] **Step 3: Vendor the flags**

```bash
mkdir -p geography-game/vendor
git clone --depth 1 https://github.com/lipis/flag-icons.git /tmp/flag-icons
mkdir -p geography-game/vendor/flag-icons
cp -R /tmp/flag-icons/flags/4x3 geography-game/vendor/flag-icons/4x3
cp /tmp/flag-icons/LICENSE geography-game/vendor/flag-icons/LICENSE
rm -rf /tmp/flag-icons
ls geography-game/vendor/flag-icons/4x3/*.svg | wc -l
```

Expected: `271`. The `LICENSE` copy is not optional — it is the entire MIT obligation.

- [ ] **Step 4: Record provenance**

Create `geography-game/data/README.md`:

```markdown
# Committed source data

Both sources were license-checked before adoption. Neither is fetched at
play time: the game runs at anchor with no connectivity, which is the
whole reason these are committed rather than depended on.

## ne_110m_admin_0_countries.geojson

Natural Earth, **public domain**. Their terms: "All versions of Natural
Earth raster + vector map data found on this website are in the public
domain." No attribution is required — "Crediting the authors is
unnecessary."

From https://github.com/nvkelso/natural-earth-vector, path
`geojson/ne_110m_admin_0_countries.geojson`. 177 features.

Consumed by `tools/build-countries.js`, which emits
`geography-game/js/countries.js`. Nothing reads this file at play time.

## vendor/flag-icons/

https://github.com/lipis/flag-icons, **MIT**. 271 SVGs keyed by ISO
3166-1 alpha-2. `LICENSE` sits beside them and must stay there — keeping
that notice is the whole of what MIT asks.

Wikimedia Commons was rejected as a flag source. Most flag SVGs there are
public domain, but licensing is per-file and some renderings are CC-BY-SA
even where the flag design is not copyrightable. Auditing 200 files
individually is the kind of chore that gets half-done.
```

- [ ] **Step 5: Commit**

```bash
git add geography-game/data geography-game/vendor
git commit -m "Vendor the country shapes and flags, with their licences

Natural Earth is public domain and flag-icons is MIT, both checked
before adoption and recorded in data/README.md. Committed rather than
fetched because the game is played at anchor: a CDN link makes the flag
game blank water offline, and an npm dependency breaks the day
node_modules is not there.

All 271 flags, not the ~100 the spine will reach. A subset would have to
be regenerated every time the spine grew, and 2MB does not justify the
bookkeeping."
```

---

## Task 4: The name curation half of the build tool

Names are a curriculum judgment and fail differently from geometry, so they get their own module and their own review.

**Files:**
- Create: `tools/countries/names.js`
- Test: `tools/countries/tests/names.test.js`

**Interfaces:**
- Consumes: raw GeoJSON features from Task 3
- Produces: `normalize(name) -> string`; `curate(features) -> {code, name, target}[]`; `EXCLUDE`; `RENAME`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { normalize, curate } from '../names.js';

const FEATURES = JSON.parse(
  readFileSync(new URL('../../../geography-game/data/ne_110m_admin_0_countries.geojson', import.meta.url), 'utf8'),
).features;

test('normalize strips everything that is not a lowercase letter', () => {
  assert.equal(normalize('Costa Rica'), 'costarica');
  assert.equal(normalize('Guinea-Bissau'), 'guineabissau');
  assert.equal(normalize("People's Republic of China"), 'peoplesrepublicofchina');
});

test('curate drops non-countries and unrecognised states', () => {
  const names = new Set(curate(FEATURES).map((c) => c.name));
  for (const gone of ['Antarctica', 'French Southern and Antarctic Lands',
                      'Turkish Republic of Northern Cyprus', 'Somaliland', 'Western Sahara']) {
    assert.ok(!names.has(gone), `${gone} should not be in the spine pool`);
  }
});

test('curate shortens the names that are cruel to type', () => {
  const byCode = new Map(curate(FEATURES).map((c) => [c.code, c.name]));
  assert.equal(byCode.get('cn'), 'China');
  assert.equal(byCode.get('us'), 'United States');
  assert.equal(byCode.get('cd'), 'DR Congo');
  assert.equal(byCode.get('cg'), 'Congo');
});

test('every country resolves to a lowercase alpha-2 code', () => {
  for (const c of curate(FEATURES)) {
    assert.match(c.code, /^[a-z]{2}$/, `${c.name} has code ${c.code}`);
  }
});

test('Taiwan is aliased off Natural Earth cn-tw onto the flag set tw', () => {
  const codes = new Set(curate(FEATURES).map((c) => c.code));
  assert.ok(codes.has('tw'));
  assert.ok(!codes.has('cn-tw'));
});

test('no two countries collide on their typed target', () => {
  const seen = new Map();
  for (const c of curate(FEATURES)) {
    assert.ok(!seen.has(c.target), `${c.name} and ${seen.get(c.target)} both type as "${c.target}"`);
    seen.set(c.target, c.name);
  }
});

test('the pool is 172 countries', () => {
  assert.equal(curate(FEATURES).length, 172);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node --test tools/countries/tests/names.test.js
```

Expected: FAIL — `Cannot find module '../names.js'`.

- [ ] **Step 3: Write the implementation**

```js
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
```

- [ ] **Step 4: Run the tests**

```bash
node --test tools/countries/tests/names.test.js
```

Expected: PASS, 7 tests. If the count assertion fails, print `curate(FEATURES).length` and reconcile against `EXCLUDE` before changing the expected number — the 172 is measured, not guessed.

- [ ] **Step 5: Commit**

```bash
git add tools/countries/names.js tools/countries/tests/names.test.js
git commit -m "Curate the country names the kid actually types

Natural Earth's NAME field is built for map labels -- 'Dominican Rep.',
'Dem. Rep. Congo' -- so it is unusable as an answer key. NAME_EN is the
honest name and is already pure ASCII across all 177 units, so it is the
base, with five renames where the full name is cruel to type.

The collision check is asserted rather than assumed. It passes with zero
collisions across the 172, but it holds by luck of the naming rule and
not by construction, so a future rename that broke it should fail here
rather than in a kid's face."
```

---

## Task 5: The geometry half, and the generated `countries.js`

**Files:**
- Create: `tools/countries/geometry.js`
- Create: `tools/build-countries.js`
- Test: `tools/countries/tests/geometry.test.js`
- Generate: `geography-game/js/countries.js`

**Interfaces:**
- Consumes: `curate` from Task 4
- Produces: `project(lon, lat) -> [x, y]`; `simplify(points, tolerance) -> points`; `pathFor(geometry, tolerance) -> string`; `boxFor(geometry) -> [x, y, w, h]`; and the committed `COUNTRIES` array

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { project, simplify, pathFor, boxFor, WORLD } from '../geometry.js';

test('project maps the world corners onto the canvas', () => {
  assert.deepEqual(project(-180, 90), [0, 0]);
  assert.deepEqual(project(180, -90), [WORLD.width, WORLD.height]);
  assert.deepEqual(project(0, 0), [WORLD.width / 2, WORLD.height / 2]);
});

test('project is monotonic — east is right, north is up', () => {
  assert.ok(project(10, 0)[0] > project(-10, 0)[0]);
  assert.ok(project(0, 10)[1] < project(0, -10)[1]);
});

test('simplify keeps both endpoints', () => {
  const points = [[0, 0], [1, 0.01], [2, 0], [3, 0.01], [4, 0]];
  const out = simplify(points, 0.5);
  assert.deepEqual(out[0], [0, 0]);
  assert.deepEqual(out.at(-1), [4, 0]);
});

test('simplify drops points inside the tolerance and keeps points outside it', () => {
  const nearlyStraight = [[0, 0], [1, 0.01], [2, 0]];
  assert.equal(simplify(nearlyStraight, 0.5).length, 2);

  const realCorner = [[0, 0], [1, 5], [2, 0]];
  assert.equal(simplify(realCorner, 0.5).length, 3);
});

test('simplify never returns fewer than two points', () => {
  assert.equal(simplify([[0, 0], [1, 0]], 1000).length, 2);
});

test('pathFor emits one closed subpath per ring', () => {
  const square = {
    type: 'Polygon',
    coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
  };
  const d = pathFor(square, 0);
  assert.match(d, /^M/, 'starts with a moveto');
  assert.equal((d.match(/Z/g) ?? []).length, 1, 'one closepath per ring');
});

test('pathFor handles MultiPolygon as several subpaths', () => {
  const two = {
    type: 'MultiPolygon',
    coordinates: [
      [[[0, 0], [10, 0], [10, 10], [0, 0]]],
      [[[20, 20], [30, 20], [30, 30], [20, 20]]],
    ],
  };
  assert.equal((pathFor(two, 0).match(/Z/g) ?? []).length, 2);
});

test('boxFor bounds the projected geometry, in projected units', () => {
  const square = {
    type: 'Polygon',
    coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
  };
  const [x, y, w, h] = boxFor(square);
  const [x0, y0] = project(0, 10);
  const [x1, y1] = project(10, 0);
  assert.ok(Math.abs(x - x0) < 0.001);
  assert.ok(Math.abs(y - y0) < 0.001);
  assert.ok(Math.abs(w - (x1 - x0)) < 0.001);
  assert.ok(Math.abs(h - (y1 - y0)) < 0.001);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node --test tools/countries/tests/geometry.test.js
```

Expected: FAIL — `Cannot find module '../geometry.js'`.

- [ ] **Step 3: Write the geometry module**

```js
// Lat/lon into committed SVG path strings.
//
// The projection happens HERE, once, at build time. The browser receives
// coordinates that are already screen coordinates, which is why the game ships
// no projection library and has no runtime geometry to get wrong.
//
// EQUIRECTANGULAR, NOT MERCATOR. Mercator is what a slippy map uses and it
// inflates everything far from the equator -- Greenland the size of Africa. For
// a game whose whole subject is the size and position of countries that is not a
// cosmetic complaint, it is teaching the wrong thing. Equirectangular stretches
// east-west near the poles too, but it does it without lying about area rank.
//
// Pure module: no DOM, no network, no clock, no randomness.

/** The canvas every path is projected onto. 2:1 is equirectangular's natural ratio. */
export const WORLD = { width: 2000, height: 1000 };

/** Committed coordinates are rounded to this many decimals — see roundTo. */
const DECIMALS = 1;

export function project(lon, lat) {
  return [
    ((lon + 180) / 360) * WORLD.width,
    ((90 - lat) / 180) * WORLD.height,
  ];
}

function roundTo(value) {
  return Number(value.toFixed(DECIMALS));
}

/** Perpendicular distance from `point` to the segment `start`–`end`. */
function perpendicularDistance(point, start, end) {
  const [px, py] = point;
  const [sx, sy] = start;
  const [ex, ey] = end;
  const dx = ex - sx;
  const dy = ey - sy;

  if (dx === 0 && dy === 0) {
    return Math.hypot(px - sx, py - sy);
  }

  const numerator = Math.abs(dy * px - dx * py + ex * sy - ey * sx);
  return numerator / Math.hypot(dx, dy);
}

/**
 * Douglas–Peucker. Reduces committed file size, NOT visual resolution: 110m
 * Natural Earth is already coarse, and this is about how many points describe
 * that coarse outline.
 *
 * Never returns fewer than two points, so a ring can always still be drawn.
 */
export function simplify(points, tolerance) {
  if (points.length <= 2) {
    return points;
  }

  let worstIndex = 0;
  let worstDistance = 0;

  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = perpendicularDistance(points[i], points[0], points.at(-1));
    if (distance > worstDistance) {
      worstIndex = i;
      worstDistance = distance;
    }
  }

  if (worstDistance <= tolerance) {
    return [points[0], points.at(-1)];
  }

  const left = simplify(points.slice(0, worstIndex + 1), tolerance);
  const right = simplify(points.slice(worstIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

/** Every ring of a Polygon or MultiPolygon, as arrays of lon/lat pairs. */
function ringsOf(geometry) {
  if (geometry.type === 'Polygon') {
    return geometry.coordinates;
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.flat();
  }
  throw new Error(`unsupported geometry type: ${geometry.type}`);
}

export function pathFor(geometry, tolerance) {
  const subpaths = [];

  for (const ring of ringsOf(geometry)) {
    const projected = ring.map(([lon, lat]) => project(lon, lat));
    const reduced = simplify(projected, tolerance);
    const points = reduced.map(([x, y]) => `${roundTo(x)},${roundTo(y)}`);
    subpaths.push(`M${points[0]}L${points.slice(1).join('L')}Z`);
  }

  return subpaths.join('');
}

/** @returns {[number, number, number, number]} x, y, width, height in projected units */
export function boxFor(geometry) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const ring of ringsOf(geometry)) {
    for (const [lon, lat] of ring) {
      const [x, y] = project(lon, lat);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return [roundTo(minX), roundTo(minY), roundTo(maxX - minX), roundTo(maxY - minY)];
}
```

- [ ] **Step 4: Run the tests**

```bash
node --test tools/countries/tests/geometry.test.js
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Write the build entry point**

Create `tools/build-countries.js`:

```js
// Generates geography-game/js/countries.js from the committed Natural Earth
// GeoJSON. Run by a human, output committed. There is no build step at play
// time and there must never be one -- see tools/build-fry.js for the same
// bargain in the spelling game.
//
//   node tools/build-countries.js
//
// Emits a plain ES module the browser imports directly, so the only thing
// standing between the shapefile and the screen is this file and review.

import { readFileSync, writeFileSync } from 'node:fs';

import { curate } from './countries/names.js';
import { pathFor, boxFor, WORLD } from './countries/geometry.js';

const SOURCE = new URL('../geography-game/data/ne_110m_admin_0_countries.geojson', import.meta.url);
const OUTPUT = new URL('../geography-game/js/countries.js', import.meta.url);

/**
 * In projected units, where the world is 2000 wide. Chosen by eye against the
 * smallest countries in the spine opener: large enough to cut the point count
 * hard, small enough that Belize still reads as Belize.
 */
const TOLERANCE = 0.35;

function build() {
  const geojson = JSON.parse(readFileSync(SOURCE, 'utf8'));
  const curated = curate(geojson.features);
  const byName = new Map(geojson.features.map((f) => [f.properties.NAME_EN ?? f.properties.NAME, f]));

  const rows = curated.map(({ code, name, target }) => {
    const feature = byName.get(name) ?? findByCurated(geojson.features, code);
    return {
      code,
      name,
      target,
      path: pathFor(feature.geometry, TOLERANCE),
      box: boxFor(feature.geometry),
    };
  });

  const body = rows
    .map((r) => `  { code: '${r.code}', name: ${JSON.stringify(r.name)}, target: '${r.target}', box: [${r.box.join(', ')}], path: '${r.path}' },`)
    .join('\n');

  writeFileSync(OUTPUT, `${header()}\nexport const COUNTRIES = [\n${body}\n];\n`);
  report(rows);
}

/** A renamed country no longer matches its NAME_EN key, so fall back to the code. */
function findByCurated(features, code) {
  return features.find((f) => {
    const primary = f.properties.ISO_A2;
    const raw = primary && primary !== '-99' ? primary : f.properties.ISO_A2_EH;
    return (raw ?? '').toLowerCase().replace('cn-tw', 'tw') === code;
  });
}

function header() {
  return `// GENERATED by tools/build-countries.js -- do not edit by hand.
//
// Source: geography-game/data/ne_110m_admin_0_countries.geojson (public domain).
// Coordinates are ALREADY PROJECTED onto a ${WORLD.width}x${WORLD.height} canvas;
// the browser does no projection. \`box\` is [x, y, width, height] in those same
// units and is what viewbox.js zooms to.
`;
}

function report(rows) {
  const bytes = rows.reduce((sum, r) => sum + r.path.length, 0);
  console.log(`countries: ${rows.length}`);
  console.log(`path bytes: ${Math.round(bytes / 1024)}K`);
  const worst = [...rows].sort((a, b) => b.path.length - a.path.length).slice(0, 3);
  console.log('largest:', worst.map((r) => `${r.name} ${Math.round(r.path.length / 1024)}K`).join(', '));
}

build();
```

- [ ] **Step 6: Run the build and check its output**

```bash
node tools/build-countries.js
node -e "
import('./geography-game/js/countries.js').then(({COUNTRIES}) => {
  console.log('countries:', COUNTRIES.length);
  const bz = COUNTRIES.find(c => c.code === 'bz');
  console.log('Belize:', JSON.stringify({name: bz.name, target: bz.target, box: bz.box}));
  console.log('paths non-empty:', COUNTRIES.every(c => c.path.startsWith('M')));
  console.log('boxes positive:', COUNTRIES.every(c => c.box[2] > 0 && c.box[3] > 0));
});
"
```

Expected: 172 countries, Belize present with `target: 'belize'` and a positive box, all paths starting with `M`, all boxes positive. If any box has zero width, the geometry for that country collapsed under `TOLERANCE` — lower it and re-run.

- [ ] **Step 7: Commit**

```bash
git add tools/countries/ tools/build-countries.js geography-game/js/countries.js
git commit -m "Project the country shapes into committed SVG paths

Projection happens once, at build time, so the browser receives screen
coordinates and the game ships no projection library and no runtime
geometry. Output is committed, matching the bargain build-fry.js already
makes: a human runs the tool, review sees the result, and play time has
no build step.

Equirectangular rather than Mercator. Mercator is what slippy maps use
and it inflates everything far from the equator -- Greenland the size of
Africa -- which in a game about the size and position of countries is
teaching the wrong thing, not a cosmetic complaint."
```

---

## Task 6: The spine

**Files:**
- Create: `geography-game/js/spine.js`
- Test: `geography-game/tests/spine.test.js`

**Interfaces:**
- Consumes: `COUNTRIES` from Task 5
- Produces: `SPINE` — `{code, name, target, path, box, kind}[]`, two entries per country

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SPINE, OPENER } from '../js/spine.js';
import { COUNTRIES } from '../js/countries.js';

test('the spine opens on the water the family sails', () => {
  const firstCodes = SPINE.slice(0, OPENER.length * 2).map((e) => e.code);
  for (const code of OPENER) {
    assert.ok(firstCodes.includes(code), `${code} should be in the opener`);
  }
});

test('every country contributes exactly one shape item and one flag item', () => {
  assert.equal(SPINE.length, COUNTRIES.length * 2);
  const shapes = SPINE.filter((e) => e.kind === 'shape');
  const flags = SPINE.filter((e) => e.kind === 'flag');
  assert.equal(shapes.length, COUNTRIES.length);
  assert.equal(flags.length, COUNTRIES.length);
});

test('the opener names only countries that exist', () => {
  const codes = new Set(COUNTRIES.map((c) => c.code));
  for (const code of OPENER) {
    assert.ok(codes.has(code), `opener names ${code}, which is not in COUNTRIES`);
  }
});

test('the tail is ordered by descending familiarity', () => {
  const tail = SPINE.filter((e) => !OPENER.includes(e.code) && e.kind === 'shape');
  for (let i = 1; i < tail.length; i += 1) {
    assert.ok(tail[i - 1].rank <= tail[i].rank, `${tail[i - 1].name} should not follow ${tail[i].name}`);
  }
});

test('every entry carries the geometry the map prompt needs', () => {
  for (const entry of SPINE) {
    assert.ok(entry.path.startsWith('M'), `${entry.name} has no path`);
    assert.equal(entry.box.length, 4);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node --test geography-game/tests/spine.test.js
```

Expected: FAIL — `Cannot find module '../js/spine.js'`.

- [ ] **Step 3: Write the spine**

```js
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
```

- [ ] **Step 4: Make the tool emit familiarity order**

The tail test requires `COUNTRIES` to already be sorted. In `tools/build-countries.js`, sort before emitting — Natural Earth carries `POP_EST`, which is the closest derivable proxy for "likely to have heard of it":

```js
// in build(), after `const curated = curate(geojson.features);`
const popOf = new Map(
  geojson.features.map((f) => [
    (f.properties.ISO_A2 && f.properties.ISO_A2 !== '-99' ? f.properties.ISO_A2 : f.properties.ISO_A2_EH ?? '')
      .toLowerCase().replace('cn-tw', 'tw'),
    f.properties.POP_EST ?? 0,
  ]),
);
curated.sort((a, b) => (popOf.get(b.code) ?? 0) - (popOf.get(a.code) ?? 0));
```

Add a comment saying population is a proxy for familiarity and not a claim about importance, and that the opener overrides it entirely.

- [ ] **Step 5: Regenerate and run the tests**

```bash
node tools/build-countries.js
node --test geography-game/tests/spine.test.js
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add geography-game/js/spine.js geography-game/tests/spine.test.js \
        geography-game/js/countries.js tools/build-countries.js
git commit -m "Open the spine on the water we are actually sailing

Two sections on different principles, the same shape the spelling spine
has and for the same reason: no derivable ordering makes a good first
lesson. Population ranking would open on China and India; this opens on
Belize and Guatemala, because those are the countries the kids will step
ashore into and that is not a tie a frequency list can break.

The tail is population-ordered as a proxy for familiarity, generated in
the tool rather than authored here, so a retune regenerates one file and
no consumer notices."
```

---

## Task 7: The item space

**Files:**
- Create: `geography-game/js/space.js`
- Test: `geography-game/tests/space.test.js`

**Interfaces:**
- Consumes: `SPINE` from Task 6, `validateSpace` from `core/space.js`
- Produces: `geographySpace` satisfying the `ItemSpace` contract

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateSpace } from '../../core/space.js';
import { geographySpace } from '../js/space.js';
import { SPINE } from '../js/spine.js';

test('the geography adapter satisfies the core contract', () => {
  assert.deepEqual(validateSpace(geographySpace), []);
});

test('allItems is the spine, and ids are total over it', () => {
  const items = geographySpace.allItems();
  assert.equal(items.length, SPINE.length);
  const ids = new Set(items.map((item) => geographySpace.itemId(item)));
  assert.equal(ids.size, SPINE.length, 'every item has a distinct id');
});

test('ids name both the kind and the country', () => {
  assert.equal(geographySpace.itemId({ code: 'bz', kind: 'shape' }), 'geo:shape:bz');
  assert.equal(geographySpace.itemId({ code: 'bz', kind: 'flag' }), 'geo:flag:bz');
});

test('shape and flag name each other, and nothing else', () => {
  assert.deepEqual(geographySpace.relatedIds('geo:shape:bz'), ['geo:flag:bz']);
  assert.deepEqual(geographySpace.relatedIds('geo:flag:bz'), ['geo:shape:bz']);
});

test('relatedIds returns empty for an id it does not recognise', () => {
  for (const junk of ['w:friend', 'geo:bz', '', 'geo:shape:', 'nope']) {
    assert.deepEqual(geographySpace.relatedIds(junk), [], junk);
  }
});

test('idFromEvent reads back what eventFields writes', () => {
  for (const item of [{ code: 'bz', kind: 'shape' }, { code: 'fr', kind: 'flag' }]) {
    const fields = geographySpace.eventFields(item);
    assert.equal(geographySpace.idFromEvent(fields), `geo:${item.kind}:${item.code}`);
  }
});

test('idFromEvent returns null rather than throwing on junk', () => {
  for (const junk of [null, undefined, {}, { code: 42 }, { code: 'bz' }, { kind: 'shape' }, 'nope', { word: 'cat' }]) {
    assert.equal(geographySpace.idFromEvent(junk), null, JSON.stringify(junk));
  }
});

test('the typed target is letters only', () => {
  assert.equal(geographySpace.targetOf({ target: 'costarica' }), 'costarica');
  for (const item of geographySpace.allItems()) {
    assert.match(geographySpace.targetOf(item), /^[a-z]+$/, item.name);
  }
});

test('only letters are typable — space does not advance a slot', () => {
  assert.ok(geographySpace.isTypableChar('a'));
  for (const char of [' ', '-', "'", '1', 'A', '.']) {
    assert.ok(!geographySpace.isTypableChar(char), char);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node --test geography-game/tests/space.test.js
```

Expected: FAIL — `Cannot find module '../js/space.js'`.

- [ ] **Step 3: Write the adapter**

```js
// The geography game's item-space adapter — see core/space.js for the contract.
//
// An item is a spine entry: a country plus which prompt it is asked through.
// Its id is `geo:${kind}:${code}` -- `geo:shape:bz`, `geo:flag:bz`. The prefix
// is not decoration: ids are written into a log that outlives any one version
// of this game, and `bz` alone could not later be told apart from some other
// kind of item added to the same space.
//
// THE TARGET IS LETTERS ONLY. `Costa Rica` is typed as `costarica`; the space is
// rendered as a visual gap and the engine never sees it. That preserves the
// invariant the spelling spine already states for its own items -- lowercase
// a-z, no spaces, no punctuation -- and preserving it is precisely why
// core/engine.js needs no changes for this game.
//
// This file holds no game logic. Everything it exposes is a restatement of what
// a country IS, in the vocabulary the shared core reads.
//
// Pure module: no DOM, no network, no clock, no randomness.

import { SPINE } from './spine.js';

const ID_PREFIX = 'geo:';
const LETTER_PATTERN = /^[a-z]$/;
const ID_PATTERN = /^geo:(shape|flag):([a-z]{2})$/;

const SIBLING = { shape: 'flag', flag: 'shape' };

/** @type {import('../../core/space.js').ItemSpace} */
export const geographySpace = {
  allItems() {
    return SPINE;
  },

  itemId(item) {
    return `${ID_PREFIX}${item.kind}:${item.code}`;
  },

  /**
   * An attempt event names an item through `code` and `kind`. Anything else --
   * a corrupt line, an event from another game's log, a missing field -- is not
   * an item in this space and reads as null.
   *
   * This does NOT check spine membership. A well-formed event naming a country
   * that has since left the spine gets an id, and the caller's `known` set
   * rejects it. Those are different failures and the caller distinguishes them.
   */
  idFromEvent(event) {
    if (event === null || typeof event !== 'object') {
      return null;
    }
    const { code, kind } = event;
    if (typeof code !== 'string' || !/^[a-z]{2}$/.test(code)) {
      return null;
    }
    if (kind !== 'shape' && kind !== 'flag') {
      return null;
    }
    return `${ID_PREFIX}${kind}:${code}`;
  },

  /**
   * The two prompts for one country. This IS math's transpose guard, arriving
   * for the same reason: asking for Belize's flag immediately after its shape is
   * answered out of working memory, not out of long-term retrieval, and logs a
   * fast latency that means nothing.
   *
   * They are separate items precisely so they can be scheduled independently,
   * which is exactly what makes this adjacency guard necessary rather than
   * optional.
   */
  relatedIds(id) {
    const match = ID_PATTERN.exec(id ?? '');
    if (match === null) {
      return [];
    }
    const [, kind, code] = match;
    return [`${ID_PREFIX}${SIBLING[kind]}:${code}`];
  },

  /** Letters only — see the header. */
  targetOf(item) {
    return item.target;
  },

  isTypableChar(char) {
    return LETTER_PATTERN.test(char);
  },

  /**
   * A wrong entry is the string that was typed. No coercion: for math this is
   * where "48" becomes 48 so the interference guard can compare it against a
   * product, but a wrong country IS a string, and `guinea` typed for Equatorial
   * Guinea is the whole signal -- it equals another item's correct answer, which
   * is exactly what trips the guard.
   */
  coerceWrong(typed) {
    return typed;
  },

  isValidWrong(value) {
    return typeof value === 'string' && value !== '';
  },

  answerValue(item) {
    return item.target;
  },

  eventFields(item) {
    return { code: item.code, kind: item.kind };
  },
};
```

- [ ] **Step 4: Run the tests**

```bash
node --test geography-game/tests/space.test.js
```

Expected: PASS, 9 tests. `validateSpace` returning a non-empty array names the missing member.

- [ ] **Step 5: Commit**

```bash
git add geography-game/js/space.js geography-game/tests/space.test.js
git commit -m "Add the geography adapter, with shape and flag as sibling items

Pinned to the same validateSpace the math and spelling adapters run, so
a third game cannot drift into a third reading of the seam.

relatedIds makes shape and flag name each other, which is math's
transpose guard arriving for the same reason: asking Belize's flag right
after its shape is answered from working memory and logs a fast latency
that means nothing.

Targets are letters only -- Costa Rica types as costarica, the space is
a visual gap the engine never sees. That is what preserves the spelling
spine's a-z invariant, and preserving it is why core/engine.js needs no
change for a game that looks nothing like spelling."
```

---

## Task 8: `viewBoxFor`

The only genuinely new logic in the game.

**Files:**
- Create: `geography-game/js/viewbox.js`
- Create: `geography-game/js/config.js`
- Test: `geography-game/tests/viewbox.test.js`

**Interfaces:**
- Consumes: `box` from Task 5, `CONFIG` from this task
- Produces: `viewBoxFor(box, config) -> {x, y, width, height}`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { viewBoxFor } from '../js/viewbox.js';
import { CONFIG } from '../js/config.js';
import { COUNTRIES } from '../js/countries.js';

const boxOf = (code) => COUNTRIES.find((c) => c.code === code).box;

test('the country stays centred in the view', () => {
  const box = [100, 100, 20, 10];
  const view = viewBoxFor(box, CONFIG);
  assert.ok(Math.abs((view.x + view.width / 2) - 110) < 0.001);
  assert.ok(Math.abs((view.y + view.height / 2) - 105) < 0.001);
});

test('a tiny country gets the minimum context, not a full-screen dot', () => {
  const view = viewBoxFor([100, 100, 0.5, 0.5], CONFIG);
  assert.equal(view.width, CONFIG.minContextSpan);
});

test('a vast country is capped rather than showing the whole world', () => {
  const view = viewBoxFor([0, 0, 1800, 900], CONFIG);
  assert.equal(view.width, CONFIG.maxContextSpan);
});

test('the view is square, so the map does not distort between countries', () => {
  for (const code of ['bz', 'ru', 'cl', 'nl']) {
    const view = viewBoxFor(boxOf(code), CONFIG);
    assert.equal(view.width, view.height, code);
  }
});

test('the view always contains the country it is showing', () => {
  for (const country of COUNTRIES) {
    const [x, y, w, h] = country.box;
    const view = viewBoxFor(country.box, CONFIG);
    // Capped giants are the deliberate exception — Russia cannot fit and be legible.
    if (view.width === CONFIG.maxContextSpan) continue;
    assert.ok(view.x <= x && view.y <= y, country.name);
    assert.ok(view.x + view.width >= x + w, country.name);
    assert.ok(view.y + view.height >= y + h, country.name);
  }
});

test('Belize gets regional context rather than filling the frame', () => {
  const box = boxOf('bz');
  const view = viewBoxFor(box, CONFIG);
  assert.ok(view.width > Math.max(box[2], box[3]) * 2, 'should show neighbours');
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node --test geography-game/tests/viewbox.test.js
```

Expected: FAIL — `Cannot find module '../js/viewbox.js'`.

- [ ] **Step 3: Write config**

Create `geography-game/js/config.js`. Follow `spelling-game/js/config.js`'s layout — grouped with a comment saying which values are core tunables and which are game-only.

```js
// The geography game's tunables. Everything about the KID lives here; nothing
// about the keyboard does (see core/typing-cost.js for why that split exists).

export const CONFIG = {
  // --- read by the shared core ---
  // Verified against core/mastery.js and core/scheduler.js: these are the exact
  // keys those modules read. Do not rename one without grepping the other.
  weights: { cold: 6, warm: 3, hot: 1 },
  noRepeatWithin: 4,
  governorWindow: 10,
  governorFloor: 0.6,
  retain: 5,
  maxPlausibleMs: 60000,

  // Spelling's 4000, not math's 1500, and for spelling's exact reason: a
  // multiplication answer is one or two keystrokes, and a country name is seven
  // on the median. Sharing math's threshold would report a fluent kid as
  // permanently warm and stop the frontier ever advancing.
  //
  // A GUESS, expected to be wrong, and one line to retune against real history.
  hotMs: 4000,

  // --- game only ---
  sessionLength: 20,
  windowSize: 12,
  typingWeightFloor: 0.25,

  // The map prompt's context, in projected units where the world is 2000 wide.
  //
  // contextFactor is the multiple of the country's larger dimension the view
  // shows. 4 is enough to put Belize among its neighbours, which is the entire
  // pedagogical content of the prompt: Central America with one country lit is
  // an answerable question, and Belize alone on white is not.
  //
  // The floor stops a tiny island filling the frame; the ceiling stops Russia
  // dragging the view out to the whole world. Both are judgement calls that only
  // real play can settle -- see the spec's open questions.
  contextFactor: 4,
  minContextSpan: 120,
  maxContextSpan: 900,
};
```

- [ ] **Step 4: Write the implementation**

```js
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
```

- [ ] **Step 5: Run the tests**

```bash
node --test geography-game/tests/viewbox.test.js
```

Expected: PASS, 6 tests. If "the view always contains the country" fails for a country that is not capped, `contextFactor` is below 1 — it must be ≥ 1 for containment to hold at all.

- [ ] **Step 6: Commit**

```bash
git add geography-game/js/viewbox.js geography-game/js/config.js geography-game/tests/viewbox.test.js
git commit -m "Frame the map prompt so the question is answerable

The only new logic in this game, and the whole pedagogical content of
the map prompt: a shape alone on white tells a kid nothing, and the
whole world with one country lit is a needle in a haystack. Central
America with Belize lit is the question.

The view is square on purpose. Matching each country's aspect ratio
would rescale the frame between problems, and a kid would learn 'long
thin country' as a property of the frame rather than of Chile.

The floor, ceiling and factor are judgement calls that only real play
can settle. They are in CONFIG, which is where the retune goes."
```

---

## Task 9: Wire the game

**Files:**
- Create: `geography-game/index.html`, `js/main.js`, `js/log.js`
- Create: `geography-game/js/ui/map.js`, `js/ui/flag.js`, `js/ui/results.js`
- Create: `geography-game/css/base.css`, `css/layout.css`, `css/prompt.css`, `css/results.css`
- Modify: `games-menu.html`

**Interfaces:**
- Consumes: everything from Tasks 1–8
- Produces: a playable game at `/geography-game/index.html`

- [ ] **Step 1: Read the two games this one is modelled on**

```bash
sed -n '1,120p' spelling-game/js/main.js
sed -n '1,80p' spelling-game/js/ui/word.js
cat spelling-game/index.html
```

`main.js` here is the same shape: derive mastery from the log, take the active window, pick the next item, run the engine, render, record. Do not invent a new structure.

- [ ] **Step 2: Write the two prompt renderers**

`js/ui/map.js` renders one inline `<svg>`. Its `viewBox` comes from `viewBoxFor`; every country in `COUNTRIES` renders as a `<path>` with class `country`, and the target additionally gets `country--target`. Neighbours are muted and the target is highlighted **in CSS, not in JS** — the module sets classes and nothing else.

```js
import { COUNTRIES } from '../countries.js';
import { viewBoxFor } from '../viewbox.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Every country is drawn, not just the target. The neighbours ARE the question:
 * a shape alone on white is unanswerable, and which countries surround it is
 * exactly the information a kid reasons from.
 */
export function renderMap(host, country, config) {
  const view = viewBoxFor(country.box, config);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.width} ${view.height}`);
  svg.setAttribute('class', 'map');

  for (const other of COUNTRIES) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', other.path);
    path.setAttribute('class', other.code === country.code ? 'country country--target' : 'country');
    svg.append(path);
  }

  host.replaceChildren(svg);
}
```

`js/ui/flag.js` renders one `<img>` pointing at the vendored SVG:

```js
/**
 * The vendored path, not a CDN. The game is played at anchor -- see
 * geography-game/data/README.md.
 */
export function renderFlag(host, country) {
  const img = document.createElement('img');
  img.src = `vendor/flag-icons/4x3/${country.code}.svg`;
  img.alt = '';           // the country name IS the answer; naming it here gives it away
  img.className = 'flag';
  host.replaceChildren(img);
}
```

- [ ] **Step 3: Write `main.js`**

Mirror `spelling-game/js/main.js`. The geography-specific parts:

```js
import { pickNext } from '../../core/scheduler.js';
import { deriveMastery } from '../../core/mastery.js';
import { activeWindow } from '../../core/frontier.js';
import { typingCost, KEYMAP } from '../../core/typing-cost.js';
import { createEngine } from '../../core/engine.js';

import { geographySpace } from './space.js';
import { SPINE } from './spine.js';
import { CONFIG } from './config.js';
import { renderMap } from './ui/map.js';
import { renderFlag } from './ui/flag.js';

const engine = createEngine(geographySpace);
const byId = new Map(SPINE.map((entry) => [geographySpace.itemId(entry), entry]));

// The second dial. A country's typed name carries a keyboard burden that is not
// geography knowledge -- Kyrgyzstan, Liechtenstein -- so an awkward name is
// served less often and never excluded. Flag items pay the same cost as their
// shape sibling, because the answer they ask for is the same word.
const itemWeight = (id) => typingCost(byId.get(id).target, KEYMAP, CONFIG);

function nextItem(model, history) {
  const candidates = activeWindow(SPINE, model, CONFIG.windowSize, geographySpace);
  return pickNext({ model, history, config: CONFIG, rng: Math.random, space: geographySpace, candidates, itemWeight });
}

function renderPrompt(host, item) {
  if (item.kind === 'shape') {
    renderMap(host, item, CONFIG);
  } else {
    renderFlag(host, item);
  }
}
```

`js/log.js` mirrors `spelling-game/js/log.js`, calling `createLogClient({ game: 'geography', outboxKey: 'geography-outbox', defaultTail: 500 })`. Check the spelling version for the exact argument values it passes.

- [ ] **Step 4: Write `index.html` and the CSS**

Model `index.html` on `spelling-game/index.html`. The slots markup is the same; only the prompt area differs. In CSS, render spaces in a multi-word name as a visible gap between slot groups — the kid must see `Costa Rica` as two words even though the engine sees `costarica`.

Minimum styling needed for the map to work:

```css
.country { fill: var(--land); stroke: var(--coast); stroke-width: 0.5; }
.country--target { fill: var(--target); }
.map { width: 100%; height: auto; }
.flag { width: min(60vw, 420px); height: auto; }
```

- [ ] **Step 5: Add the menu card**

In `games-menu.html`, copy an existing card and point it at `geography-game/index.html`. Match the surrounding copy's register. Per the math game's next-steps note about menu copy telling a kid what to think, do not call the countries hard or easy.

- [ ] **Step 6: Run every test in the repo**

```bash
node --test 'core/tests/*.test.js' 'geography-game/tests/*.test.js' 'spelling-game/tests/*.test.js' 'math-game/tests/*.test.js' 'typing-game/tests/*.test.js' 'tools/countries/tests/*.test.js'
```

Expected: all pass. This is the first point where the two promotions, the build tool and the game are all in play together.

- [ ] **Step 7: Play it**

```bash
./play.command
```

Open the geography card. Confirm by eye:
- A map prompt shows the target country highlighted **among visible neighbours**, not alone.
- A flag prompt shows a flag.
- Typing the country name resolves the problem; a wrong full-length answer pulses and advances the hint ladder.
- A multi-word name shows a visible gap and the space bar does nothing.
- **Stop the server, turn off wifi, restart it.** Both prompts must still render. If a flag 404s, the vendored path in `ui/flag.js` is wrong.

- [ ] **Step 8: Commit**

```bash
git add geography-game games-menu.html
git commit -m "Wire the geography game: two prompts, one typed answer

Both prompts feed the same engine, which is what the typed answer bought
-- core/engine.js, mastery.js and scheduler.js are untouched by this
game existing.

The map prompt draws every country, not just the target. The neighbours
ARE the question: which countries surround it is exactly the information
a kid reasons from, and the target alone on white is unanswerable.

typingCost rides on pickNext's existing itemWeight hook, so the second
dial needed no scheduler change either. Flag items pay their sibling's
cost, since the word they ask for is the same word."
```

---

## Self-Review

**Spec coverage.** Every section maps to a task: §1 branch → Global Constraints; §2 no map library → Task 5's projection comment; §3 promotions → Tasks 1–2; §4 build tool → Tasks 4–5; §5 vendoring → Task 3; §6 item space → Task 7; §7 spine → Task 6; §8 map prompt → Task 8; §10 testing → each task's test step. §9 (deferred drag-and-drop) is correctly absent.

**Two spec inaccuracies found while writing this plan, both corrected here:**

1. The spec lists `Dominican Rep.` → `Dominican Republic` as a rename. Unnecessary — `NAME_EN` already says "Dominican Republic". The spec's underlying point (do not harvest from `NAME`) stands, and Task 4 uses `NAME_EN` as the base.
2. The spec says Western Sahara is excluded as a non-country but does not name it in the same list as the others. Task 4's `EXCLUDE` names all five explicitly.

**Type consistency:** `activeWindow(spine, model, size, space)` is defined in Task 2 and called with four arguments in Task 9. `viewBoxFor(box, config)` returns an object with `{x, y, width, height}` in Task 8 and is destructured that way in Task 9's `ui/map.js`. `curate` returns `{code, name, target}` in Task 4 and Task 5 adds `path` and `box` to those same rows; Task 6 spreads them and adds `kind` and `rank`; Task 7's adapter reads only `code`, `kind` and `target`. Consistent throughout.

**One error found and fixed during review:** Task 8's `CONFIG` originally carried `hotCleanCount` and `warmCleanCount`, which no core module reads. `core/mastery.js` actually reads `hotMs`, `maxPlausibleMs` and `retain`. Corrected, with `hotMs` set to spelling's 4000 rather than math's 1500 for spelling's own stated reason — the median country name is 7 letters, the same keystroke burden as a spelling word.

---

## Execution Handoff

Plan complete and saved to `geography-game/docs/superpowers/plans/2026-08-02-geography-name-and-flag-games.md`.
