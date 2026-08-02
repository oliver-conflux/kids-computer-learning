# Learn and Drill Modes — Implementation Plan

> **For agentic workers:** executed by an **agent team**. Superpowers is **off**
> for subagents on this project. The Shared Contracts section is normative — if a
> contract seems wrong, **message the lead**, do not invent a variant.

**Goal:** Split the game into a hint-free timed drill mode and an untimed
instruction mode, with separate scoring, reachable as two menu cards.

**Spec:** `math-game/docs/superpowers/specs/2026-08-01-learn-and-drill-modes-design.md`
(v2) amending `2026-08-01-math-facts-game-design.md` (v1). The spec is the
authority on *why*; this plan is the authority on *what to build*. Read the spec
section named in your task before starting.

**Baseline:** v1 is built, merged, and playable. `node --test` from repo root is
**217 passing**. Everything below is a change to working code, not a greenfield
build — so the highest risk is breaking something that works, not failing to
build something new.

---

## Global Constraints

Carried from v1 and still in force. Violating any of these is a defect
regardless of whether a test catches it.

- **Zero runtime dependencies.** Node built-ins only. No `package.json`.
- **ES modules** throughout. No `window.*` globals.
- **Node 22+.** Run tests with bare `node --test` from the repo root. NOT
  `node --test <dir>` — Node 22.18 treats positional args as globs and it fails
  with `MODULE_NOT_FOUND`.
- **The pure core takes no clock and no randomness.** `facts`, `mastery`,
  `scheduler`, `hints`, `engine`, `learn`, `rng` never call `Date.now()` or
  `Math.random()`. Time arrives as a `now` parameter, randomness as an injected
  `rng`. A project check greps `math-game/js/` and expects matches only in
  `main.js`. Do not write those literal strings in comments in pure modules —
  the grep will false-positive.
- **`now` is epoch milliseconds everywhere.** Never `performance.now()`.
  `toAttemptEvent` builds `t` from `resolvedAt` as a real date, so a monotonic
  clock yields 1970 timestamps while `ms` still looks correct.
- **Timestamps are UTC `Z`-suffixed ISO.** `mastery` sorts by comparing `t` as a
  plain string; a non-`Z` offset silently breaks chronological order.
- **No countdown, timer bar, elapsed time, speed score, WPM-equivalent, or
  comparison to anyone but the kid's own previous session — in EITHER mode.**
- **The delay grows with mastery, it does not shrink.** Cold gets help soonest.
  This is the rule most likely to be "corrected" by someone who thinks it looks
  backwards.
- **`6 × 7` and `7 × 6` stay separate facts.** Nothing canonicalises.
- **Palette:** page `#eef0f3`, accent `#7b6bd6`, heading `#2f3742`, muted
  `#7b8493`, error fill `#f4c9c2`, error text `#d98a7d`.
- **Worktree base.** Your worktree may be cut from a stale commit. Verify
  `math-game/js/main.js` exists before starting; if not, `git merge math-facts-game`.
- **Do not modify `data/math-log.jsonl`.** Playing the game to verify dirties it;
  `git checkout` it before committing. It is reserved for real play.

---

## Shared Contracts

Normative. Exact names and shapes.

### Mode

```
Mode = 'drill' | 'learn'
```

Chosen by `?mode=` on the URL, falling back to `CONFIG.mode`.

### Config additions

```
CONFIG = {
  ...v1 fields unchanged except delays...
  mode:        'drill',   // fallback when no ?mode= query param
  learnFacts:  3,         // distinct facts per learn session
  learnPasses: 4,         // times each is cycled
  delays:      { cold: 4000, warm: 6000, hot: 8000 },  // NOW time-to-reveal
}
```

`delays` is no longer per-stage — drill has one transition, so the value is the
whole retrieval window. `blocksMaxProduct` (25) survives but governs **learn mode
only** now.

### Stages, per mode

Stage names are REUSED from v1, not extended:

```
drill ladder:  ['clean', 'reveal']
learn ladder:  ['strategy', 'reveal']
```

A learn attempt therefore **never has `stage: 'clean'`**. That matters: mastery's
existing "clean means retrieval" rule already excludes learn attempts by
construction, and the explicit `mode` filter is belt-and-braces on top.

