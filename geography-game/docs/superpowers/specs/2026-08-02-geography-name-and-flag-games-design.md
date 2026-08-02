# Geography game — design

Two prompts, one game: a country highlighted on a map, or a country's flag, and
the kid types the country's name.

This is the fourth game in the repo and the first that ships **committed binary
assets** and a **generated geometry file**. Most of what follows is about where
that data comes from and what it is allowed to cost, because the game logic
itself is almost entirely `core/` reused unchanged.

Written 2026-08-02. Branches from `spelling-game`, not `master` — see §1.

---

## Context

The repo has three games sharing a `core/`: math facts, spelling, and typing.
The shared modules — `engine`, `mastery`, `scheduler`, `log`, `space` — know
nothing about their content. Everything content-specific arrives through the
`ItemSpace` adapter documented in `core/space.js`.

That adapter is **typing-shaped**: `isTypableChar`, `coerceWrong(typed)`, and
`targetOf(item)` returning a string the engine matches keystrokes against. There
is no submit key; a problem resolves when typed length reaches target length.

This design takes that constraint as a feature rather than fighting it. A
geography game answered by **typing the country name** reuses `core/engine.js`
with **zero changes**. The alternatives considered — multiple choice, drag and
drop — both require the core to grow a second answer modality, and that work is
deferred to a later game (§9).

### Provenance of the data

Two external sources, both verified before this spec was written.

**Shapes — Natural Earth, public domain.** Their terms: *"All versions of Natural
Earth raster + vector map data found on this website are in the public domain,"*
and *"No permission is needed to use Natural Earth. Crediting the authors is
unnecessary."* No attribution obligation exists. `admin_0_countries` at 110m
resolution holds 177 units.

**Flags — lipis/flag-icons, MIT.** 271 SVGs keyed by ISO 3166-1 alpha-2, in
`4x3` and `1x1` aspect ratios. Median file is 804 bytes; the full 4x3 set is
~2 MB, dominated by a handful with detailed coats of arms (largest 181 KB).

Wikimedia Commons was rejected as a flag source. Most flag SVGs there are public
domain, but the license is **per-file** — some renderings are CC-BY-SA even where
the flag design itself is not copyrightable. Auditing 200 files individually is
the kind of chore that gets half-done, and one licensing mistake in a public
repo is worse than 2 MB of git history.

### The join between them

Shapes and flags join on ISO alpha-2. Natural Earth's `ISO_A2` field is `-99`
for five units; falling back to `ISO_A2_EH` rescues three of them (France,
Norway, Kosovo) and leaves 175 with a usable code.

Measured against the flag set, **exactly one mismatch exists**: Natural Earth
codes Taiwan `cn-tw` where flag-icons uses `tw`. That is one alias, not a data
problem. The two units with no code under either field — N. Cyprus and
Somaliland — are unrecognized states excluded from the curriculum anyway.

This join was run before the spec was written rather than discovered during
implementation, because a broken key between the two data sources would have
invalidated the whole approach.

---

## Goals

- A kid can name a country from its shape in context, and from its flag.
- The curriculum opens on the water the family is actually sailing.
- The game works **fully offline**, at anchor, with no network of any kind.
- `core/` grows no new concepts — only two promotions of existing modules.
- The shape pipeline is built once and serves the later drag-and-drop game too.

## Non-goals

- **Capitals, populations, flags-to-flag matching, or continents as items.** One
  axis at a time. The spine is countries.
- **A map library.** No Leaflet, no tiles, no runtime projection. See §2.
- **Drag and drop.** Deferred to its own spec (§9).
- **Pan and zoom the kid controls.** The viewBox is derived, not driven (§6).
- **Every country on earth.** The spine reaches as far as the kid reaches; there
  is no completion state and no country count to hit.

---

## 1. Branch dependency

None, as of 2026-08-02.

