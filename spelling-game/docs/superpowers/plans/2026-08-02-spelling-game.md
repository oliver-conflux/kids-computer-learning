# Spelling game — implementation plan

**Spec:** `spelling-game/docs/superpowers/specs/2026-08-02-spelling-game-design.md`
**Branch:** `spelling-game`
**Execution model:** agent teams, wave-based, orchestrated. Not subagent-driven-development.

**Goal:** Build a spelling game for a 4–10 year old that teaches word patterns
and drills retrieval, on a shared engine extracted from the math game.

**Architecture:** Extract the math game's pure core into `core/`, parameterised
by an item-space adapter. The math game becomes its first consumer; the spelling
game becomes its second. Word difficulty and typing difficulty are separate
dials. The log is the single source of truth and everything derives on read.

**Tech stack:** Vanilla ES modules, zero dependencies, `node --test` (Node 22),
`node:http` static server on localhost.

---

## How this plan is executed

**Waves, not tasks.** Tasks inside a wave may run in parallel across a team.
Tasks in a later wave may not start until the previous wave's gate has passed.

**Review happens at wave boundaries, not per task.** A reviewer reads the whole
wave's diff against this plan and the spec.

**Gate A is the exception and is non-negotiable.** Wave 1 rewrites a game the
kids use daily, and an error there propagates into every later wave with
interest. It gets a dedicated code review before Wave 2 begins, even though it is
a single wave.

**On code samples:** this plan deliberately contains almost none. Implementers
are capable engineers who do not need to be taught to write JavaScript. What they
cannot infer, and what this plan therefore states exactly, is **interfaces**
(§Interface contracts) and **house conventions** (§Global constraints).

**On discovering patterns:** where this plan says *"follow the pattern in X"*, go
read X. That instruction is load-bearing. The single biggest risk in a
multi-agent build is three agents inventing three different idioms for the same
thing in three files. When in doubt, copy the existing house idiom rather than
your preferred one — and if the house idiom seems wrong, escalate rather than
quietly diverge.

**Escalate rather than comply.** If a task as written is wrong, blocked, or would
require breaking something in another file, stop and report. Do not make your own
task pass by damaging someone else's. `typing-game/docs/next-steps.md` records
that three of that build's four real defects were bugs in the *plan*, faithfully
implemented. This plan is not assumed correct.

**Verify by playing, not only by testing.** The same document records that every
DOM-layer bug in the typing build was invisible to 96 passing tests. An honest
"not verified" is more useful than an assumed pass.

---

## Global constraints

Every task inherits these. They are the house standards, drawn from the two
existing games.

- **Node 22, zero runtime and test dependencies.** `node --test` only. No
  frameworks, no bundler, no build step.
- **ES modules everywhere.** The server exists, so `file://` is not a constraint.
- **Pure modules take no DOM, no network, no clock, no randomness.** `now` is
  passed in as epoch milliseconds; randomness arrives as an injected `rng`. This
  is what makes `tools/replay.js` possible and it is the property most worth
  protecting.
- **`config` is always a parameter, never an import, in pure modules.** Same log
  must be replayable under a different tunables table.
- **Every quantity lives in a `CONFIG` table** and nowhere else. No magic numbers
  in logic files.
- **Timestamps are ISO 8601 UTC with `Z`.** They are compared as strings, never
  parsed. `now` is epoch milliseconds.
- **`build` is stamped on every logged event.** Spelling starts at `s1`. Bump it
  whenever weights, delays, or thresholds change.
- **A corrupt log line must never break a session.** Skip it silently.
- **Comments explain why, not what.** Match the density and voice of
  `math-game/js/mastery.js` — that file is the house style reference.
- **No countdown, timer bar, elapsed clock, speed score, streak, or comparison to
  anyone but the kid's own past self.** Both modes. This is a hard product rule
  in all three games.
- **The server binds `127.0.0.1` only** and resolves every path inside the repo
  root. Never `0.0.0.0`.
- **Refuse to start rather than play with nowhere to save.** Gate on
  `serverIsUp()`, per typing commit `8a3c2f2`.
- **One kid per machine.** No profiles, no profile picker.

---

## Read-first map

Before writing code in a given area, read the named file. This is how we avoid
three agents inventing three idioms.

