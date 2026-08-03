# Math menu, ordered mode, and three rungs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse math's two menu cards into one menu screen inside the game, add a fourth mode that walks a times table in order, and record — for every fact — whether the kid can produce it at each of three levels of support.

**Architecture:** All new logic goes in pure modules (`js/ordered.js`, a decoration step in `js/mastery.js`) that take the event log or the model and return data. `main.js` stays the only impure module besides `log.js`. The menu is a third region inside `index.html` beside `#stage` and `#results`, rendered by `js/ui/menu.js` under the same no-state contract `js/ui/results.js` already follows.

**Tech Stack:** Vanilla ES modules, zero dependencies. Tests are `node:test` + `node:assert/strict`, run with `node --test` from the repo root.

**Spec:** `math-game/docs/superpowers/specs/2026-08-03-math-menu-and-ordered-mode-design.md`. Read it before Task 1. Where this plan and the spec disagree, stop and ask.

## Global Constraints

- **Zero dependencies.** Nothing is added to any package manifest. This is a hard rule of the project.
- **`Date.now` and `Math.random` appear only in `js/main.js` and `js/log.js`.** A project check greps for exactly those two strings. No new module may use either — `ordered.js` and `ui/menu.js` are pure.
- **Every tunable lives in `js/config.js`.** No new magic number appears anywhere else.
- **`build` in `js/config.js` stays `'m2'`.** It is bumped only when scheduler weights, hint delays or bucket thresholds change. Nothing here changes any of those.
- **No log migration.** Ordered attempts are ordinary AttemptEvents carrying `mode: 'ordered'`. `data/math-log.jsonl` is committed real play data — never clear it, never rewrite it.
- **An absent `mode` on an event means drill.** Every line written before the field existed was a drill attempt. This rule already exists and must not be weakened.
- **Logic is tested thoroughly, UI is not tested at all.** That split is deliberate (`README.md:87`). Tasks 5 and 6 ship no tests; everything they rely on is tested in Tasks 1–4.
- **House style for module headers.** Every module in this codebase opens with a comment explaining what it owns and why, and marks silent failure modes with `TRAP`. Match it. A `TRAP` comment is required wherever this plan says a mistake would fail silently.
- **Run `node --test` from the repo root** before every commit. The suite is currently green; it stays green.
- **Do not touch `pickLearnFacts` or `js/scheduler.js`.** Both look improvable from inside this work and both are out of scope on purpose. A learn rung would make a better selector than the current "prefer untaught", but it collides with `next-steps.md` item 1 — the open bug where learn mode teaches `6×7`, `7×6` and `7×7` in one session and manufactures interference. The scheduler has its own open bug, item 2. Both want designing against the real log, on their own. Leave them exactly as they are and note anything you spot in `next-steps.md`.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `math-game/js/ordered.js` | Table rows, which facts a run serves, per-table progress. Pure. |
| `math-game/js/ui/menu.js` | Renders the menu screen. Presentation only. |
| `math-game/tests/ordered.test.js` | Tests for `ordered.js` |

**Modified**

| File | Change |
|---|---|
| `core/mastery.js` | `'ordered'` joins `'learn'` as an instruction mode |
| `math-game/js/mastery.js` | Decorates the core model with the two rung records |
| `math-game/js/ordered.js` | (created above) |
| `math-game/js/config.js` | `unaidedRuns: 2`; `mode` fallback retired |
| `math-game/js/hints.js` | `ordered` ladder |
| `math-game/js/main.js` | `MODES`, `readMode`, `runSession(mode, table)`, menu screen wiring |
| `math-game/js/ui/results.js` | Ordered strip branch, three-rung detail block, next-table button |
| `math-game/index.html` | `#menu` region |
| `math-game/tests/mastery.test.js` | Rung tests |
| `math-game/tests/hints.test.js` | Ordered ladder test |
| `games-menu.html` | Two math cards become one |
| `math-game/docs/next-steps.md` | Item 4 and two §5 questions resolved |