This game promotes two modules out of `spelling-game/js/` into `core/`. When
this spec was drafted those existed only on the `spelling-game` branch, so the
original constraint was to branch from there. That branch has since landed —
`master` and `spelling-game` point at the same commit, and both modules are on
`master`.

Implementation branches from `master` like any other work. The note is kept
rather than deleted because §3 is the one part of this design that depends on
another game's history rather than on its own.

---

## 2. No map library, and why

The obvious approach is a map plugin. The repo next door (`~/sailing-weather`)
draws interactive maps with GeoViews on HoloViews/Bokeh/Panel, and Bokeh's
`PolyDrawTool` genuinely supports dragging polygons.

It is the wrong tool here, for four reasons that are worth writing down so this
is not re-litigated:

1. It is **Python served over a websocket**. Every interaction round-trips to a
   server. This repo's games are static files served by `server/serve.js`.
2. Bokeh's draw tools are **editing** tools. The user must activate the tool in
   a toolbar first, and a stray toolbar click silently breaks the interaction.
3. **Web Mercator distorts under drag** — a country dragged north grows.
4. Panel is not a game framework. No sprite layer, no sound, no animation
   timeline. All the polish would be fought for.

The deciding fact is simpler than any of those: **country shapes are just SVG
paths.** A map library is solving a problem — live tiles, arbitrary zoom, layer
composition — that this game does not have.

---

## 3. Two promotions into `core/`

The geography game is the **third** consumer of two modules currently living
inside `spelling-game/`. Three consumers is where a module belongs to the core.

### `typing-cost.js` → `core/typing-cost.js`

Moves unchanged. It already imports its finger and row tables from
`typing-game/js/keymap.js` rather than copying them, and it already takes its one
pedagogical dial (`typingWeightFloor`) from config.

This module is **the mitigation for the central tradeoff of this game**. Typing
the answer means a kid who knows a country can still fail on its spelling, and
the worst offenders are geography's alone: `Kyrgyzstan`, `Liechtenstein`,
`Azerbaijan`. `typingCost` scores keyboard awkwardness as distinct from
knowledge difficulty and applies it as a **multiplier, not a gate**, clamped so
that no country ever becomes unreachable.

The measured distribution says this tail is smaller than it feels. Across the
177 units, the **median name is 7 letters** — the same burden as the spelling
game's own words. The problem is a tail, and a multiplier is the right shape of
answer to a tail.

### `frontier.js` → `core/frontier.js`

Needs one change. It currently imports `spellingSpace` directly for id encoding
while already taking `spine` as a parameter. Promoting means **`space` becomes a
parameter too**, matching how `mastery.js` and `scheduler.js` already receive it.

The module's own header argues for this — *"the id encoding is the adapter's,
never restated here"* — so this finishes a job that was started rather than
changing a decision.

Its central guarantee carries over untouched and matters here: **the window is a
filter over the spine, never a contiguous slice.** One country a kid cannot
spell does not block the countries behind it.

Nothing else in `core/` changes. `engine.js`, `mastery.js`, `scheduler.js` and
`space.js` are untouched.

---

## 4. The build tool

`tools/build-countries.js`, matching the `tools/build-fry.js` precedent: run
once by a human, output committed, no build step at play time.

It emits `geography-game/js/countries.js`:

```js
export const COUNTRIES = [
  { code: 'bz', name: 'Belize', path: 'M412.8,301.2l-1.4,2.9…', box: [408, 296, 12, 18] },
  …
]
```

Four decisions live inside it:

**Projection happens at build time.** Lat/lon is projected to a fixed world SVG
canvas once, and the committed `path` is already in screen coordinates. The
browser never projects anything. There is no projection library at runtime and no
runtime math to get wrong.

**`box` is the projected bounding box**, which is what §6 zooms to. Deriving it
at build time keeps it a data field rather than a DOM measurement, which is what
makes the zoom function testable without a browser.