| Working on | Read first | Why |
|---|---|---|
| anything pure | `math-game/js/mastery.js` | comment voice, JSDoc style, purity discipline |
| an item-space adapter | `math-game/js/facts.js` | id encoding, totality guarantees |
| scheduling | `math-game/js/scheduler.js` | constraint layering and ordering |
| input state machine | `math-game/js/engine.js` | immutable state transitions, `toAttemptEvent` |
| the log client | `typing-game/js/log.js` | outbox, failure model, `serverIsUp` |
| learn-mode session building | `math-game/js/learn.js` | blocked-cycle construction |
| any screen | `math-game/js/ui/problem.js` | mount/render split, reserved regions |
| results screens | `math-game/js/ui/results.js` | the results-as-hub pattern |
| the server | `server/serve.js` | allowlist, path resolution |
| curriculum content | `typing-game/js/content/home.js` | content-file authoring rules |
| keyboard/finger data | `typing-game/js/keymap.js` | `fingerFor`, `FINGER`, `ROWS` |

Two documents are required reading for every implementer, once:
`spelling-game/docs/.../2026-08-02-spelling-game-design.md` (the spec) and
`math-game/docs/superpowers/specs/2026-08-01-learn-and-drill-modes-design.md`
(why learn and drill are structured in opposition).

---

## Interface contracts

This is the coordination surface. Names and shapes here are fixed; anything not
listed is the implementer's choice.

### The item-space adapter — `core/space.js` defines the contract

Both games supply an object with these members. This is the entire seam between
the core and a game's content.

| member | type | math | spelling |
|---|---|---|---|
| `allItems()` | `() => Item[]` | 121 facts | the word spine |
| `itemId(item)` | `(Item) => string` | `"*:6:7"` | `"w:friend"` |
| `idFromEvent(event)` | `(object) => string \| null` | from `op,a,b` | from `word` |
| `isValidWrong(value)` | `(unknown) => boolean` | `Number.isFinite` | non-empty string |
| `relatedIds(id)` | `(string) => string[]` | `[transposeId]` | `[]` |

`relatedIds` generalises the math game's transpose guard: ids that must never be
served adjacent to this one. Spelling has no analogue and returns empty.

`idFromEvent` returns `null` for an event outside the item space, and callers
skip those.

### `core/mastery.js`

```
deriveMastery(events, config, space) -> { byId, confusions }
compareTimestamps(left, right)       -> number
```

- `config` reads `{ retain, hotMs, maxPlausibleMs }`.
- `byId: Map<string, ItemStats>` where `ItemStats` is
  `{ id, item, bucket, attempts, cleanCount, medianCleanMs, taught }`.
- `confusions: Map<string, Set<unknown>>` — values are whatever `isValidWrong`
  admits: numbers for math, strings for spelling.
- **Both maps stay total over `space.allItems()`** whatever the log contains.
- `bucket` is `'cold' | 'warm' | 'hot'`. Unchanged rules.
- Learn attempts are excluded from mastery evidence; confusions and `taught` are
  unwindowed. These behaviours already exist — preserve them exactly.

### `core/scheduler.js`

Core takes an **options object**; math's shim keeps the four positional
parameters its tests already use and adapts. This is why the shim pattern matters
— it lets the core signature grow without touching math's call sites.

```
pickNext({ model, history, config, rng, space, candidates, itemWeight }) -> string
```

- `candidates` — ids to sample from. **Defaults to every id in `model.byId`**,
  reproducing the math game's behaviour exactly. Spelling passes its active
  window.
- `itemWeight` — `(id) => number`, multiplied into the bucket weight.
  **Defaults to `() => 1`.** This is where spelling's second dial enters: it
  passes a function backed by `typingCost`. Math passes nothing.
- `config` reads `{ weights, noRepeatWithin, governorWindow, governorFloor }`.
- Constraint order is unchanged: no-repeat (including `relatedIds`), interference
  guard, success governor.

Math's shim: `pickNext(model, history, config, rng)` → calls core with
`{ model, history, config, rng, space: mathSpace }`.

### `core/engine.js`

Signatures preserved from `math-game/js/engine.js`, with `typeDigit` renamed to
the item-neutral `typeChar`:

```
startProblem(item, ladder, now)             -> ProblemState
typeChar(state, char, now)                  -> ProblemState
backspace(state, now)                       -> ProblemState
tick(state, now, delayMs)                   -> ProblemState
revealAnswer(state, now)                    -> ProblemState
toAttemptEvent(state, config, session, mode) -> object
```

State is immutable — every function returns a new state, never mutates.

### `core/log.js`

