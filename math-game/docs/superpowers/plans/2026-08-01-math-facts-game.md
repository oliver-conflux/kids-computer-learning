# Math Facts Game — Implementation Plan

> **For agentic workers:** This plan is executed by an **agent team**, not by the
> superpowers execution skills. Superpowers is explicitly **off** for subagents on
> this project. Each task below is self-contained; the Shared Contracts section is
> normative and must not be reinterpreted. If a contract seems wrong or
> insufficient, **message the lead and ask** — do not invent a variant.

**Goal:** A multiplication-fact fluency drill for a 10-year-old, built around
latency as the primary signal, with a durable append-only log we can analyse.

**Architecture:** Vanilla ES modules served over localhost by a ~60-line
dependency-free node server. A pure core (`facts`, `mastery`, `scheduler`,
`hints`, `engine`) takes no DOM, no network, and no clock. `data/math-log.jsonl`
is the single source of truth; everything else is derived on read.

**Tech Stack:** Node 22 (server + `node --test`), vanilla ES modules, no build
step, no dependencies.

**Spec:** `math-game/docs/superpowers/specs/2026-08-01-math-facts-game-design.md`
— the spec is the authority on *why*; this plan is the authority on *what to
build*. Read the spec section referenced by your task before starting.

---

## Global Constraints

- **Zero runtime dependencies.** No npm install, no `package.json` requirement,
  no CDN links. Node built-ins only.
- **ES modules** (`import`/`export`) throughout. No `window.*` globals, no
  classic script tags.
- **Node 22+.** Use `node:` prefixed built-ins. Run tests with **bare
  `node --test` from the repo root** — it auto-discovers `*.test.js`. Do not pass
  a directory path: Node 22.18 treats `--test` positional args as glob patterns,
  so `node --test math-game/tests/` fails with `MODULE_NOT_FOUND`. The quoted
  glob `node --test 'math-game/tests/*.test.js'` also works if you need to scope.
- **The pure core takes no clock.** `mastery`, `scheduler`, `hints`, `engine`,
  and `facts` never call `Date.now()`, `Math.random()` directly, or touch the
  DOM. Time comes in as a `now` parameter; randomness comes in as an injected
  `rng`. This is what makes `tools/replay.js` possible and it is not negotiable.
- **No displayed countdown, timer bar, or clock** anywhere in the UI.
- **Palette and fonts** come from `typing-game/design/README.md`: page `#eef0f3`,
  accent `#7b6bd6`, heading `#2f3742`, muted `#7b8493`, error fill `#f4c9c2`,
  error text `#d98a7d`. Fonts Baloo 2 (display) and Nunito (UI).
- **Testing policy — this is a spike.** Write real tests for the pure logic
  modules and the server's safety behaviour. Write **no tests** for DOM
  rendering, CSS, or wiring. Task headers state which applies; do not add tests
  to a task marked no-tests.
- **Commit at the end of each task**, one commit per task, present-tense summary.
- **Timestamps are UTC `Z`-suffixed ISO 8601, always.** `mastery.js` sorts events
  by comparing `t` as a plain string, which is correct only while every writer
  emits the fixed `toISOString()` format. A single writer emitting an offset like
  `+05:00` makes lexicographic order stop matching chronological order, silently
  reintroducing a defect already fixed once. This is a rule on writers, not a
  date parser on the reader.
- **`now` is epoch milliseconds everywhere.** Never a monotonic
  high-resolution timer. `toAttemptEvent` builds `t` from `resolvedAt` as a real
  date, so a monotonic clock yields 1970 timestamps while `ms` still looks
  correct — nothing throws and no test fails.
- **Worktree base.** Agent worktrees may be cut from a stale commit that predates
  the spec and plan. Before starting, verify `math-game/docs/` exists in your
  worktree; if it does not, run `git merge math-facts-game` to bring the branch
  to the current tip.
