# Math facts game — design

**Date:** 2026-08-01
**Status:** Approved design, ready for implementation planning
**Branch:** `math-facts-game`

## Context

Multiplication fact fluency is the highest-leverage math target for a 10-year-old.
Not "can work it out" — retrieval from memory, under about 3 seconds, at 95%+
accuracy. The distinction is about working memory, not speed for its own sake. A
kid who computes `6 × 7` by adding up from `6 × 6` has spent most of their mental
workbench before they reach the actual problem, so `3/4 + 5/6` — which has six
multiplication facts buried inside it — collapses. It then looks like a fractions
problem, and later like an algebra problem, and eventually like "I'm not a math
person."

The facts that are actually missing are a small set. Most of the hundred are
carried by patterns: ×2 is doubling, ×5 is half of ×10, ×9 has the digit-sum
rule, squares are distinctive enough to stick. What's left with no pattern hook
and operands too large to skip-count quickly is roughly **6×7, 6×8, 7×8, 7×9,
8×9**.

Flashcards get one thing right — retrieval practice — and miss most of the rest.
This game is built around what they miss.

## What flashcards miss

Each of these maps to a design decision below.

1. **They score correctness, not latency.** "Correct in 5 seconds" and "correct
   in 0.7 seconds" are different mental events — one is computation, one is
   retrieval — and only the second is the goal. A deck marks a kid done while
   they're still calculating every single time.
2. **They're blocked, not interleaved.** Drilling "the 7s" lets a kid stop
   retrieving and start adding 7 to the previous answer. Blocked practice
   flatters performance during the session and produces markedly worse retention
   than interleaving.
3. **No error diagnosis.** `6 × 7 = 48` isn't a random miss, it's interference
   from `6 × 8`. A card says "wrong." That specific wrong answer is the single
   most useful diagnostic in the system.
4. **Flat weighting.** The same effort goes to `2 × 5` as to `7 × 8`, when nearly
   all the value is in about six facts.
5. **Failure is allowed to happen.** A kid who stalls, guesses wrong, and gets
   marked wrong has just practiced retrieving the wrong answer, practiced the
   stall, and attached a bad feeling to the fact.
6. **No reason to do the reps.** Nothing carries a kid to the 400th repetition.

## Goals

- Build genuine retrieval fluency on the multiplication facts through 10 × 10.
- Make latency the spine of the system — scoring, hint timing, scheduling, and
  reporting are all readings of the same number.
- Never stage a failure. Errors become help, not penalties.
- Produce a durable, machine-readable record we can analyse in conversation and
  compare across changes to the game itself.
- Stay dependency-free and double-click-to-play.

## Non-goals

- Addition, subtraction, division — **v1 is multiplication only.** The data model
  and hint system are built so these are a content extension, not a rewrite.
- Multi-kid profiles. One kid per machine, as with the typing game.
- Any network egress. The server is localhost-only; nothing leaves the machine.
- A visible countdown, a timer bar, or any displayed clock pressure. Time is
  measured relentlessly and never shown as a threat.
- Leaderboards or comparison against anyone but the kid's own past self.

## 1. The fact space

Operands **0 through 10**, so 121 ordered pairs.

`6 × 7` and `7 × 6` are **one fact**, sharing a single record; which orientation
is displayed is randomised per showing. That reduces the space to **66 unique
facts** and stops the system treating a known fact as two half-known ones.

Answers range 0–100. Digit lengths matter to the input rule (§3): `0`–`9` are one
digit, `10`–`99` are two, and `100` is the only three-digit answer in the set.

`0 × n` and `1 × n` are included. They are trivial, will reach `hot` almost
immediately, and the scheduler will then rarely serve them — which is the correct
outcome and requires no special-casing.

## 2. Session shape

A session is a **fixed count of problems, default 20**. At 3–8 seconds each that
lands around two to three minutes, which is the range where daily practice
actually happens. Spacing does more work here than volume: five short sessions a
week beats one long one decisively.

The count is a named parameter, not a literal scattered through the code. A
progress bar shows position in the round. There is no clock.

## 3. The loop