Built from `typing-game/js/log.js`, which is the better of the two existing
clients. Parameterised by game name:

```
createLogClient({ game, outboxKey, defaultTail }) -> {
  serverIsUp()        -> Promise<boolean>
  loadEvents(tail?)   -> Promise<object[]>
  record(event)       -> void          // fire and forget, never throws
  flushOutbox()       -> Promise<void>
}
```

Failure model, unchanged: `204`/ok is success; `4xx` is permanent and the event
is dropped; `5xx`/network is transient and the event is queued.

### Spelling's own pure modules

```
patternsFor(word)                       -> string[]        // never empty
activeWindow(spine, model, size)        -> string[]        // ids, spine order
typingCost(word, keymap, config)        -> number          // [floor, 1], never 0
pickLearnFamily(model, window, config)  -> { pattern, words }
buildLearnSession(words, config)        -> string[]        // ids, cycled
```

`typingCost` clamps its own result to `config.typingWeightFloor` rather than
leaving the clamp to callers — one place, config-driven, and it makes the
"never 0" guarantee structural rather than a convention each caller must honour.

### The two events

```json
{"type":"attempt","t":"…Z","build":"s1","session":"s_…","mode":"drill",
 "word":"friend","ms":5210,"stage":"clean","revealed":0,
 "typed":["freind","friend"],"wrong":["freind"],"patterns":["irregular"]}
```

```json
{"type":"session","t":"…Z","build":"s1","session":"s_…","mode":"drill",
 "items":20,"cleanRate":0.55,"medianMs":4820,"frontier":63}
```

`stage` is `'clean'` **iff** `revealed === 0`. Nothing else counts as retrieval.

`frontier` is the spine index the active window had reached — the single number
that answers "is she progressing?", and the reason the session event exists.

---

# Wave 1 — Extract the core

**Risk: high.** This rewrites a game in daily use. Nothing in Wave 2 may start
until Gate A passes.

**The governing rule for this entire wave:**

> **The math game's ten test files must pass completely unmodified.**
> `math-game/tests/{engine,facts,hints,learn,log,mastery,replay,scheduler,seams,server}.test.js`

That rule dictates the shape of the work: **each `math-game/js/` module becomes a
thin binding shim** that imports the core function and supplies math's space
adapter, re-exporting the same signature math's tests already call. Core takes
the wider signature; the shim narrows it. Do not change math's public API.

If a test cannot pass without modification, **stop and escalate.** That is the
signal the boundary is wrong, not an invitation to edit the test.

### Task 1.1 — The adapter contract and math's adapter

**Files:** create `core/space.js`, `math-game/js/space.js`

- [ ] Document the adapter contract in `core/space.js` — the five members, their
      types, and their invariants. This file is documentation and validation, not
      logic; it may export a `validateSpace(space)` used by tests.
- [ ] Implement math's adapter over the existing `facts.js` helpers. `relatedIds`
      returns the transpose id.
- [ ] Test: the adapter satisfies the contract; `allItems()` returns 121;
      `relatedIds('*:6:7')` contains `'*:7:6'`.
- [ ] Commit.

**Produces:** the `space` object every later core task consumes.

### Task 1.2 — `core/mastery.js`

**Files:** create `core/mastery.js`; modify `math-game/js/mastery.js` to a shim

- [ ] Move `deriveMastery` and `compareTimestamps` to core, adding the `space`
      parameter. Replace the `allFacts`/`factId` imports and the `op,a,b`
      extraction with adapter calls, and the `Number.isFinite` wrong-value filter
      with `space.isValidWrong`.
- [ ] Reduce `math-game/js/mastery.js` to a shim binding math's space.
- [ ] Preserve the three windows exactly: retain-windowed mastery, unwindowed
      confusions, unwindowed `taught`. Preserve the `maxPlausibleMs` guard.
- [ ] Run `math-game/tests/mastery.test.js` unmodified. Expect pass.
- [ ] Commit.

### Task 1.3 — `core/scheduler.js`

**Files:** create `core/scheduler.js`; modify `math-game/js/scheduler.js` to a shim

- [ ] Move `pickNext` to core with the `space` and `candidates` parameters.
      `candidates` defaults to all ids in `model.byId`.
- [ ] Replace the transpose lookup with `space.relatedIds`.
- [ ] Run `math-game/tests/scheduler.test.js` unmodified. Expect pass.
- [ ] Commit.

### Task 1.4 — `core/engine.js`