- **Purity grep hygiene.** The project DoD greps `math-game/js/` for `Date.now`
  and `Math.random` and expects matches only in `main.js` and `log.js`. Do not
  write those literal strings in comments in pure modules — say "no clock, no
  randomness" instead, or the grep reports a false positive.
- **`allFacts()` order** is row-major with `index === a * 11 + b`; `[0]` is `0×0`
  and `[120]` is `10×10`. Prefer keying by `factId` over relying on that
  arithmetic.
- **`parseFactId` throws** on malformed input rather than returning null, and
  accepts any non-`:` op token so the four-operation extension needs no change.

---

## Shared Contracts

**Normative.** Every task depends on these exact names and shapes. Do not rename,
do not add fields, do not change types. If something is missing, ask the lead.

### Fact identity

```
Fact   = { op: '*', a: number, b: number }     // a and b each 0..10, ORDERED
FactId = string                                 // `${op}:${a}x${b}`  e.g. "*:6x7"
```

`6 × 7` and `7 × 6` are **two different facts with two different ids.** Nothing
in this codebase merges them. See spec §1.

### Config — the single tunables table

Lives in `js/config.js`, exported as `CONFIG`. Every magic number in the system
lives here and nowhere else.

```
CONFIG = {
  build:            'm1',        // bump when scheduling/timing behaviour changes
  sessionLength:    20,
  retain:           5,           // attempts kept per fact for mastery
  hotMs:            1500,        // median clean latency below this => hot
  delays:           { cold: 2000, warm: 4000, hot: 6000 },   // ms per hint stage
  weights:          { cold: 6,    warm: 3,    hot: 1 },      // sampling weight
  noRepeatWithin:   4,
  governorWindow:   8,
  governorFloor:    0.8,
  blocksMaxProduct: 25,
  logTail:          2000,
}
```

### Log events

Two line types in `data/math-log.jsonl`. Field names are exact.

```
AttemptEvent = {
  type: 'attempt',
  t: string,            // ISO 8601
  build: string,
  session: string,      // 's_' + 4 hex chars
  op: '*', a: number, b: number,
  ms: number,           // problem shown -> correct answer landed
  stage: Stage,         // furthest hint stage reached
  typed: string[],      // every intermediate string, in order
  wrong: number[],      // completed wrong answers
}

SessionEvent = {
  type: 'session',
  t: string, build: string, session: string,
  items: number, cleanRate: number, medianMs: number,
}

Event = AttemptEvent | SessionEvent
```

### Session summary

Built by T10 at session end, consumed by T9 for the results screen. Distinct from
`SessionEvent` — this one carries the bucket movements, which are display-only and
never written to the log because they are derivable.

```
SessionSummary = {
  session: string,
  items: number,             // problems completed
  cleanRate: number,         // 0..1, share resolved at the 'clean' stage
  medianMs: number,          // median across all problems this session
  previousMedianMs: number | null,  // last session's medianMs; null on first run
  moved: BucketMove[],       // facts whose bucket changed during this session
}
BucketMove = { id: FactId, from: Bucket, to: Bucket }
```

`previousMedianMs` is the only comparison the results screen is allowed to make.
Spec §11 calls for it and the design depends on it: "typical time 2.7s" is
meaningless to a kid without a reference point, and the only permitted reference
point is their own previous session — never another person, never a target.
T10 recovers it from the loaded log by taking the `medianMs` of the most recent
`SessionEvent` preceding this session, and passes `null` on a first run.

### Stages and buckets

```
Stage  = 'clean' | 'strategy' | 'blocks' | 'reveal'   // ladder order
Bucket = 'cold' | 'warm' | 'hot'
```

"**Clean**" always means: the correct answer landed while `stage === 'clean'`,
before any hint fired. It is the only evidence of retrieval.

### Module surfaces

Each is the complete public API of its file. Nothing else is exported.