In learn mode the initial stage IS `'strategy'` — the strategy is on screen from
the start, not revealed by a timer. Blocks render alongside it when applicable;
they are not a stage in v2.

### Log event additions

```
AttemptEvent = {
  ...all v1 fields unchanged...
  mode: 'drill' | 'learn',
  revealed?: boolean,        // learn only: did the kid press "show me the answer"
}
```

**`mode` absent means `'drill'`.** Every existing line predates the field and was
a drill attempt, so history reads correctly with no migration.

### Module surfaces — changes only

```
// js/hints.js — ladderFor gains a mode parameter
ladderFor(fact, config, mode)  -> Stage[]    // 'drill' -> ['clean','reveal']
                                             // 'learn' -> ['strategy','reveal']
blocksApply(fact, config)      -> boolean    // NEW: learn-mode block predicate,
                                             // product 1..blocksMaxProduct
delayMsFor(bucket, config)     -> number     // unchanged
nextStage(ladder, current)     -> Stage|null // unchanged

// js/mastery.js
deriveMastery(events, config)  -> MasteryModel   // now filters mode !== 'learn'
compareTimestamps(l, r)        -> number         // unchanged

FactStats gains ONE field:
  taught: boolean    // at least one learn-mode attempt exists for this fact

// js/engine.js
startProblem(fact, ladder, now)          -> ProblemState   // unchanged
typeDigit(state, digit, now)             -> ProblemState   // see learn rule below
backspace(state, now)                    -> ProblemState   // unchanged
tick(state, now, delayMs)                -> ProblemState   // unchanged (drill only)
revealAnswer(state, now)                 -> ProblemState   // NEW: explicit advance
toAttemptEvent(state, config, session, mode) -> AttemptEvent  // gains mode

ProblemState gains ONE field:
  revealed: boolean   // true once revealAnswer has been called

// js/learn.js — NEW FILE, pure
pickLearnFacts(model, config)      -> Fact[]   // learnFacts coldest WITH strategy
buildLearnSession(facts, config)   -> Fact[]   // cycled learnPasses times

// js/ui/problem.js
mountProblemScreen(container)              -> Element   // unchanged
renderProblem(container, state, mode)      -> void      // gains mode
renderProgress(container, done, total)     -> void      // unchanged
onRevealClick(container, handler)          -> void      // NEW: learn button wiring

// js/ui/results.js
renderResults(container, model, summary)   -> void      // unchanged signature
onResultsAction(container, handler)        -> void      // NEW: handler('learn'|'drill'|'done')
```

### SessionSummary additions

```
SessionSummary = {
  ...v1 fields unchanged...
  mode: 'drill' | 'learn',
  canLearn: boolean,   // is any strategy-bearing fact still not hot?
}
```

`canLearn` decides whether the results screen shows the Learn button.

---

## Execution Waves

| Wave | Tasks | Notes |
|---|---|---|
| 0 | T1 | Blocking — everything imports config |
| 1 | T2, T3, T4, T5 | Parallel, pure modules |
| 2 | T6, T7 | Parallel, UI |
| 3 | T8, T9 | Wiring and menu |

A reviewer runs alongside each wave, auditing the previous one. Wave N+2 does not
fire until wave N's review is clean.

---

## Task 1 — Config and delay semantics

**Tests: light.** **Spec:** §9, §10

**Files:** Modify `math-game/js/config.js`, `math-game/tests/facts.test.js` (only
if it asserts config shape)

- [ ] Add `mode: 'drill'`, `learnFacts: 3`, `learnPasses: 4`.
- [ ] Change `delays` to `{ cold: 4000, warm: 6000, hot: 8000 }`. Update the
      comment: this is now the **whole retrieval window**, not the gap between
      rungs, because drill has exactly one transition.
- [ ] Update `blocksMaxProduct`'s comment — it now governs learn mode only.
- [ ] Run `node --test`. Some v1 tests assert delay values; fix any that break by
      updating the expectation, NOT by reverting the value. One test asserts
      `delayMsFor('hot') > delayMsFor('cold')` — that must still pass, and if it
      does not, the table is wrong.
- [ ] Commit: "Add mode config and retime drill to a single reveal window"

---

## Task 2 — Mode-aware hint ladders

**Tests: thorough.** **Spec:** §1, §3

**Files:** Modify `math-game/js/hints.js`, `math-game/tests/hints.test.js`