**Files:** create `core/engine.js`; modify `math-game/js/engine.js` to a shim

- [ ] Move the state machine to core. Rename `typeDigit` to `typeChar`; the shim
      re-exports it under the old name so math's tests are untouched.
- [ ] Keep state immutable and the terminal-condition logic identical.
- [ ] Run `math-game/tests/engine.test.js` and `seams.test.js` unmodified.
- [ ] Commit.

### Task 1.5 — `core/log.js`, and both games onto it

**Files:** create `core/log.js`; modify `math-game/js/log.js`,
`typing-game/js/log.js`

- [ ] Port `typing-game/js/log.js` into `core/log.js` as `createLogClient`.
- [ ] Point the math client at it with `game: 'math'`, outbox key
      `kct.math.outbox.v1`. **Math gains `serverIsUp()`**, which it currently
      lacks, and its URL becomes an explicit `?game=math` rather than relying on
      the server's `DEFAULT_GAME` fallback.
- [ ] Point the typing client at it with `game: 'typing'`, outbox key
      `kct.typing.outbox.v1`. Both existing outbox keys must be preserved
      byte-for-byte — changing one strands any queued events in a kid's browser.
- [ ] Run `math-game/tests/log.test.js` and the typing suite unmodified.
- [ ] Commit.

**Note:** the spec §15 said the typing game would be untouched. This task
deliberately includes it, because leaving a third copy of the same client is the
exact drift the extraction exists to prevent, and the change is mechanical.

### Task 1.6 — Config split

**Files:** modify `math-game/js/config.js`

- [ ] Document which keys are core-read (`retain`, `hotMs`, `maxPlausibleMs`,
      `delays`, `weights`, `noRepeatWithin`, `governorWindow`, `governorFloor`,
      `logTail`) and which are math's own. No key moves out of math's table;
      this is a documentation and grouping change so the spelling table can be
      written to match.
- [ ] Commit.

### Task 1.7 — Logs stop being tracked

**Files:** modify `.gitignore`; untrack `data/math-log.jsonl`

- [ ] Add `data/*.jsonl`, `data/audio/`, `data/words/`.
- [ ] `git rm --cached data/math-log.jsonl`. Note in the commit message that this
      reverses math spec §14 and that the file remains in existing history.
- [ ] Commit separately from all code changes.

---

## ▶ GATE A — dedicated code review

Not a wave review. A full review of the extraction alone, before any spelling
code is written.

- All ten math test files pass **unmodified** — verified by running them, with
  output shown, not asserted.
- The typing suite passes.
- No core module imports anything from `math-game/` or `typing-game/`.
- No core module touches DOM, network, `Date.now()`, or `Math.random()`.
- Both outbox keys unchanged.
- **Play the math game.** Both modes, a full session each. The tests did not
  catch the typing game's DOM bugs and will not catch these.

---

# Wave 2 — Spelling's pure core and data pipeline

All tasks are independent and parallelisable. None touch the DOM.

### Task 2.1 — The word spine

**Files:** create `spelling-game/js/spine.js`

- [ ] Hand-author the CVC opener, ~50 words, grouped in families from the first
      word. Do not source it from the typing game's rung lists — those are banded
      by keyboard availability, not phonics (spec §2).
- [ ] Append Fry 1000 in frequency rank order, Dolch membership as a flag.
- [ ] Committed source, not generated and not cached.
- [ ] Test: ordering is stable; no duplicates; every entry is lowercase a–z with
      no spaces or punctuation.
- [ ] Commit.

### Task 2.2 — Pattern rules

**Files:** create `spelling-game/js/patterns.js`

- [ ] Roughly 25 rules across rime families, structural patterns, vowel teams,
      r-controlled, and affixes (spec §4 has the table).
- [ ] `patternsFor(word)` is **total** — a word matching nothing is tagged
      `irregular`.
- [ ] Test: totality across the entire spine; known irregulars (`said`, `one`,
      `friend`, `could`) tag as `irregular`; `light`/`night`/`right` share a tag.
- [ ] Commit.

### Task 2.3 — The frontier

**Files:** create `spelling-game/js/frontier.js`

- [ ] `activeWindow(spine, model, size)` returns the first `size` ids in spine
      order that are not `hot`.
- [ ] Test — and this is the one that matters most: **a single permanently-cold
      word does not prevent the window advancing past it.** Also: an empty log
      yields the first `size` words; a fully-hot prefix slides the window forward.