```
// js/facts.js
allFacts()                 -> Fact[]           // 121 facts, stable order
factId(fact)               -> FactId
parseFactId(id)            -> Fact
answerOf(fact)             -> number
answerDigits(fact)         -> number           // 1, 2, or 3
transposeId(fact)          -> FactId           // "*:7x6" for 6x7

// js/mastery.js
deriveMastery(events, config)     -> MasteryModel
compareTimestamps(left, right)    -> number   // sort comparator, exported

// `compareTimestamps` is exported only so tools/replay.js can walk events in
// exactly the order deriveMastery folds them. A private copy in each would
// diverge silently and the replay would then simulate a different scheduler
// than the one that ran — the same failure mode as two hand-written PRNGs.

MasteryModel = {
  byId: Map<FactId, FactStats>,          // every one of the 121 facts present
  confusions: Map<FactId, Set<number>>,  // wrong answers ever given for that fact
}
FactStats = {
  id: FactId, fact: Fact, bucket: Bucket,
  attempts: Attempt[],          // most recent last, at most config.retain
  cleanCount: number,
  medianCleanMs: number | null, // null when cleanCount === 0
}
Attempt = { ms: number, stage: Stage, wrong: number[] }

// js/scheduler.js
pickNext(model, history, config, rng) -> Fact
// history: FactId[] served this session, most recent LAST. May be empty.
// rng: () => number in [0,1). Injected — never Math.random() inside.

// js/hints.js
ladderFor(fact, config)        -> Stage[]   // always starts 'clean', ends 'reveal'
delayMsFor(bucket, config)     -> number
nextStage(ladder, current)     -> Stage | null   // null when already at last

// js/strategies.js
strategyFor(fact) -> string | null   // null means the 'strategy' stage does not apply

// js/engine.js
startProblem(fact, ladder, now)        -> ProblemState
typeDigit(state, digit, now)           -> ProblemState   // digit is '0'..'9'
backspace(state, now)                  -> ProblemState
tick(state, now, delayMs)              -> ProblemState   // advances stage on time
toAttemptEvent(state, config, session) -> AttemptEvent

ProblemState = {
  fact: Fact, ladder: Stage[], stage: Stage,
  typed: string,          // current digits, may be ''
  history: string[],      // every intermediate value of `typed`
  wrong: number[],        // completed wrong answers so far
  startedAt: number, stageAt: number,   // stageAt = when current stage began
  resolvedAt: number | null,
  status: 'active' | 'correct',
  pulse: boolean,         // true for one transition after a wrong answer
}

// js/log.js  (impure — network + localStorage)
loadEvents(tail)   -> Promise<Event[]>
record(event)      -> void     // fire-and-forget; queues to outbox on failure
flushOutbox()      -> Promise<void>
```

### Server API

```
GET  /*                  -> static file from repo root
GET  /api/log?tail=N     -> 200 { events: Event[] }   // last N lines, N defaults to 2000
POST /api/log            -> 204                        // body is one Event, appended
```

---

## File Structure

```
kids-computer-learning/
  play.command                    T2   launcher
  server/serve.js                 T2   static + /api/log
  data/math-log.jsonl             T2   the record (committed)
  games-menu.html                 T12  add card, remove dead links
  tools/replay.js                 T11  offline scheduler comparison
  math-game/
    index.html                    T8
    css/
      base.css                    T8   palette, fonts, reset
      layout.css                  T8   shell, progress bar
      problem.css                 T8   numerals, slots, pulse
      hints.css                   T8   strategy text, blocks, reveal
      results.css                 T9   grid, summary
    js/
      config.js                   T1
      facts.js                    T1
      strategies.js               T4
      mastery.js                  T3   pure
      scheduler.js                T6   pure
      hints.js                    T4   pure
      engine.js                   T5   pure
      log.js                      T7
      ui/problem.js               T8
      ui/results.js               T9
      main.js                     T10  wiring
    tests/
      facts.test.js               T1
      mastery.test.js             T3
      hints.test.js               T4
      engine.test.js              T5
      scheduler.test.js           T6
      server.test.js              T2
```