**Sequencing.** Tasks are strictly ordered — each consumes the one before. This is not parallel work; one agent should take the whole plan.

---

## Task 1: `'ordered'` is an instruction mode

`core/mastery.js` is shared with the spelling game. It currently recognises exactly one instruction mode by a module constant, with a single call site. Ordered mode must be treated identically: excluded from buckets, but still setting `taught`.

**Files:**
- Modify: `core/mastery.js:21` (the `LEARN_MODE` constant), `core/mastery.js:113` (the predicate), `core/mastery.js:308` (the call site)
- Test: `math-game/tests/mastery.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `deriveMastery(events, config)` unchanged in signature and shape. Behaviour change only: an attempt with `mode: 'ordered'` now behaves exactly as `mode: 'learn'` does today.

- [ ] **Step 1: Write the failing tests**

In `math-game/tests/mastery.test.js`, three tests:

1. An event list of five fast, correct `mode: 'ordered'` attempts on one fact leaves that fact `bucket: 'cold'` with `cleanCount: 0` — enough drill attempts of the same shape would make it `hot`, so this proves the exclusion rather than an accident of the data.
2. The same event list sets `taught: true` on that fact.
3. A mixed list of drill and ordered attempts produces the same `bucket` and `cleanCount` as the drill attempts alone.

Test 3 is the one that catches a partial fix.

- [ ] **Step 2: Run and confirm they fail**

`node --test math-game/tests/mastery.test.js` — tests 1 and 3 fail (ordered attempts are currently treated as drill and reach the buckets), test 2 fails (`taught` is false).

- [ ] **Step 3: Implement**

Replace the `LEARN_MODE` string constant with a set of instruction modes containing `'learn'` and `'ordered'`, and rename `isLearnAttempt` to `isInstructionAttempt`. Update the one call site.

Keep the existing comment block at `core/mastery.js:100` — it explains why an absent `mode` means drill and why that must not change — and extend it to say that instruction modes are a set now because the math game has two of them, while spelling has one and never emits the other.

- [ ] **Step 4: Run the full suite**

`node --test` from the repo root. The spelling game shares this module: its tests must still pass, and they will, because it never writes `mode: 'ordered'`.

- [ ] **Step 5: Commit**

---

## Task 2: The two rung records

The heart of the change. For every fact, record whether the kid produced it unaided at each instruction level. Drill's rung already exists as the `hot` bucket and is not touched.

This is a **decoration over the core model, in `math-game/js/mastery.js`** — not a change to `core/mastery.js`. The rung rules are math's design (runs versus attempts, the last-two window) and putting them in the shared module would impose them on spelling, which has no ordered mode and would need its own re-verification. `js/mastery.js` is a 44-line binding today; this makes it a binding plus one decoration step.

**Files:**
- Modify: `math-game/js/mastery.js`
- Modify: `math-game/js/config.js` (add `unaidedRuns: 2`)
- Test: `math-game/tests/mastery.test.js`

**Interfaces:**
- Consumes: `deriveMastery(events, config)` from Task 1
- Produces: every `FactStats` in `model.byId` gains two records. All existing fields keep their meaning and values.

```js
/**
 * @typedef {{ attempts: number, unaided: number, cleared: boolean }} Rung
 * FactStats gains:
 *   ordered: Rung   // `attempts` counts RUNS — see below
 *   learn:   Rung
 */