```
┌────────────────────────────────────────┐
│                                        │
│           6  ×  7  =  ▢▢               │
│                                        │
│    ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░     7 / 20    │
└────────────────────────────────────────┘
```

The problem appears, input is live from that instant, and the clock starts.

**There is no submit key.** The answer box shows one slot per expected digit, and
slots fill left to right as the kid types. Three terminal conditions:

| Condition | Response |
|---|---|
| Typed string equals the answer | Advance immediately |
| Typed length reaches the answer's length without matching | Wrong — respond now (§4) |
| Typed length never reaches it | The hint ladder fires on its timer (§5) |

```
answer 42

   4          1 digit, not yet evaluated      → keep waiting
   42         2 digits, matches               → advance ✓
   48         2 digits, no match              → wrong, respond
   4  …3s…    stalled at 1 digit              → hint stage fires
```

Because a single problem has exactly one correct string, evaluating at length is
unambiguous.

### Why the slots are shown

Without them a kid who thinks `10 × 10 = 99` types two digits and sits waiting on
a machine that appears to have ignored them. The slots make the evaluation rule
visible rather than a hidden contract to be inferred from things not happening.

The slot count is a small hint — it rules out one-digit answers for `6 × 7`, and
for `10 × 10` three slots effectively give it away. We take that trade. The
give-away case is one fact out of 66 and the easiest in the set, and more
substantively, knowing that `6 × 7` lands in the two-digit range is **magnitude
estimation** — real number sense that a good teacher asks for explicitly. The
slots ask it for free. It pays off again when addition arrives and `7 + 8 = ▢▢`
teaches that crossing ten produces two digits.

## 4. Wrong answers

Not a failure ceremony. The entry **pulses amber for ~400ms, clears itself**, and
**the hint ladder advances exactly one stage**.

```
6 × 7 = 48        amber pulse
6 × 7 = ▢▢        cleared
6 × 7 = ▢▢        "6 × 6 = 36, add one more 6"     ← ladder advanced
```

A wrong answer *buys help.* No score is lost, nothing is marked red and left
standing, and the kid is never left wondering whether the machine noticed —
something visibly happened, and the something was useful.

### Why not reject the first bad digit

The alternative is refusing the keystroke that breaks the prefix — type `3` for
`42` and the digit simply doesn't take. Marginally more errorless, and it mirrors
the typing game's block mode.

Rejected, because of what it costs the log. `48` for `6×7` says `6×8` is bleeding
across; `49` says `7×7` is; `36` says `6×6` is. Three different diagnoses, and
they are the most valuable signal in the dataset. Prefix rejection reduces all of
them to "typed a 3 first." Capturing the whole wrong answer costs one amber pulse
and buys the entire confusion-pair analysis.

## 5. The hint ladder

Not a fixed sequence — an **ordered list of stages, each declaring whether it
applies to a given problem**:

| Stage | Shows | Applies when |
|---|---|---|
| `clean` | just the problem | always |
| `strategy` | *"6 × 6 = 36, add one more 6"* | a strategy exists for that fact |
| `blocks` | the array, drawn | product ≤ 25 |
| `reveal` | the answer, greyed into the slots | always |

For a 10-year-old on `6 × 7` this resolves to `clean → strategy → reveal`. For a
6-year-old on `2 × 3` it is `clean → blocks → reveal`. Same engine, different
applicable set. **This is the mechanism that makes the four-operation extension a
content change rather than a fork.**

Blocks and reveal are different kinds of help and deliberately not
interchangeable. Blocks are a *conceptual* scaffold — re-derive it from what
multiplication means. Reveal is a *retrieval* scaffold — here is the thing, now
practise pulling it. They sit at opposite ends of the concrete → strategic →
automatic progression. Blocks also stop being a visualisation above about 25
items; nobody counts 42 blocks. Hence the applicability predicate rather than a
fixed order.

At `reveal`, the answer appears greyed **inside the slots** — the hint lands where
the kid is already looking.

### Timing

Stage advance is driven by the fact's own mastery bucket:

| Bucket | Delay per stage |
|---|---|
| `cold` | 2000 ms |
| `warm` | 4000 ms |
| `hot`  | 6000 ms |