**Note on a deviation from the spec:** spec §12 lists a single `ui.js`. This plan
splits it into `ui/problem.js` and `ui/results.js` so two agents can work without
colliding, and because they have genuinely different jobs. No other structural
change.

---

## Execution Waves

Tasks within a wave are independent and run in parallel. A wave starts only when
the previous one is complete and reviewed.

| Wave | Tasks | Notes |
|---|---|---|
| 0 | T1 | Blocking. Everything imports it. |
| 1 | T2, T3, T4, T5 | Fully parallel. |
| 2 | T6, T7 | T6 needs T3's model; T7 needs T2's API. |
| 3 | T8, T9 | Both consume contracts only, not each other. |
| 4 | T10 | Wiring. Needs everything. |
| 5 | T11, T12 | Independent cleanup and tooling. |

---

## Task 1 — Contracts and fact space

**Tests: yes (light).** **Spec:** §1

**Files:** Create `math-game/js/config.js`, `math-game/js/facts.js`,
`math-game/tests/facts.test.js`

**Interfaces:** Produces `CONFIG` and the entire `js/facts.js` surface exactly as
given in Shared Contracts. Consumes nothing.

- [ ] Create `config.js` exporting `CONFIG` with the exact keys and values from
      the Shared Contracts table. No other exports.
- [ ] Create `facts.js` implementing the six exported functions. `allFacts()`
      returns all 121 ordered pairs for operands 0–10 in a stable, documented
      order. `answerDigits` returns the digit count of the product.
- [ ] Write tests covering: exactly 121 facts, no duplicate ids, `factId` and
      `parseFactId` round-trip for every fact,
      `transposeId({op:'*',a:6,b:7}) === '*:7x6'` — note `transposeId` takes a
      **Fact object**, not an id string, per Shared Contracts — and
      `answerDigits` is 1 for `2×2`, 2 for `6×7`, 3 for `10×10`.
- [ ] Run `node --test` (bare, from the repo root) and confirm green.
- [ ] Commit.

---

## Task 2 — Server and launcher

**Tests: yes — safety behaviour only.** **Spec:** §9

**Files:** Create `server/serve.js`, `play.command`, `data/math-log.jsonl` (empty),
`math-game/tests/server.test.js`

**Interfaces:** Produces the Server API exactly as given. T7 consumes it.

- [ ] Write `serve.js` using only `node:http`, `node:fs`, `node:path`, `node:url`.
      Serve static files from the repo root with correct MIME types for
      `.html/.css/.js/.json/.jsonl/.svg/.png`.
- [ ] Implement `GET /api/log?tail=N` returning `{ events }` — parse each line,
      skip malformed lines rather than throwing. Default `N` to 2000.
- [ ] Implement `POST /api/log` — validate the body parses as JSON and has a
      `type` field, append one line, respond 204. Reject anything else with 400.
- [ ] Bind to `127.0.0.1` only. Not `0.0.0.0`. This is a hard requirement.
- [ ] Resolve every requested path and verify it is inside the repo root before
      reading. Reject traversal with 403.
- [ ] Write `play.command`, `chmod +x`: `cd` to its own directory, check whether
      port 8777 is already serving, start the server only if not, then
      `open http://localhost:8777/games-menu.html`.
- [ ] Create `data/math-log.jsonl` as an empty file and commit it. **Do not add
      it to `.gitignore`** — the log is committed deliberately so that "what did
      this look like before we retuned the scheduler" is a `git show` (spec §14).
- [ ] Write tests: a `../../etc/passwd`-style path is rejected; a POST appends
      exactly one line; `tail` returns the last N and tolerates a malformed line
      mid-file. Start the server on an ephemeral port inside the test.
- [ ] Run the tests, confirm green, and manually confirm `play.command` opens a
      browser.
- [ ] Commit.

---

## Task 3 — Mastery derivation

**Tests: yes — thorough. This is core logic.** **Spec:** §6

**Files:** Create `math-game/js/mastery.js`, `math-game/tests/mastery.test.js`