```

Definitions this task implements, quoted from spec §3 and §4:

- **Unaided:** `stage === 'strategy'` **and** `wrong.length === 0`.
- **Learn rung:** counts learn *attempts*. `cleared` when the last `config.unaidedRuns` attempts on that fact were all unaided.
- **Ordered rung:** counts *runs*, where a run is the set of ordered attempts sharing a `session` id. `cleared` when the last `config.unaidedRuns` runs that served the fact were unaided. An ordered run serves each fact once, so run and attempt coincide — but grouping by session is what makes the abandoned-run case correct, so group by session anyway.
- Fewer than `unaidedRuns` occasions means `cleared: false`. Never seen means `{attempts: 0, unaided: 0, cleared: false}`.

- [ ] **Step 1: Write the failing tests**

In `math-game/tests/mastery.test.js`. Build event lists by hand — do not reach for `deriveMastery` fixtures from elsewhere:

- Unaided predicate: `stage: 'reveal'` is not unaided; `stage: 'strategy'` with `wrong: [42]` is not unaided; `stage: 'strategy'` with `wrong: []` is.
- One unaided learn attempt → `cleared: false`. Two consecutive → `cleared: true`.
- Unaided, then aided → `cleared: false`, even though `unaided` is 1.
- Aided, then two unaided → `cleared: true`. Only the last two count.
- A fact served **twice in one learn session**, both unaided, clears the learn rung — learn counts attempts.
- The same fact served in **two ordered attempts sharing a session id** counts as **one** run, and does not clear the ordered rung. This is the test that distinguishes the two counting rules; without it, one implementation passes for both.
- A fact never attempted has both rungs at zero and `cleared: false`.
- Existing fields are untouched: a model derived from drill-only events has the same `bucket`, `cleanCount` and `medianCleanMs` as before the decoration.

- [ ] **Step 2: Run and confirm they fail**

- [ ] **Step 3: Implement**

Add `unaidedRuns: 2` to `js/config.js` with a comment explaining why two and not one — the strategy is on screen, so a single "did not press the button" can mean she read the answer off the display (spec §3).

In `js/mastery.js`, derive the two rungs from the same event list and attach them. Note in the module header that the two rungs count different things and why, because a reader will assume they are symmetrical.

Mark with `TRAP`: the ordered rung groups by `session` id and **not** by session events. A SessionEvent is only written when a session finishes (`js/main.js:627`), so a run the kid abandoned halfway writes none — grouping by session events would silently discard evidence she actually produced, and nothing would fail.

- [ ] **Step 4: Run the full suite**

- [ ] **Step 5: Mutation-test the rules**

Spec §8 requires this, and `next-steps.md:220` records that every real defect in this project passed a green build. Break the implementation four ways, one at a time, and confirm a test fails each time. Revert after each.

1. `unaidedRuns` 2 → 1
2. `unaided` ignoring `wrong.length`
3. Ordered rung grouping by attempt instead of by session
4. Ordered attempts allowed into `cleanCount`

If any mutation passes, the test for it is theatre — write a real one before continuing.

- [ ] **Step 6: Commit**

---

## Task 3: `ordered.js` — rows, runs, progress

**Files:**
- Create: `math-game/js/ordered.js`
- Test: `math-game/tests/ordered.test.js`

**Interfaces:**
- Consumes: the decorated model from Task 2 — specifically `model.byId.get(id).ordered.cleared`
- Produces:

```js
/** The 11 facts n×0 … n×10, ascending. @returns {{op,a,b}[]} */
export function tableRow(n)

/** The row from the first uncleared fact to the end. [] when the table is done. */
export function runFor(model, n)