**Interfaces:** Produces `ladderFor(fact, config, mode)` and `blocksApply(fact, config)`.

- [ ] `ladderFor` gains a third parameter `mode`. `'drill'` returns
      `['clean','reveal']` for EVERY fact — no predicates, no variation.
      `'learn'` returns `['strategy','reveal']` for every fact.
- [ ] Extract the block predicate to `blocksApply(fact, config)` — true when the
      product is `>= 1 && <= config.blocksMaxProduct`. The lower bound is not
      optional: a product of 0 draws an empty array, which is a blank region
      rather than a gentler hint (21 facts have a zero operand).
- [ ] Blocks are no longer a ladder stage. Delete the `blocks` rung from the
      LADDER table. `blocksApply` is now consulted directly by the learn-mode
      renderer.
- [ ] Keep `strategyFor` in `strategies.js` untouched.
- [ ] Tests: drill ladder is `['clean','reveal']` for all 121 facts with no
      exceptions; learn ladder is `['strategy','reveal']` for all 121;
      `blocksApply` is false for every zero-product fact and true for `1×1`;
      `delayMsFor('hot') > delayMsFor('cold')` still asserted explicitly.
- [ ] Update any v1 test asserting the old four-stage ladder shapes.
- [ ] Commit: "Make hint ladders mode-aware and drop blocks as a stage"

---

## Task 3 — Mastery excludes learn attempts

**Tests: thorough. Core logic.** **Spec:** §5, §6

**Files:** Modify `math-game/js/mastery.js`, `math-game/tests/mastery.test.js`

**Interfaces:** `deriveMastery` unchanged in signature. `FactStats` gains `taught`.

- [ ] Filter attempt events to `mode !== 'learn'` before folding into
      `attempts`/`cleanCount`/`medianCleanMs`/`bucket`. **Treat an absent `mode`
      as `'drill'`** — all existing history predates the field.
- [ ] **Confusions are the exception:** wrong answers from learn-mode attempts
      STILL count toward `confusions`. Interference between two facts is
      interference regardless of which mode surfaced it.
- [ ] Add `taught: boolean` to `FactStats` — true when at least one learn-mode
      attempt exists for that fact, computed from the full event list, not the
      retain window.
- [ ] `byId` stays total (all 121) and `confusions` stays total. Do not regress
      that.
- [ ] Tests: a learn attempt does not change bucket, cleanCount, or median; a
      learn attempt's wrong answers DO appear in confusions; `taught` is true
      after one learn attempt and false otherwise; events with absent `mode` are
      treated as drill; a fact with only learn attempts is `cold` and `taught`;
      totality still holds; deriving twice is deep-equal.
- [ ] Commit: "Exclude learn attempts from mastery, add taught flag"

---

## Task 4 — Engine supports explicit reveal

**Tests: thorough.** **Spec:** §1, §5

**Files:** Modify `math-game/js/engine.js`, `math-game/tests/engine.test.js`

**Interfaces:** Adds `revealAnswer`. `toAttemptEvent` gains a `mode` parameter.
`ProblemState` gains `revealed`.

- [ ] Add `revealAnswer(state, now)` — advances to the ladder's final stage
      immediately and sets `revealed: true`. Pure, returns new state, no mutation.
      A no-op (returns the same object by reference) if already at the last stage.
- [ ] `startProblem` initialises `revealed: false`.
- [ ] `toAttemptEvent(state, config, session, mode)` writes `mode` and, when mode
      is `'learn'`, `revealed`. Do not write `revealed` for drill attempts.
- [ ] **Learn-mode wrong answers do not advance the stage.** In drill, a wrong
      answer advancing the ladder is the escape valve that reveals the answer. In
      learn, the strategy is already fully shown and the answer is a button the
      kid controls, so a wrong answer pulses and clears WITHOUT revealing.
      Determine mode from the ladder: if `ladder[0] === 'strategy'` it is a learn
      problem. Do not add a mode field to ProblemState for this.
- [ ] Tests: `revealAnswer` sets stage to the last rung and `revealed: true`; it
      is a no-op by reference at the final stage; a wrong answer in a drill
      ladder advances one stage; a wrong answer in a learn ladder does NOT
      advance; `toAttemptEvent` writes `mode` and omits `revealed` for drill; no
      function mutates its input.