**Interfaces:** Consumes `facts.js` and `CONFIG`. Produces `deriveMastery` and the
`MasteryModel` / `FactStats` / `Attempt` shapes exactly as given. T6 and T9
consume the model.

- [ ] Implement `deriveMastery(events, config)`. Filter to `type === 'attempt'`,
      group by `factId`, keep the last `config.retain` attempts per fact.
- [ ] Every one of the 121 facts must appear in `byId`, including facts with zero
      attempts — those are `cold` with `cleanCount: 0` and `medianCleanMs: null`.
      Downstream code must never have to handle a missing key.
- [ ] Compute buckets per spec §6: `cold` = no clean attempts; `warm` = ≥1 clean
      but median clean latency ≥ `hotMs`; `hot` = ≥3 clean and median <  `hotMs`.
- [ ] Build `confusions` from **all** attempt events passed in, not just the
      retained window — see spec §6. Each entry is the set of wrong answers ever
      completed for that fact.
- [ ] Write tests: the three bucket boundaries including exactly-at-threshold
      cases; median with even and odd counts; a fact with only hinted attempts
      stays cold no matter how fast; retention keeps the *most recent* 5;
      confusions survive beyond the retain window; `6×7` and `7×6` produce
      independent stats from the same event list; deriving twice from the same
      events gives a deep-equal result.
- [ ] Run tests, confirm green.
- [ ] Commit.

---

## Task 4 — Hint ladder and strategies

**Tests: yes — thorough.** **Spec:** §5

**Files:** Create `math-game/js/hints.js`, `math-game/js/strategies.js`,
`math-game/tests/hints.test.js`

**Interfaces:** Consumes `facts.js` and `CONFIG`. Produces `ladderFor`,
`delayMsFor`, `nextStage`, `strategyFor`. T5 and T8 consume these.

- [ ] Implement `strategyFor(fact)` returning short kid-facing text, or `null`
      when no strategy applies. Cover at minimum: doubling for `×2`, half-of-ten
      for `×5`, ten-minus-one for `×9`, near-square for the hard middle facts
      (`6×7`, `6×8`, `7×8`, `7×9`, `8×9`). Trivial facts (`×0`, `×1`) return
      `null`. Keep each string under about 40 characters.
- [ ] Implement `ladderFor(fact, config)`: always begins `'clean'`, always ends
      `'reveal'`. Include `'strategy'` only when `strategyFor` is non-null.
      Include `'blocks'` only when the product is ≤ `config.blocksMaxProduct`.
      Order is always clean → strategy → blocks → reveal, minus omitted stages.
- [ ] Implement `delayMsFor(bucket, config)` from `config.delays`.
- [ ] Implement `nextStage(ladder, current)` returning the following stage, or
      `null` at the end of the ladder.
- [ ] Write tests: the ladder for `6×7` is exactly `['clean','strategy','reveal']`;
      for `2×3` it includes `'blocks'`; `'blocks'` never appears when the product
      exceeds 25; `'reveal'` is always last and `'clean'` always first.
      **Explicitly assert that `delayMsFor('hot') > delayMsFor('cold')`** — the
      delay grows with mastery, and this is the rule most likely to be silently
      reverted (spec §5).
- [ ] Run tests, confirm green.
- [ ] Commit.

---

## Task 5 — Problem engine

**Tests: yes — thorough. This is the trickiest logic in the system.** **Spec:** §3, §4

**Files:** Create `math-game/js/engine.js`, `math-game/tests/engine.test.js`

**Interfaces:** Consumes `facts.js`. Produces the `ProblemState` shape and the
five engine functions exactly as given. T8 and T10 consume them.

- [ ] Implement the five functions as **pure** transitions — each returns a new
      state object, never mutates its input, and never reads a clock.
- [ ] `typeDigit` appends a digit and pushes the new value onto `history`. When
      `typed.length` reaches `answerDigits(fact)`, evaluate: matching the answer
      sets `status: 'correct'` and `resolvedAt: now`; not matching records the
      value in `wrong`, clears `typed`, sets `pulse: true`, and **advances the
      stage exactly one step**. A shorter string never evaluates.