/** @returns {{table: number, cleared: number, total: number}[]} tables 2..10, ascending */
export function tableProgress(model)
```

Tables are rows 2 through 10. A table is `{op: '*', a: n, b: 0..10}` — `a` is fixed, `b` varies, so "the 2s" is `2×0 … 2×10`.

- [ ] **Step 1: Write the failing tests**

Build models by hand — set `ordered.cleared` directly rather than deriving from events. `deriveMastery` is Task 2's contract; what this module consumes is one boolean per fact, and constructing it directly lets a test place a fact in an exact state without reverse-engineering the rung rules. (`tests/learn.test.js` does this and its header explains why; follow it.)

- `tableRow(2)` has 11 facts, all `a === 2`, `b` ascending 0 through 10.
- Nothing cleared → `runFor` returns the whole row.
- First three cleared → the run starts at `2×3` and has 8 facts.
- **`2×7` cleared but `2×5` not → the run starts at `2×5` and still contains `2×7`.** Prefix-only. This is the test that stops someone implementing a filter.
- Everything cleared → `runFor` returns `[]`.
- `tableProgress` covers tables 2 through 10 and nothing else, ascending.
- For every table, `tableProgress`'s `cleared` count and `runFor`'s length are consistent with the same model. Assert this across all nine rather than by example — two functions reading one model must not disagree.

- [ ] **Step 2: Run and confirm they fail**

- [ ] **Step 3: Implement**

Module header must state: order never varies, the scheduler plays no part, peeling is prefix-only, and *why* prefix-only — plucking cleared facts from the middle would shorten the run faster and destroy the sense of place the whole mode sells (spec §4).

- [ ] **Step 4: Run the full suite**

- [ ] **Step 5: Mutation-test prefix-only**

Change the implementation to filter out every cleared fact rather than trimming the front. The `2×7` / `2×5` test must fail. Revert.

- [ ] **Step 6: Commit**

---

## Task 4: Ordered mode is playable

After this task, `math-game/index.html?mode=ordered&table=2` plays a run end to end and logs it. The menu does not exist yet; the deep link is how it gets verified.

**Files:**
- Modify: `math-game/js/hints.js:46` (`LADDERS`)
- Modify: `math-game/js/main.js` — `MODES` (line 98), `readMode` (line 115), `runSession` (line 498), `previousSessionMedian` (line 187), `onAction` (line 686)
- Test: `math-game/tests/hints.test.js`, `math-game/tests/mastery.test.js`

**Interfaces:**
- Consumes: `runFor(model, n)` from Task 3
- Produces: `runSession(mode, table)` — `table` is a number for ordered and `null` for learn and drill. The session event gains `table` for ordered sessions.

- [ ] **Step 1: Write the failing tests**

- `ladderFor(fact, CONFIG, 'ordered')` returns `['strategy', 'reveal']` — the same two rungs as learn.
- `previousSessionMedian` ignores a session event with `mode: 'ordered'`.

The second is the important one. The function is currently a *reject-list* — `if (event.mode === 'learn') continue` (`js/main.js:187`) — so an ordered session passes straight through and gets compared against a drill median. That is the comparison spec v2 §5 forbids, and it fails **silently**: a plausible number, no exception, nothing red.

- [ ] **Step 2: Run and confirm they fail**

- [ ] **Step 3: Implement**

- `LADDERS.ordered = ['strategy', 'reveal']`.
- `MODES` gains `'ordered'`.
- `readMode()` returns `null` when the URL carries no recognised mode, instead of falling back to `CONFIG.mode`. Retire the `mode` key from `js/config.js` and the comment above it — it is no longer a fallback for any real path. Spec §1 records this as the answer to `next-steps.md` §5's open question about the default mode.
- `readTable()` reads `?table=`, accepts an integer 2–10, and returns `null` otherwise. An out-of-range or missing table with `?mode=ordered` shows the menu rather than starting a broken run — same reasoning as `readMode`: a typo in a bookmark must not be a blank screen.
- **Invert `previousSessionMedian` to an accept-list**: accept `mode === 'drill'` or absent, reject everything else. Comment why, at the line — the current reject-list shape is what makes a fifth mode a silent bug.
- `runSession(mode, table)` builds its plan from `runFor(model, table)` when mode is ordered, exactly where it currently calls `buildLearnSession` for learn. `total` comes from `plan.length`; there is already a comment at `js/main.js:519` explaining why totals never come from a config multiplication, and it applies here unchanged.
- `delayMs` is `null` for ordered, as for learn. **Not a large number** — nothing downstream may mistake it for a very patient timer. The tick loop starts for drill only.
- Pass `mode` explicitly to `ladderFor`. The `TRAP` at `js/main.js:543` explains what happens if you let it default; the same trap applies to ordered.
- The session event gains `table` for ordered sessions.

- [ ] **Step 4: Run the full suite**

- [ ] **Step 5: Verify by playing it**

Start the server (`./play.command`), open `math-game/index.html?mode=ordered&table=2`, and play a full run. Confirm: the strategy shows from the first frame, no answer ever appears on its own, the progress bar total matches the run length, and `data/math-log.jsonl` gains attempts with `mode: 'ordered'` plus one session event with `table: 2`.

Then reload the same URL. **The run must be the same length** — one visit clears nothing.

- [ ] **Step 6: Commit**

---

## Task 5: The menu screen

**Files:**
- Create: `math-game/js/ui/menu.js`
- Modify: `math-game/index.html` (a `#menu` region beside `#stage` and `#results` at line 69)
- Modify: `math-game/js/main.js`
- Modify: `math-game/css/` — a new `menu.css`, following the existing one-file-per-screen split