**The delay grows with mastery — it does not shrink.** This is
progressive time delay, and it is counterintuitive enough to get flipped back by
accident, so it is tested explicitly (§10). A brand-new fact gets rescued almost
immediately, which is what keeps acquisition errorless. A nearly-mastered fact is
made to work for it, because at that point retrieval effort is the entire point.

The table is data, not constants scattered through the code, so it can be retuned
against real logs.

## 6. Mastery

Each fact retains its **last 5 attempts** as `{ ms, stage, wrong[] }`. Three
buckets, derived — never stored:

Throughout, **"clean" means the correct answer landed at the `clean` stage** —
before any hint fired. It is the only kind of attempt that counts as evidence of
retrieval.

| Bucket | Definition |
|---|---|
| `cold` | no clean answer in the retained window |
| `warm` | at least one clean answer, but median clean latency ≥ 1500 ms |
| `hot`  | ≥ 3 clean answers, median clean latency < 1500 ms |

Bucket thresholds live in one table alongside the delay table.

**Confusion pairs are derived from the full loaded tail, not the 5-attempt
window.** A wrong answer given three weeks ago is still evidence that two facts
interfere, and it should not age out of the interference guard just because the
fact has been practised since.

## 7. The scheduler

Weighted sample over all 66 facts, weight by bucket — `cold` 6, `warm` 3, `hot` 1
— so mastered facts still resurface occasionally rather than disappearing. Then
three constraints, applied in order:

1. **No repeat** within the last 4 items.
2. **Interference guard.** If `48` has ever been typed for `6×7`, that pair is
   recorded as a confusion pair and the two facts are not served adjacently while
   either is `cold`. Once both are `warm` or better the guard lifts, and
   juxtaposing them becomes useful discrimination practice.
3. **Success governor.** Over a rolling window of the last 8 items, if the
   `clean`-stage success rate falls below 0.8, force-inject a `hot` fact. This is
   what stops a bad night turning into twenty consecutive hard problems. The ~80%
   target is the band where learning per repetition is highest — easier is wasted
   reps, harder is demoralising.

Interleaving is the default and there is no "practise the 7s" mode. That is
deliberate: blocked practice is the specific thing that makes a kid feel fluent
without becoming fluent.

## 8. The log

One JSONL line per event, appended to `data/math-log.jsonl`.

```json
{"type":"attempt","t":"2026-08-01T15:04:05.123Z","build":"m1","session":"s_9f2c",
 "op":"*","a":6,"b":7,"ms":4820,"stage":"strategy","typed":["4","48","4","42"],
 "wrong":[48]}
```

```json
{"type":"session","t":"2026-08-01T15:07:12.004Z","build":"m1","session":"s_9f2c",
 "items":20,"cleanRate":0.65,"medianMs":2740}
```

- `stage` is the furthest hint stage reached before the correct answer landed.
- `typed` is every intermediate string, in order.
- `wrong` is the completed wrong answers, extracted for easy `jq` and `grep`.
  Redundant against `typed`, kept anyway because it is observation-level and the
  convenience is worth the duplication.
- `build` is a version tag bumped whenever scheduler weights, delays, or bucket
  thresholds change. It makes before/after comparison a filter rather than a
  guess.

**Everything else is derived from this file and nothing is stored pre-chewed.**
Mastery, buckets, the grid, session summaries — all computed on read. That is
what makes questions we have not thought of yet answerable against history we
have already collected.

## 9. Storage and the server

The log file is the **single source of truth**. The server must be running for
the page to exist at all, so there is no state where the browser is up and the
file is unreachable — a parallel localStorage copy would only add reconciliation
logic and eventual drift.

- **On load** — `GET /api/log?tail=N`, **default N = 2000**. Mastery needs the
  last 5 attempts across 66 facts, so 330 lines is the floor; 2000 covers roughly
  100 sessions and keeps enough history for the confusion guard and for
  before/after comparison across a build change. The client derives mastery from
  the tail.
- **During play** — all state in memory. Each completed problem fires
  `POST /api/log` **without awaiting it**. The kid never waits on I/O.
- **On disk** — the server appends the line.