- [ ] `tick(state, now, delayMs)` advances one stage when `now - stageAt >=
      delayMs` and the ladder has a next stage; otherwise returns the state
      unchanged. At the final stage it never advances further.
- [ ] `toAttemptEvent` builds an `AttemptEvent` with `ms = resolvedAt -
      startedAt` and `stage` set to the furthest stage reached.
- [ ] Write tests: `48` for `42` evaluates wrong; `4` alone does not evaluate;
      typing `4` then `2` for `42` resolves correct; a wrong answer advances the
      ladder exactly one stage — not zero, not two; a wrong answer at the final
      stage does not advance past the end; backspace removes one digit and
      records history; `tick` is a no-op before the delay elapses; `history`
      captures every intermediate string including ones later cleared; the
      1-digit case (`2×2`) and 3-digit case (`10×10`) both evaluate at the right
      length; no function mutates the state passed to it.
- [ ] Run tests, confirm green.
- [ ] Commit.

---

## Task 6 — Scheduler

**Tests: yes — thorough. This is the heart of the system.** **Spec:** §7
**Depends on:** T3

**Files:** Create `math-game/js/scheduler.js`, `math-game/tests/scheduler.test.js`

**Interfaces:** Consumes `MasteryModel` from T3, `facts.js`, `CONFIG`. Produces
`pickNext(model, history, config, rng)`.

- [ ] Implement weighted sampling over all 121 facts using `config.weights` by
      bucket, drawing from the injected `rng` — never `Math.random()`.
- [ ] Apply the three constraints from spec §7 in order: no repeat within
      `config.noRepeatWithin`, **and that exclusion includes the transpose id**;
      no live confusion pair adjacent while either fact is cold; and the success
      governor — over the last `config.governorWindow` items, if the clean rate
      is below `config.governorFloor`, force a `hot` fact.
- [ ] The governor needs recent outcomes, which `history` (ids only) does not
      carry. Derive the clean rate from the model's retained attempts for the
      ids in the current history window. Document this in a comment.
- [ ] Never return `undefined`. If constraints eliminate every candidate, relax
      them in the documented order — governor first, then confusion, then
      no-repeat — and comment why.
- [ ] Write tests with a seeded deterministic `rng`: cold facts are sampled more
      often than hot over many draws; a fact in the last 4 is never returned;
      **the transpose of a fact in the last 4 is never returned**; a confusion
      pair is not served adjacently while one is cold, but is allowed once both
      are warm; the governor injects a hot fact when the recent clean rate is
      below the floor; `pickNext` always returns a valid `Fact` even when the
      history is saturated.
- [ ] Run tests, confirm green.
- [ ] Commit.

---

## Task 7 — Log client

**Tests: light — queueing behaviour only.** **Spec:** §8, §9
**Depends on:** T2

**Files:** Create `math-game/js/log.js`

**Interfaces:** Consumes the Server API from T2. Produces `loadEvents`, `record`,
`flushOutbox`. T10 consumes them.

- [ ] `loadEvents(tail)` fetches `GET /api/log?tail=N` and returns the events
      array. On failure, resolve to `[]` rather than rejecting — a missing log is
      a first run, not an error.
- [ ] `record(event)` fires `POST /api/log` **without awaiting**. The caller
      never blocks. On failure, push the event onto a localStorage outbox under
      key `kct.math.outbox.v1`.
- [ ] `flushOutbox()` re-posts queued events oldest-first and clears each on
      success. Called once at startup.
- [ ] The outbox holds only un-acknowledged events and is normally empty. It is
      not a second store — never read game state from it.
- [ ] Write one light test for outbox round-trip with a stubbed `fetch`. No
      network tests.
- [ ] Commit.

---

## Task 8 — App shell and problem screen

**Tests: none.** **Spec:** §3, §4, §5, §10