- [ ] Commit.

### Task 2.4 — Typing cost

**Files:** create `spelling-game/js/typing-cost.js`

- [ ] `typingCost(word, keymap, config)` importing `typing-game/js/keymap.js`. Do
      not copy the finger data.
- [ ] Stage 1 only: same-finger bigrams, pinky reaches, row jumps, hand
      alternation. Stages 2 and 3 are out of scope (spec §3).
- [ ] Clamp the result to `config.typingWeightFloor`, so an awkward word is
      served a quarter as often rather than effectively never.
- [ ] Test: pure; **never returns 0**; never below the floor; a home-row word
      scores better than a pinky-heavy one; unmapped characters do not throw.
- [ ] Commit.

### Task 2.5 — The word adapter and config

**Files:** create `spelling-game/js/space.js`, `spelling-game/js/config.js`

- [ ] Adapter over the spine. `isValidWrong` admits non-empty strings;
      `relatedIds` returns `[]`.
- [ ] `CONFIG` exactly as spec §12, including `hotMs: 4000` — **not math's
      1500**, with the comment explaining why.
- [ ] Test: adapter satisfies `validateSpace`; totality over the spine.
- [ ] Commit.

### Task 2.6 — Learn session building

**Files:** create `spelling-game/js/learn.js`

- [ ] `pickLearnFamily(model, window, config)` — coldest family with at least one
      word in the active window. A family of one is skipped in favour of the
      next-coldest. Short families raise `learnPasses` to hold the item count
      steady (spec §6).
- [ ] `buildLearnSession(words, config)` cycles them, blocked — follow the
      pattern in `math-game/js/learn.js`.
- [ ] Test: never returns a single-word family; item count stays constant across
      family sizes; irregulars form a set without pretending to rhyme.
- [ ] Commit.

### Task 2.7 — The Merriam-Webster ingest

**Files:** create `tools/fetch-words.js`

- [ ] Key from `MW_KEY`. **Never commit a key.** Exit with a clear message if it
      is absent.
- [ ] Elementary primary, Intermediate fallback. Writes `data/words/<word>.json`
      and `data/audio/<word>.mp3`.
- [ ] Audio URL per spec §5, including the `bix`/`gg`/`number`/first-letter
      subdirectory rule. The basename comes from `prs[].sound.audio` and is not
      derivable from the word.
- [ ] Resumable: skip words already cached. The spine is ~1050 words against a
      1000/day/reference cap, so an interrupted run must resume cleanly.
- [ ] Test the URL-construction and subdirectory rules as pure functions. **Do
      not hit the network in tests.**
- [ ] Commit.

### Task 2.8 — Audio playback

**Files:** create `spelling-game/js/audio.js`

- [ ] Prefer the cached mp3; fall back to `speechSynthesis` when absent.
- [ ] **Never fetch from Merriam-Webster at play time.** The fallback is local
      TTS, not a live request.
- [ ] The game must be fully playable with no key and no cache.
- [ ] Commit.

### Task 2.9 — Server allowlist

**Files:** modify `server/serve.js`, `math-game/tests/server.test.js`

- [ ] Add `spelling` to `LOG_PATHS`. One line.
- [ ] Add a test that an unknown `?game=` is a 400 and that `__proto__` cannot
      name a path. This is the one place a Wave 2 task may add to math's test
      file, because that is where the server tests live.
- [ ] Commit.

---

## ▶ GATE B — wave review

- Every module in `spelling-game/js/` is pure except `audio.js`.
- No DOM, no network, no clock, no randomness in the pure set.
- `patternsFor` and the adapter are total over the whole spine.
- The frontier's non-blocking property is tested, not just claimed.
- `tools/fetch-words.js` runs against a real key and fetches ~20 words
  successfully, then resumes correctly after being interrupted.

---

# Wave 3 — Screens and the two modes

Depends on Waves 1 and 2. Follow `math-game/js/ui/` for the mount/render split
and the reserved-region rule: **the word must not move vertically when anything
appears.**

### Task 3.1 — Page shell

**Files:** create `spelling-game/index.html`, `spelling-game/css/*`

- [ ] Palette and fonts shared with the other two games — `#eef0f3` page,
      `#7b6bd6` accent, Baloo 2 display, Nunito UI. Copy for now; the shared
      theme file is deferred (spec §16).
- [ ] A classic inline script guarding `file://`, per both existing games.
- [ ] Gate the game on `serverIsUp()` — refuse to start with nowhere to save.
- [ ] Commit.