localStorage retains exactly one job: an **outbox** for events queued but not yet
acknowledged, flushed on next load. It covers a browser crash or the server being
killed mid-session, holds only un-acked events, and is normally empty. It is a
buffer, not a second store.

### The server

~60 lines of `node:http` and `node:fs`. No dependencies. Node 22 is already on
the machine and already the project's test runtime.

| Route | Behaviour |
|---|---|
| `GET /*` | static file from repo root, with MIME types |
| `GET /api/log?tail=N` | last N lines of the log |
| `POST /api/log` | append one line, `204` |

Two hygiene requirements, both testable:

- Binds **`127.0.0.1` only**, never `0.0.0.0`. This does not go on the network.
- Resolves every requested path and verifies it is inside the repo root before
  reading, so `../..` cannot walk out. Localhost-only does not make traversal
  acceptable, only less interesting.

### The launcher

`play.command`, `chmod +x`, double-clickable from Finder: `cd` to its own
directory, start the server on `:8777`, `open http://localhost:8777/games-menu.html`.
If the port is already live it skips straight to opening the browser rather than
starting a second server.

A Terminal window stays open while it runs; closing it stops the server. That is
the one visible wart and it is accepted — an Automator `.app` would hide it but
does not version sensibly in git.

Every game is served, so the typing game continues to work unchanged.

## 10. Screen layout

```
┌──────────────────────────────────────────────┐
│                                   7 / 20     │
│  ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░            │
├──────────────────────────────────────────────┤
│                                              │
│              6  ×  7  =  ▢▢                  │
│                                              │
│         6 × 6 = 36, add one more 6           │
│                     ↑ hint region            │
└──────────────────────────────────────────────┘
```

- The numerals are the largest thing on screen by a wide margin. This is one
  problem at a time and nothing competes with it.
- The hint region is reserved space, so the layout does not jump when a stage
  fires.
- Palette and fonts are shared with the typing game — `#eef0f3` page, `#7b6bd6`
  accent, Baloo 2 for display and Nunito for UI — so the games read as one family
  from the menu. The wrong-answer pulse reuses the typing game's error pair:
  `#f4c9c2` fill with `#d98a7d` text, the same warm tone its wrong-key flash
  uses, so "that didn't land" looks identical in both games. Values are copied into
  `math-game/css/base.css` for now; extracting a shared theme file waits until
  the typing redesign actually lands.

## 11. Reporting

### The grid

An **11 × 11 grid** — operands 0 through 10 on each axis — with each cell
coloured by its fact's bucket. Because commutative pairs share one record the
grid is **symmetric about the diagonal**: `6 × 7` and `7 × 6` are the same cell
colour because they are the same fact. That symmetry is a feature, not a
redundancy; it makes commutativity visible.

It serves both audiences from one surface: the kid reads *"six cold cells left"*
as a goal, and it reads as a diagnostic to a parent. A concrete, small, visibly
shrinking set of remaining work motivates far better than "84%".

Tapping a cell shows that fact's history — recent latencies, hint stages, wrong
answers given.

### The results screen

After each session: problems completed, `clean`-stage rate, median latency,
personal bests, and which facts moved buckets. **No WPM-equivalent, no speed
score, no comparison to anyone.** The only opponent is the kid's own previous
median.

### The real reporting surface

`data/math-log.jsonl`, read directly in conversation. No visualiser is being
built in v1 — the point is to have complete data to interrogate, decide which
diagnostics are actually useful, and only then build a view for the ones that
earn it.

## 12. Architecture

Vanilla, no build step, no dependencies. **ES modules** — the typing game avoided
these solely because Chrome blocks module imports over `file://`, and serving the
folder removes that constraint entirely.

```
kids-computer-learning/
  play.command
  server/
    serve.js
  data/
    math-log.jsonl
  games-menu.html
  typing-game/                unchanged
  math-game/
    index.html
    css/
      base.css                palette + fonts, ported from the typing design
      layout.css              page shell, progress
      problem.css             numerals, answer slots, amber pulse
      hints.css               strategy text, block array, reveal
      results.css             grid, session summary
    js/
      facts.js                fact space, commutative pairing
      strategies.js           strategy text per fact
      mastery.js              log → per-fact mastery           pure
      scheduler.js            mastery → next problem            pure
      hints.js                ladder, applicability, timing     pure
      engine.js               per-problem input state machine   pure
      log.js                  POST queue + outbox
      ui.js                   DOM
      main.js                 wiring
    tests/
      *.test.js
  tools/
    replay.js
```