**Files:** Create `math-game/index.html`, `math-game/css/base.css`,
`math-game/css/layout.css`, `math-game/css/problem.css`,
`math-game/css/hints.css`, `math-game/js/ui/problem.js`

**Interfaces:** Consumes `ProblemState` from T5 and `strategyFor` from T4.
Produces `renderProblem(container, state)`, `mountProblemScreen(container)`, and
`renderProgress(container, done, total)`. Rendering is a pure function of state —
the module holds no game state of its own.

`renderProgress` exists because the "7 / 20" counter is genuinely not derivable
from `ProblemState`, which carries no session index. The alternative — T10
reaching into T8's markup by element id — would make the interface between the
two an undocumented pair of DOM ids that breaks silently on rename. An explicit
export keeps DOM knowledge inside the module that owns it. T8 must state in its
handoff whether `done` is the completed count or the 1-based index of the current
problem; they differ by one.

- [ ] Build `index.html` as the shell: progress bar, problem region, reserved
      hint region. Load `js/main.js` as `type="module"`.
- [ ] `base.css` — reset, the palette as CSS custom properties, Baloo 2 and
      Nunito. Use the exact hex values from Global Constraints.
- [ ] Render the problem with the numerals as by far the largest element on
      screen, and one answer slot per `answerDigits(fact)`, filling left to right.
- [ ] Render each hint stage: `strategy` shows the text; `blocks` draws the array
      as an `a × b` grid of squares; `reveal` shows the answer **greyed inside
      the slots**, not elsewhere on screen.
- [ ] The hint region is reserved space so the layout never jumps when a stage
      fires.
- [ ] Wrong answer: pulse the slots with error fill `#f4c9c2` and text `#d98a7d`
      for ~400ms, then clear. Same warm tone as the typing game's wrong-key flash.
- [ ] No countdown, no timer bar, no elapsed time displayed anywhere.
- [ ] Verify by playing it. Do not write DOM tests.
- [ ] Commit.

---

## Task 9 — Results screen and grid

**Tests: none.** **Spec:** §11

**Files:** Create `math-game/js/ui/results.js`, `math-game/css/results.css`

**Interfaces:** Consumes `MasteryModel` from T3, `facts.js`, and the
`SessionSummary` shape from Shared Contracts. Produces
`renderResults(container, model, summary)`.

- [ ] Render the **11 × 11 grid**, operands 0–10 on each axis, 121 cells, each
      coloured by bucket. **The grid is not symmetric** — `6×7` and `7×6` are
      separate cells and may differ. That asymmetry is the point (spec §11).
- [ ] Label the axes so a cell is identifiable at a glance.
- [ ] Clicking a cell shows that fact's history: recent latencies, hint stages,
      and wrong answers given.
- [ ] Show the session summary from `summary`: `items`, `cleanRate`, `medianMs`,
      and the `moved` list rendered as which facts changed bucket this session.
- [ ] **No speed score, no WPM-equivalent, no comparison to anyone.** The only
      reference point is the kid's own previous median.
- [ ] Verify by playing it. Do not write DOM tests.
- [ ] Commit.

---

## Task 10 — Wiring

**Tests: none — verified by playing.** **Spec:** §2, §3, §8
**Depends on:** all prior tasks

**Files:** Create `math-game/js/main.js`

**Interfaces:** Consumes every module. Produces nothing others import.

- [ ] On load: `flushOutbox()`, then `loadEvents(CONFIG.logTail)`, then
      `deriveMastery`. Generate a session id as `'s_' + 4 hex chars`.
- [ ] Run the session loop for `CONFIG.sessionLength` problems: `pickNext` →
      `ladderFor` → `startProblem` → render.