**Interfaces:**
- Consumes: `tableProgress(model)` from Task 3
- Produces:

```js
export function renderMenu(container, model)
/** Delegated on `container`, replaces any previous handler — copy the
 *  onResultsAction pattern in js/ui/results.js exactly. */
export function onMenuAction(container, handler)
// handler receives (action, table) where action is
//   'learn' | 'drill' | 'ordered' | 'games'
// and table is a number for 'ordered', null otherwise
```

Screen content is spec §1. Three routes: Learn 3 facts, Drill, and an "In order" heading over nine table rows carrying `data-menu-action="ordered" data-table="N"`. Plus "Back to all games".

- [ ] **Step 1: Build the screen**

No tests — UI is not tested in this project (`README.md:87`), and everything it reads was tested in Tasks 2 and 3.

`ui/menu.js` follows `ui/results.js`'s contract exactly: it holds no state, starts nothing, and reports which button was pressed through a delegated handler. It must not import `ordered.js` or `mastery.js` — it receives the model and asks `tableProgress` for numbers, nothing more.

A table whose run is empty renders as done and **is not a control** — no link, no button. A button that starts a session with nothing in it is the failure the `canLearn` guard already exists to prevent (v2 §8).

- [ ] **Step 2: Wire it into `main.js`**

- `main()` shows the menu when `readMode()` returns `null`, instead of starting a session.
- `onMenuAction` starts `runSession(mode, table)` directly — no navigation, no reload. This is the same thing the results screen's continuation buttons already do.
- `onAction` gains `'menu'`, which shows the menu screen. `Done` on the results screen now maps to it.
- The menu re-renders from the current model each time it is shown, so a run finished this sitting moves the bar without a reload.
- `MENU_URL` is unchanged and is now reached only from "Back to all games".
- Register `onMenuAction` **once, at startup**, alongside the other three input routes at `js/main.js:717`. Registering per render stacks duplicate listeners.

- [ ] **Step 3: Clear the progress bar when the menu shows**

Mark with `TRAP`. The progress bar lives in `#shell` (`index.html:35`), **outside** `#stage`, so hiding the stage does not hide it. Without this, the menu renders under a stale `7 of 7` from the session that just ended. Nothing throws, no test goes red, and it quietly reads as progress through a menu.

- [ ] **Step 4: Verify by playing it**

Open `math-game/index.html` with no query string. Confirm: the menu appears rather than a drill session; all three routes start the right thing without a page load; finishing a run and pressing Done returns to the menu with that table's bar advanced; and the deep links from Task 4 still bypass the menu.

- [ ] **Step 5: Commit**

---

## Task 6: The results screen

**Files:**
- Modify: `math-game/js/ui/results.js`
- Modify: `math-game/js/main.js` (the `summary` object at line 657)
- Modify: `math-game/css/results.css`