- [ ] Commit: "Add explicit reveal and mode to attempt events"

---

## Task 5 — Learn session builder

**Tests: thorough.** **Spec:** §4

**Files:** Create `math-game/js/learn.js`, `math-game/tests/learn.test.js`

**Interfaces:** Consumes `MasteryModel`, `facts.js`, `strategies.js`, `CONFIG`.
Produces `pickLearnFacts(model, config)` and `buildLearnSession(facts, config)`.

- [ ] `pickLearnFacts` returns up to `config.learnFacts` facts, chosen as the
      coldest that **have strategy text** (`strategyFor(fact) !== null`). That
      filter is load-bearing: `0 ×` and `1 ×` facts have no route to teach, so
      the trivial facts cannot enter learn mode by construction. 78 of 121 are
      eligible.
- [ ] Ordering within equally-cold facts must be deterministic and documented —
      `allFacts()` order is fine. This module takes no randomness.
- [ ] Prefer facts that are `cold`; if fewer than `learnFacts` cold eligible
      facts exist, fall back to `warm`, then `hot`. Return fewer than
      `learnFacts` only when fewer eligible facts exist in total.
- [ ] `buildLearnSession(facts, config)` cycles them `config.learnPasses` times:
      `[A,B,C,A,B,C,A,B,C,A,B,C]`. **Cycled, not blocked-per-fact** — `A A A A B
      B B B` would let a kid coast on the previous answer.
- [ ] No success governor, no interleaving with mastered facts. Learn mode has no
      failure state (strategy visible, answer on a button), so there is nothing
      to protect against; padding would treat the wrong problem.
- [ ] Tests: returns exactly `learnFacts` when enough are eligible; never returns
      a fact without strategy text; never returns a `0 ×` or `1 ×` fact; prefers
      cold over warm over hot; is deterministic for the same model; session
      length is `learnFacts * learnPasses`; the cycle order is A B C A B C, not
      A A A A; returns fewer gracefully when eligibility is exhausted.
- [ ] Commit: "Add learn session builder"

---

## Task 6 — Problem screen: strip drill hints, build learn view

**Tests: none.** **Spec:** §1, §2, §3

**Files:** Modify `math-game/js/ui/problem.js`, `math-game/css/problem.css`,
`math-game/css/hints.css`

**Interfaces:** `renderProblem(container, state, mode)` gains mode. Adds
`onRevealClick(container, handler)`.

- [ ] **Drill renders no hint region at all.** Delete the strategy and blocks
      rendering from the drill path. The reserved 210px region collapses to
      nothing in drill — but the problem must still not shift vertically between
      the `clean` and `reveal` stages.
- [ ] **Learn renders strategy and blocks together, from the first frame.**
      Strategy text always (learn facts always have it); block array alongside
      when `blocksApply(fact, config)`. Side by side rather than stacked, so both
      fit without a tall region.
- [ ] Learn adds a **"Show me the answer"** button. Wire it through
      `onRevealClick(container, handler)` — do not have the UI call the engine
      directly; `main.js` owns state transitions.
- [ ] Hide the reveal button once `state.revealed` is true.
- [ ] At `reveal` in learn mode the answer appears greyed in the slots AND the
      strategy stays on screen. The answer must never appear without its
      derivation.
- [ ] Keep the wrong-answer pulse in both modes, including the identity guard: a
      no-op `tick` returns the same state object by reference, so animate on the
      transition (`next !== last && next.pulse`), never on every render.
- [ ] Do not reintroduce `opacity` on the revealed slot — it computed to 1.79:1
      and made the hint of last resort the least readable thing on screen.
- [ ] Verify by playing both modes. No DOM tests.
- [ ] Commit: "Strip hints from drill, add learn view with reveal button"

---

## Task 7 — Results screen: continuation buttons and the fourth state

**Tests: none.** **Spec:** §6, §8

**Files:** Modify `math-game/js/ui/results.js`, `math-game/css/results.css`

**Interfaces:** `renderResults(container, model, summary)` — same signature,
`summary` now carries `mode` and `canLearn`. Adds
`onResultsAction(container, handler)` where handler receives
`'learn' | 'drill' | 'done'`.

- [ ] Add the button row: `[ Learn 3 facts ] [ Drill 20 ] [ Done ]`. Both
      continuations appear after BOTH modes — the results screen is a hub, not a
      terminus.