- [ ] **Re-derive the mastery model after every completed problem**, from the
      loaded tail plus this session's attempt events so far. Do not reuse the
      session-start model. This is a hard requirement, not an optimisation
      question, and it fails silently if ignored.

      Verified by execution: the success governor recovers the recent clean rate
      from `model.byId` attempts, because `history` carries only fact ids. Given
      a history of eight facts the model knows were answered at the `reveal`
      stage, `pickNext` returns a `hot` fact on 20 of 20 draws — the governor
      fires. Given the identical history and a model that has not seen those
      attempts, it returns a `cold` fact on 20 of 20 draws. Nothing throws and
      nothing logs a warning; the 80%-success floor simply does not exist, and a
      struggling kid receives twenty consecutive cold facts — precisely the bad
      night the governor was designed to prevent.

      Re-deriving 121 facts from a 2000-line tail between problems is cheap
      relative to a kid typing an answer. Do it every problem.
- [ ] This module owns the clock and the randomness. It passes `now` and `rng`
      into the pure modules. `Date.now()` and `Math.random()` appear here and in
      `log.js` and nowhere else in `math-game/js/`.
- [ ] Drive `tick` from a `requestAnimationFrame` or interval loop so hint stages
      fire on time, and keep the render a pure function of the current state.
- [ ] Bind keyboard input: digits `0`–`9` to `typeDigit`, Backspace to
      `backspace`. Ignore everything else. Input is live from the moment the
      problem appears — there is no submit key.
- [ ] **Two different things are called `typed`.** `ProblemState.typed` is a
      **string** (the digits currently in the box); `AttemptEvent.typed` is a
      **string[]** (every intermediate value, which is `state.history`). Both are
      correct per contract and both are named `typed`. Do not pass one where the
      other belongs — it will not throw, it will just write a malformed log line
      that the server happily accepts, since it validates only that `type` is a
      non-empty string.
- [ ] On each correct answer: `record(toAttemptEvent(...))`, then advance.
- [ ] Snapshot each fact's bucket at session start so bucket movement can be
      computed at the end. Re-derive mastery from the session's attempts and diff
      against the snapshot to build `moved: BucketMove[]`.
- [ ] At session end: `record` the `SessionEvent`, build the `SessionSummary`
      (which carries `moved`; the logged `SessionEvent` does not), and pass it to
      `renderResults`.
- [ ] Play a full session end to end. Confirm `data/math-log.jsonl` has 21 new
      lines — 20 attempts and one session.
- [ ] Commit.

---

## Task 11 — Replay tool

**Tests: light.** **Spec:** §12

**Files:** Create `tools/replay.js`

**Interfaces:** Consumes `mastery.js`, `scheduler.js`, `facts.js`.

- [ ] `node tools/replay.js data/math-log.jsonl [--build=X]` reads the log,
      derives mastery, and replays the scheduler over the recorded history with a
      seeded rng.
- [ ] Report per-fact serve counts under current config, so a config change can
      be compared against real history before shipping it to a kid.
- [ ] Support `--build=X` to filter events to one build tag.
- [ ] Write one test proving replay is deterministic for a fixed seed.
- [ ] Commit.

---

## Task 12 — Menu integration

**Tests: none.** **Spec:** §14

**Files:** Modify `games-menu.html`

- [ ] Add a Math Facts card linking to `math-game/index.html`, matching the
      existing card markup and styling.
- [ ] Remove the three dead cards — `math-for-kids/`, `Maths-Game-JS/`, and
      `simple-math-game.html`. None have ever pointed at a file.
- [ ] Remove the now-empty `blockly-games/`, `math-for-kids/`, and
      `Maths-Game-JS/` directories if they are still empty.
- [ ] Load the menu through the server and confirm every remaining link resolves.
- [ ] Commit.

---

## Definition of Done

- `node --test` (bare, from the repo root) is green.
- `play.command` opens the menu; both games are reachable and playable.
- A full 20-problem session appends 21 well-formed lines to
  `data/math-log.jsonl`.
- `grep -rE "Date\.now|Math\.random" math-game/js/` matches only `main.js` and
  `log.js`.
- No `node_modules`, no `package.json` dependency block, no CDN `<script>` or
  `<link>` to an external host.