**Interfaces:**
- Consumes: the rung records from Task 2, `tableProgress` from Task 3
- Produces: nothing new. `summary` gains `table` for ordered sessions.

- [ ] **Step 1: The ordered strip**

Branch on `summary.mode === 'ordered'`, beside the existing learn branch at `js/ui/results.js:276`. Subtitle "In order · the 2s". Three blocks: answers worked through, how many were unaided, and how many of the table's 11 have cleared.

The drill strip must never render for an ordered session. It would report `0% from memory` — a failure grade for a session that cannot produce a `clean` rung at all. The comment at `js/ui/results.js:253` explains this for learn; the same reasoning applies and should be extended rather than restated.

- [ ] **Step 2: The continuation row**

`[ The 3s ]` — the next table with a non-empty run — alongside `[ Drill 20 ]` and `[ Done ]`. When the current table still has facts left it reads `[ The 2s again ]` instead. When every table is done, the ordered button is omitted entirely, matching how `canLearn` hides the learn button.

Both continuations after every mode, per v2 §8. The ordered button appears after drill and learn sessions too.

- [ ] **Step 3: The three-rung block in the detail panel**

Added to `renderDetail` (`js/ui/results.js:453`). Three lines, top to bottom in increasing difficulty — in order, learn, drill — so the boundary between cleared and not is the kid's current level of support at a glance.

Each line shows cleared / attempted-but-not-cleared / never-tried as three distinct states. Drill's line reports its existing numbers (clean count, typical time) and is cleared when the bucket is `hot`.

**The grid itself does not change.** Cell colour still comes from the drill bucket, because that is the rung making the real claim; a grid coloured by the weakest available evidence would flatter.

Copy is provisional — add it to the "needs a human, not a fix" list in `next-steps.md` §5. These have to read as progress to a ten-year-old and no test can answer that.

- [ ] **Step 4: Verify by playing it**

Play an ordered run, a learn session and a drill session in one sitting. Confirm the strip differs per mode, that no ordered or learn session reports a "quicker than last time" comparison, and that tapping a square shows three rungs whose values match what you just played.

- [ ] **Step 5: Commit**

---

## Task 7: One card, and close out the notes

**Files:**
- Modify: `games-menu.html:140-162`
- Modify: `math-game/docs/next-steps.md`

- [ ] **Step 1: Collapse the two math cards into one**

Replace the "Learn Numbers" and "Drill Numbers" cards with a single "Numbers" card pointing at `math-game/index.html` with **no query string**.

Card copy must not describe the modes as difficulty levels — they are different activities (v2 §7). The remaining two spelling cards are left exactly as they are; spelling has the identical split and the identical available fix, and it is not part of this work.

- [ ] **Step 2: Update `next-steps.md`**

- Item 4 ("A third mode: drill in order — wanted, shape undecided") is resolved. Replace it with a pointer to the spec and a one-line summary of what shipped, noting that the mode turned out to be instruction rather than drill.
- In §5, mark two questions answered: the default-mode question (no `?mode=` now shows the menu) and the menu-copy question, if Task 7's copy settles it.
- In §5, **add** the new provisional copy from Task 6 as an open question.
- Items 1 and 2 stay open and untouched. Neither is addressed here.

- [ ] **Step 3: Full verification pass**

`node --test` from the repo root — everything green. Then from `games-menu.html`, click through to Numbers, play one of each mode, and return to the games list.

- [ ] **Step 4: Commit**

---

## Definition of done

- `node --test` green from the repo root, including the spelling game's suite
- All four Task 2 mutations and the Task 3 mutation fail a test
- One math card on the main menu; the menu screen reachable with no query string
- An ordered run playable, logged with `mode: 'ordered'`, and shortening from the front on the visit after two unaided passes
- Tapping any square shows three rungs
- `data/math-log.jsonl` gained real sessions and lost nothing