- [ ] Hide the Learn button when `summary.canLearn` is false.
- [ ] Wire through `onResultsAction`; do not navigate or reload from inside the
      renderer.
- [ ] Add the **"shown how"** state to the grid: a fact that is `cold` AND
      `taught` renders distinctly from `cold` and untaught. Four states now:
      not started / shown how / getting there / from memory. Keep the redundant
      non-colour cue per state — the existing dashed/solid/filled scheme plus one
      more distinguishable treatment.
- [ ] `bucket` in the model is still `cold|warm|hot`. "Shown how" is a DISPLAY
      state derived from `bucket === 'cold' && taught`. Do not add a fourth
      bucket to the mastery model.
- [ ] Update the legend and the cold-count headline to account for four states.
- [ ] Keep every v1 non-goal: no speed score, no comparison to anyone but the
      kid's own previous session, no clock.
- [ ] Verify by playing. No DOM tests.
- [ ] Commit: "Add continuation buttons and the shown-how grid state"

---

## Task 8 — Wiring: mode routing and two session loops

**Tests: none — verified by playing.** **Spec:** §1, §4, §7, §8
**Depends on:** all prior tasks

**Files:** Modify `math-game/js/main.js`

- [ ] Read mode from `?mode=` on the URL, falling back to `CONFIG.mode`. Accept
      only `'drill'` and `'learn'`; anything else falls back.
- [ ] **Drill loop:** unchanged from v1 except `ladderFor(fact, CONFIG, 'drill')`
      and `toAttemptEvent(..., 'drill')`. Keep re-deriving mastery after every
      completed problem — the success governor is scored against the model's
      attempts, and with a stale model it reads yesterday's outcomes as today's.
      Measured: a stale model fires the governor on 1% of picks, a re-derived one
      on 100%.
- [ ] **Learn loop:** `pickLearnFacts` → `buildLearnSession` → run each item with
      NO tick loop and NO delay. The rAF loop must not advance stages in learn
      mode. Wire the reveal button to `revealAnswer`.
- [ ] Build `SessionSummary` with `mode` and `canLearn`. `canLearn` is true when
      any strategy-bearing fact is not yet `hot`.
- [ ] Wire `onResultsAction`: `'learn'` and `'drill'` start a new session in that
      mode **without a page reload**, resetting progress and re-deriving mastery
      from the log plus this sitting's attempts. `'done'` returns to
      `games-menu.html`.
- [ ] `now` is epoch milliseconds. `Date.now()` and `Math.random()` appear here
      and nowhere else in `math-game/js/`.
- [ ] Never clone or re-wrap ProblemState before passing it to `renderProblem` —
      the pulse guard keys on object identity.
- [ ] Play both modes end to end. Confirm the log gains well-formed lines with
      `mode` set correctly, `revealed` present only on learn attempts, and
      `stage: 'clean'` never appearing on a learn attempt.
- [ ] `git checkout data/math-log.jsonl` before committing.
- [ ] Commit: "Wire mode routing and the learn session loop"

---

## Task 9 — Two menu cards

**Tests: none.** **Spec:** §7

**Files:** Modify `games-menu.html`

- [ ] Replace the single Math Facts card with two, matching existing card markup
      exactly: **Learn Numbers** → `math-game/index.html?mode=learn`, and
      **Drill Numbers** → `math-game/index.html?mode=drill`.
- [ ] Copy must not describe them as difficulty levels. They are different
      activities — one teaches a method, the other builds speed at methods
      already known. Do not promise timing or speed in either.
- [ ] Do not touch the Typing Game card.
- [ ] Load the menu through the server and confirm both links resolve and start
      in the correct mode.
- [ ] Commit: "Add Learn and Drill cards to the menu"

---

## Definition of Done

- `node --test` from repo root is green, no regressions against the 217 baseline.
- Both menu cards load and start in the correct mode.
- A drill session shows no hints at any point and reveals the answer on the timer.
- A learn session shows strategy from the first frame, never advances on a timer,
  and reveals only on the button.
- The results screen offers both continuations and they work without a reload.
- `grep -rE "Date\.now|Math\.random" math-game/js/` matches only `main.js`.
- `data/math-log.jsonl` is unchanged in the final commit.