**Geometry is simplified** (Douglas–Peucker) at build time. 110m Natural Earth is
already coarse; simplification is about path length in the committed file, not
about visual resolution.

**Names are curated in the tool, not harvested from the shapefile.** Natural
Earth's `NAME` field yields `Dominican Rep.` — fine as a map label, unusable as
something a kid types.

### The naming rule

Use the **common short English name**; where two would collide, use the shortest
form that distinguishes them.

- `People's Republic of China` → `China`
- `United States of America` → `United States`
- `Democratic Republic of the Congo` → `DR Congo`
- `Republic of the Congo` → `Congo`
- `North Korea` / `South Korea` and `Sudan` / `South Sudan` stand as they are
- `Dominican Rep.` → `Dominican Republic`

Excluded from the spine entirely: Antarctica, French Southern and Antarctic
Lands, N. Cyprus, Somaliland, W. Sahara — non-countries and unrecognized states.

That leaves **172 countries** in the spine pool. The curation also cuts the
worst of the typing tail: the longest target falls from 31 letters
(`French Southern and Antarctic Lands`) to 22 (`Central African Republic`),
with `Bosnia and Herzegovina` at 20 next behind it.

This table is a **curriculum decision and belongs in review**, the same way the
spelling opener does. It is small enough to read in one sitting.

---

## 5. Vendoring, not fetching

Flags are copied into `geography-game/vendor/flag-icons/` — the `4x3` SVGs plus
the upstream `LICENSE` file — and committed.

The deciding reason is the boat. The sailing repo is planning passages through
Belize and the Rio Dulce. A game played at anchor needs to work with **no
connectivity at all**. A CDN link makes the flag game blank water offline; an
npm dependency breaks the day `node_modules` is not there. The repo has no root
`package.json` and no install step — `play.command` just serves files — and
vendoring is what preserves that.

MIT's only obligation is retaining the copyright notice, satisfied by the
`LICENSE` file sitting beside the SVGs.

All 271 are vendored, not the ~100 the spine will realistically reach. A subset
would have to be regenerated every time the spine grew, and 2 MB does not justify
the bookkeeping.

---

## 6. The item space

### Two items per country, and why

`geo:shape:bz` and `geo:flag:bz` carry **separate mastery stats**.

This is the `6×7` / `7×6` decision from the math game, for the same reason:
knowing a flag and knowing a location are genuinely different knowledge, and one
merged record cannot tell you which one is weak. A kid who knows every flag and
no locations would read as fully mastered.

`relatedIds('geo:shape:bz')` returns `['geo:flag:bz']` and vice versa, so the
two are never served adjacently — answering a flag prompt immediately after the
map prompt for the same country is answered from working memory and logs a fast
latency that means nothing.

This doubles the item space. `frontier.js` absorbs that without changes.

### Matching is letters-only

`targetOf({code:'cr', kind:'shape'})` returns `costarica`, not `Costa Rica`.

The display renders the space as a visual gap; the engine never sees it. This
preserves the invariant `spelling-game/js/spine.js` already states for its own
items — *"lowercase a-z only, no spaces, no punctuation"* — and **that is
precisely why `core/engine.js` needs no changes.**

The measured shape of the problem: of 177 names, 36 contain a space, exactly one
contains a hyphen (`Guinea-Bissau` → `guineabissau`), exactly one contains an
apostrophe (removed by the China rename), and **none contain diacritics** —
Natural Earth's `NAME_EN` field is already pure ASCII.

Two countries must never normalize to the same target. Run against the 172
curated names this holds with **zero collisions** — but it holds by luck of the
naming rule, not by construction, so it is asserted in the build tool rather
than left to be noticed later.

### Confusable names need no new machinery

The set contains four Guineas, two Congos, two Koreas and two Sudans. When a kid
types `guinea` for Equatorial Guinea, that wrong answer **equals another item's
correct answer** — which is exactly the trigger for the interference guard in
`scheduler.js`. The pair stops being served adjacently while either is cold, and
the guard lifts once both are warm, at which point juxtaposing them is useful
discrimination practice rather than a trap.