### The pure core

`facts`, `mastery`, `scheduler`, `hints`, and `engine` take no DOM, no network,
and **no clock** — `now` is passed in rather than read from `Date.now()`.

This is not tidiness for its own sake. Because mastery and scheduling are pure
functions over the log, `tools/replay.js` can run **real collected history through
a modified scheduler offline**:

```
node tools/replay.js data/math-log.jsonl --build=m2
  → "under the new weights, 6×7 would have been served 14× instead of 6×"
```

So "did that change help?" does not have to mean shipping it to a child for two
weeks and hoping. Much of it is answerable against data already in hand; the
build tag then confirms it in the real record. That is the difference between
tuning by feel and tuning against evidence, and it is worth keeping the clock and
the DOM out of five files to get it.

## 13. Testing

`node --test`, which Node 22 ships built in. No harness, no dependencies — an
improvement on the typing game's `vm` sandbox, which existed only to work around
classic scripts.

The tests that earn their place:

- An answer completes at the right length: `48` for `42` evaluates as wrong, `4`
  alone does not evaluate at all.
- A wrong answer advances the hint ladder exactly one stage — not zero, not two.
- **Hint delay grows with mastery.** The rule most likely to be silently
  reverted.
- `blocks` never applies above product 25; `reveal` always applies; the resolved
  ladder for `6 × 7` is `clean → strategy → reveal`.
- Scheduler never repeats within 4, never serves a live confusion pair
  adjacently, and injects a `hot` fact when the rolling clean rate drops below
  0.8.
- `6 × 7` and `7 × 6` resolve to one record.
- Mastery derivation is deterministic — replaying the same log twice gives an
  identical result.
- The server refuses a path that resolves outside the repo root.

Grid rendering and the amber pulse are verified by playing it.

## 14. Rollout

Branch `math-facts-game`, cut from `master`. The typing game is untouched.

`games-menu.html` gains a Math Facts card. The three existing dead links —
`math-for-kids/`, `Maths-Game-JS/`, and `simple-math-game.html`, none of which
have ever pointed at a file — are removed in the same pass.

`data/math-log.jsonl` is **committed**, not ignored. It is append-only text, git
handles that cleanly, and it makes "what did this look like before we retuned the
scheduler" a `git show` instead of a lost opportunity.

## 15. Deferred extensions

Recorded here because the v1 design deliberately leaves room for them.

- **The other three operations.** Problems are `{ op, operands, answer }` from the
  start, and hint stages carry applicability predicates, so addition,
  subtraction, and division are content plus a stage set rather than a rewrite.
- **Block visualisations for younger kids.** The `blocks` stage exists in v1 with
  its ≤ 25 predicate; it becomes load-bearing when addition and subtraction
  arrive for a younger sibling.
- **Goal-based sessions** — "warm up three cold facts" instead of a fixed count.
  More motivating and more on-message than a fixed 20, but unpredictable session
  length is rough on a school night. Revisit once there is data on real session
  durations.
- **Adaptive session length**, driven by the same data.
- **Mnemonic pegs** for the last stubborn facts, once the logs show which ones
  survive everything else. `5, 6, 7, 8` → `56 = 7 × 8` is the canonical example.
- **A reporting visualiser**, once the log has shown which diagnostics are
  actually worth looking at.
- **A shared theme file** across both games, once the typing redesign lands.

## 16. Open questions

- Exact strategy-hint wording. Worth a pass with the kid — "half it and double"
  may or may not land better than "6 × 6 = 36, add one more 6", and the log will
  not tell us which, only whether it worked.
- Whether the 1500 ms `hot` threshold is right for a 10-year-old. It is the
  published benchmark for automaticity, but it is a starting value to be tuned
  against the first few weeks of real data.
- Whether `0 ×` and `1 ×` facts should be excluded from the grid display even
  though they remain in the fact space, to keep the visible goal honest.