### Task 3.2 — The word screen

**Files:** create `spelling-game/js/ui/word.js`

- [ ] Letter slots, one per letter. Slots in both modes; **no submit key in
      either** — evaluate when typed length reaches word length.
- [ ] Progressive reveal: letters grey into the slots left to right, first after
      `delays[bucket]`, each subsequent after `letterStepMs`.
- [ ] Wrong answer: amber pulse ~400ms using the shared error pair (`#f4c9c2`
      fill, `#d98a7d` text), clear, and reveal exactly one more letter.
- [ ] Replay audio on `Space`.
- [ ] Commit.

### Task 3.3 — Learn mode screen

**Files:** create `spelling-game/js/ui/learn.js`

- [ ] The family header and the family's words on screen.
- [ ] **The family stays visible after the target word hides.** This is the
      detail that stops flash-and-hide being copy practice — do not remove it as
      a simplification.
- [ ] "Show me" is **press-and-hold**: the word is visible only while held.
- [ ] Definition and usage sentence when cached. No clock anywhere.
- [ ] Commit.

### Task 3.4 — Results screen

**Files:** create `spelling-game/js/ui/results.js`

- [ ] Results is a **hub, not a terminus** — both continuations always offered,
      whichever mode just finished. Follow `math-game/js/ui/results.js`.
- [ ] Show words moved buckets, clean rate, and the frontier position. No speed
      score, no streak, no comparison to anyone.
- [ ] Commit.

### Task 3.5 — Wiring

**Files:** create `spelling-game/js/main.js`

- [ ] Mode from `?mode=`, falling back to `CONFIG.mode`.
- [ ] Load log tail, derive mastery, compute the active window, run the session
      loop.
- [ ] **Drill wires both dials into the scheduler**: pass `candidates` as the
      active window and `itemWeight` as a function backed by `typingCost`. This
      is the only place the two dials meet, and it is easy to build everything
      else correctly and never connect them.
- [ ] Emit the session event at the end, including `frontier`.
- [ ] `record` fires without being awaited. The kid never waits on I/O.
- [ ] Flush the outbox once at startup.
- [ ] Commit.

---

## ▶ GATE C — wave review

- **Play both modes end to end**, and say what was actually observed.
- Confirm specifically: the amber pulse paints; press-and-hold hides on release;
  the family stays on screen; a wrong answer reveals exactly one letter; the word
  does not move vertically when hints appear.
- A session's events land in `data/spelling-log.jsonl` with correct `stage` and
  `revealed` values. Read the file — do not assume.

---

# Wave 4 — Integration

### Task 4.1 — Menu cards

**Files:** modify `games-menu.html`

- [ ] Two cards: **Learn Spelling** → `?mode=learn`, **Spell It** → `?mode=drill`.
- [ ] Copy must not describe them as difficulty levels. They are different
      activities.
- [ ] Commit.

### Task 4.2 — Replay

**Files:** modify `tools/replay.js`

- [ ] Add `--game=math|spelling`, selecting the space adapter and log path. One
      tool, not two.
- [ ] Commit.

### Task 4.3 — Play it

- [ ] A full sitting in both modes. Report what actually happened, including
      anything that felt wrong. "Not verified" beats an assumed pass.
- [ ] Confirm the game starts with **no `MW_KEY` and an empty cache**, on TTS
      alone.

### Task 4.4 — Notes

**Files:** create `spelling-game/docs/next-steps.md`

- [ ] Same format as the other two: what it is, why we think so, where to start.
      Mark which items are backed by real play and which are only read from code.
- [ ] Commit.

---

## ▶ GATE D — final review

- Full suite green across all three games.
- The math game still plays correctly — it was rewritten in Wave 1 and has not
  been exercised since Gate A.
- Nothing in `data/` is tracked. No API key anywhere in the repo or its history.

---

## Open risks

- **Wave 1 is the whole risk of this plan.** If the ten math tests cannot pass
  unmodified, stop. Do not edit them.
- **`hotMs: 4000` is a guess** and is expected to be wrong. It is one config line
  and `tools/replay.js` can retune it against collected history.
- **Whether a 4-year-old can use this at all is unknown.** Letter tiles in learn
  mode are the fallback, deliberately not built (spec §17).
- **The typing game's per-key data is not consumed.** `typingCost` ships at stage
  1 only. Stages 2 and 3 depend on work that belongs to the typing game.