This is free. It is the same machinery that caught `42` bleeding between `7×7`
and `6×8` in real play.

**Lookalike flags land in the same guard** — Chad/Romania, Indonesia/Monaco,
Netherlands/Luxembourg — because they produce the same evidence: a wrong answer
that is another item's right answer.

---

## 7. The spine

Ordered on the same two-section principle as the spelling spine, for the same
reason: no derivable ordering produces a good first lesson.

**The opener is hand-authored and local.** Belize, Guatemala, Mexico, Honduras,
Cuba, Jamaica, Panama, Costa Rica, Nicaragua, El Salvador, Colombia, Dominican
Republic, Haiti, Bahamas. Geography a kid can walk ashore into is retained
differently from geography on a flashcard, and this is the water the family is
sailing.

**The tail widens outward** — rest of the Americas, then the world, ordered by
familiarity (roughly population and cultural prominence). This half is
generated, the way the Fry half of the spelling spine is.

The frontier does the rest. There is no country count, no level setting, and no
continent gate: the window is the first *n* countries in spine order that are not
yet hot, recomputed from the log on every load. The same code lands a six-year-old
and a twelve-year-old in completely different parts of the world map.

---

## 8. The map prompt

`viewBoxFor(box)` takes a country's projected bounding box and returns a padded
SVG viewBox. Padding scales with the country's larger dimension, with a **floor**
so Belize gets regional context rather than filling the screen, and a **ceiling**
so Russia does not.

Neighbors render muted; the target renders highlighted. This is the whole
pedagogical content of the prompt: *Central America with one country lit* is an
answerable question, and *Belize alone on white* is not. Too tight gives no
context; too wide is a needle in a haystack.

`viewBoxFor` is **the only genuinely new logic in this game**, and being a pure
`box -> viewBox` function it is fully testable without a DOM.

The flag prompt has no equivalent problem — it renders one vendored SVG.

---

## 9. What this deliberately defers

**Drag and drop.** A blank continent with colored country shapes dragged into
place. It needs `core/` to grow a non-typed answer modality, which is a real
change to the `ItemSpace` contract and deserves its own spec.

It is deferred, not abandoned, and this design pays most of its setup cost:
**the shape pipeline in §4 is exactly what that game needs**, including the
projected paths and the bounding boxes. When it is built, the data is already
committed and already correct.

---

## 10. Testing

Following the line the repo already holds — thorough on logic, none on UI.

**Tested:**

- `viewBoxFor` — floor holds for the smallest country, ceiling for the largest,
  padding is symmetric, output is deterministic.
- The adapter, against the `ItemSpace` validator in `core/space.js`. This is what
  stops a fourth game drifting from the seam.
- `relatedIds` — shape and flag name each other and nothing else.
- Build tool output — every spine entry resolves to both a path and a flag file;
  the Taiwan alias holds; every name is letters-only after normalization; no two
  countries collide on their normalized target.
- `core/frontier.js` and `core/typing-cost.js` keep their existing suites,
  re-pointed. The frontier tests carry the weight, since parameterizing `space`
  is the only behavioral change in either promotion.

**Not tested:** map rendering, prompt DOM, flag display, CSS.

---

## Open questions for a human

- **The curated name table** is a curriculum call, not a mechanical one.
  `DR Congo` is a compromise; so is dropping `of America`. Worth one read-through.
- **How much regional context** the map prompt should show is a pedagogical
  judgment the floor and ceiling constants encode. The right values are a
  question for real play, not for a test.
- **Whether the opener should be flags-first or map-first.** Flags are arguably
  the easier entry — recognition rather than spatial reasoning — but the shapes
  are the reason to build this. Currently both kinds enter the spine together.
